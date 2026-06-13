import express from "express";
import mongoose from "mongoose";
import { protect } from "../../middleware/auth.js";
import {
  Course,
  Lectures,
  Attendance,
  Review,
} from "../../tableDeclarations.js";
import { upload } from "../../workers/multerWorker.js";
import { createNotification } from "../../services/notificationService.js";
import {
  submitLectureException,
  checkTestStatus,
  compareStudentFacesWithGemini,
  submitAssessment,
  submitOnlineClassAttendance,
} from "../../controllers/classActions.js";
import { fetchStudentsLecturesTimeline } from "../../controllers/fetchActions.js";
const { GoogleGenerativeAI } = require("@google/generative-ai");
import { generateNotificationId } from "../../utils/idGenerator.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const generateCourseId = (length = 10) => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};
const session = await mongoose.startSession();
session.startTransaction();

export default function (User) {
  const router = express.Router();

  router.get("/courses", protect, async (req, res) => {
    try {
      const { semester, session } = req.query;
      const userId = req.user.uid;

      const query = {
        studentsEnrolled: userId, // Checks if user ID exists in the array
        isActive: true,
      };

      // Filter by Semester/Session if they aren't "All"
      if (semester && semester !== "All") query.semester = semester;
      if (session && session !== "All") query.session = session;

      const courses = await Course.find(query)
        .select("-Lectures.attendance") // Don't send all student UIDs to every student (Privacy)
        .sort({ createdAt: -1 });

      res.status(200).json(courses);
    } catch (error) {
      res.status(500).json({ message: "Error fetching your courses" });
    }
  });
  router.post("/courses/batch", protect, async (req, res) => {
    try {
      const { ids } = req.body;

      if (!ids || !Array.isArray(ids)) {
        return res
          .status(400)
          .json({ message: "Invalid or missing course IDs" });
      }

      // Find all courses where _id is in the provided array
      const courses = await Course.find({
        courseId: { $in: ids },
      }).lean(); // lean() improves performance for read-only ops

      res.status(200).json(courses);
    } catch (error) {
      res.status(500).json({ message: "Server error fetching batch courses" });
    }
  });
  router.post(
    "/ai/extract-course",
    protect,
    upload.array("files"),
    async (req, res) => {
      try {
        if (!req.files || req.files.length === 0) {
          return res.status(400).json({ message: "No files uploaded" });
        }

        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
          generationConfig: { responseMimeType: "application/json" },
        });

        const prompt = `
          Extract all details from this course registration document. 
          It may consist of multiple pages or images. Combine the data into one response.
          
          Return ONLY a valid JSON object:
          {
            "studentInfo": {
                "schoolName": "University name from header/logo",
                "studentName": "Full name",
                "college": "Faculty name",
                "department": "Department",
                "level": "Level digits only",
                "matricNo": "Registration number",
                "date": "Document date"
            },
            "courses": [
              {
                "courseCode": "e.g., GET 311",
                "courseTitle": "Full title",
                "semester": 1 or 2,
                "session": "e.g., 2024/2025",
                "credits": Integer
              }
            ]
          }
          Note: If a course appears across page breaks, do not duplicate it.
        `;

        // 2. Map all files into the filePart array
        const fileParts = req.files.map((file) => ({
          inlineData: {
            data: file.buffer.toString("base64"),
            mimeType: file.mimetype,
          },
        }));

        // 3. Send the prompt + ALL file parts to Gemini
        const result = await model.generateContent([prompt, ...fileParts]);

        let extraction;
        try {
          extraction = JSON.parse(result.response.text());
        } catch (e) {
          return res
            .status(422)
            .json({ message: "AI returned invalid JSON structure." });
        }

        const { studentInfo, courses } = extraction;

        // 4. SECURITY CHECK: Verify document matches the current User
        const isOwner =
          studentInfo.matricNo === req.user.matricNumber &&
          studentInfo.schoolName
            .toLowerCase()
            .includes(req.user.schoolName.toLowerCase());

        if (!isOwner) {
          return res.status(403).json({
            message: "Document verification failed. Identity mismatch.",
          });
        }

        // 5. PROCESS EACH COURSE (Optimized with Promise.all for speed)
        const processedCourseIds = [];

        for (const courseData of courses) {
          let course = await Course.findOne({
            courseCode: courseData.courseCode,
            schoolName: studentInfo.schoolName,
          });

          if (course) {
            course.studentsEnrolled.addToSet(req.user.uid);
            await course.save();
          } else {
            let newId;
            let isUnique = false;
            while (!isUnique) {
              newId = generateCourseId();
              const existing = await Course.findOne({ courseId: newId });
              if (!existing) isUnique = true;
            }
            course = new Course({
              ...courseData,
              courseId: newId,
              schoolName: studentInfo.schoolName,
              department: studentInfo.department,
              level: studentInfo.level,
              studentsEnrolled: [req.user.uid],
              isActive: true,
            });
            await course.save();
          }
          processedCourseIds.push(course.courseId);
        }

        // 6. Update User's enrolled courses
        await User.findByIdAndUpdate(req.user.uid, {
          $addToSet: { coursesEnrolled: { $each: processedCourseIds } },
        });
        // --- NOTIFY STUDENT (Socket + Push + DB) ---
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: req.user.uid,
          category: "academic",
          actionType: "COURSES_EXTRACTED",
          title: "Course Registration Synced",
          message: `Successfully extracted ${courses.length} courses for the ${studentInfo.level}L ${courses[0]?.semester === 1 ? "1st" : "2nd"} Semester.`,
          payload: {
            courseCount: courses.length,
            level: studentInfo.level,
            matricNo: studentInfo.matricNo,
          },
          sendEmail: false,
          sendPush: true, // Important confirmation of a manual upload
          sendSocket: true, // Refresh the "My Courses" list in React Native
          saveToDb: true,
        });

        res.status(200).json({
          message: `Courses processed successfully`,
          studentName: studentInfo.studentName,
          coursesCount: courses.length,
        });
      } catch (error) {
        console.error("Extraction Error:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    },
  );
  router.post("/exceptions/submit", protect, submitLectureException);
  router.post("/test/submit", protect, submitAssessment);
  router.get(
    "/courses/:courseId/assessments/:assessmentId/check-status",
    protect,
    checkTestStatus,
  );
  router.get("/lectures/timeline", protect, fetchStudentsLecturesTimeline);
  router.post("/submit-attendance", protect, submitOnlineClassAttendance);
  router.post("/submit-review", async (req, res) => {
    try {
      const { lectureId, studentId, lecturerId, rating, comment } = req.body;
      const newReview = new Review({
        lectureId,
        studentId,
        lecturerId,
        rating,
        comment,
      });
      await newReview.save();
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const reviews = await Review.find({
        lecturerId,
        createdAt: {
          $gte: startOfMonth, // Greater than or equal to the 1st
          $lt: endOfMonth, // Less than the 1st of next month
        },
      });
      const totalRating = reviews.reduce((acc, curr) => acc + curr.rating, 0);
      const newAvg = totalRating / reviews.length;
      await User.updateOne(
        { uid: lecturerId },
        { $set: { "monthlyStats.avgReview": newAvg } },
      );

      res.status(201).json({ message: "Review submitted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  router.post(
    "/attendance/verify-student",
    protect,
    compareStudentFacesWithGemini,
  );
  return router;
}
