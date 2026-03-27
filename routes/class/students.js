import express from "express";
import mongoose from "mongoose";
import { authenticate } from "../../index.js";
import { Course, TestSubmission } from "../../tableDeclarations.js";
import { upload } from "../../workers/multerWorker.js";
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
  router.post("/courses", authenticate, async (req, res) => {
    try {
      const { payload, user } = req.body;

      if (!payload?.ids || !Array.isArray(payload.ids)) {
        return res.status(400).json({ message: "Invalid payload format" });
      }
      // Fetch courses by courseId and optionally filter by userId
      const courses = await Course.find({
        courseId: { $in: payload.ids },
        studentsEnrolled: user.uid, // optional: if you store enrolled students in each course
      });

      if (!courses || courses.length === 0) {
        return res
          .status(404)
          .json({ message: "No courses found for this student" });
      }

      // Format course details
      const filteredDetails = courses.map((course) => ({
        courseId: course.courseId,
        courseCode: course.courseCode,
        title: course.title,
        credits: course.credits,
        semester: course.semester,
        createdAt: course.createdAt,
      }));

      console.log("Filtered course details:", filteredDetails);
      return res.status(200).json({ details: filteredDetails });
    } catch (error) {
      console.error("Error fetching course details:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });
  // GET /api/courses?studentId=...&semester=...&session=...
  router.get("/courses", authenticate, async (req, res) => {
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
  // POST /api/courses/batch
  router.post("/courses/batch", authenticate, async (req, res) => {
    try {
      const { ids } = req.body;

      if (!ids || !Array.isArray(ids)) {
        return res
          .status(400)
          .json({ message: "Invalid or missing course IDs" });
      }

      // Find all courses where _id is in the provided array
      const courses = await Course.find({
        _id: { $in: ids },
      }).lean(); // lean() improves performance for read-only ops

      res.status(200).json(courses);
    } catch (error) {
      res.status(500).json({ message: "Server error fetching batch courses" });
    }
  });
  //Discover
  router.get("/courses/discover", async (req, res) => {
    try {
      // 1. Use aggregate to get random courses
      const courses = await Course.aggregate([
        // Filter for active, published courses
        { $match: { isPublished: true, isActive: true } },

        // Randomly pick 10 courses for variety
        { $sample: { size: 10 } },

        // Project (Select) only the fields the mobile app needs
        {
          $project: {
            courseTitle: 1,
            courseCode: 1,
            instructorName: 1,
            price: 1,
            rating: 1,
            thumbnailUrl: 1,
            courseDuration: 1,
            department: 1, // Add this so your ForYouCard shows the category
          },
        },
      ]);

      res.status(200).json(courses);
    } catch (error) {
      console.error("Marketplace Fetch Error:", error);
      res.status(500).json({ message: "Error fetching marketplace" });
    }
  });
  //AI course detail extraction from coursee file upload
  router.post(
    "/ai/extract-course",
    authenticate,
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
  router.post("/exceptions/submit", authenticate, async (req, res) => {
    try {
      const {
        studentId,
        courseId,
        lectureId,
        reason,
        reasonCategory,
        studentInfo,
        courseInfo,
      } = req.body;

      const user = await User.findOne({ uid: studentId });
      if (!user) return res.status(404).json({ message: "User not found" });

      // PRICING: 1 exception = 0.5 iCash (500 NGN)
      const EXCEPTION_COST = 0.5;

      if ((user.pointsBalance || 0) < EXCEPTION_COST) {
        return res.status(402).json({
          message: `Insufficient iCash balance. Required: ${EXCEPTION_COST} iCash (500 NGN / ~$0.36 USD)`,
        });
      }

      // Monthly limit logic
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthlyCount = await CourseException.countDocuments({
        studentId,
        createdAt: { $gte: startOfMonth },
      });

      const limits = { free: 3, pro: 5, premium: 7 };
      const userLimit = limits[user.plan] || 3;

      if (monthlyCount >= userLimit) {
        return res.status(403).json({
          message: `Monthly limit reached (${userLimit}) for your ${user.plan || "free"} plan.`,
        });
      }

      // Deducting 0.5 iCash
      // Using simple subtraction since 0.5 is clean in binary/floating point
      user.pointsBalance -= EXCEPTION_COST;

      const exception = new CourseException({
        id: new mongoose.Types.ObjectId().toString(),
        studentId,
        studentInfo,
        courseInfo,
        courseId,
        lectureId,
        reason,
        reasonCategory,
        status: "pending",
        date: new Date().toISOString(),
      });

      await user.save();
      await exception.save();

      res.status(201).json({
        success: true,
        message: "Exception submitted successfully",
        exception,
        newBalance: user.pointsBalance,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  router.post("/test/submit", authenticate, async (req, res) => {
    try {
      const { testId, answers, proctoringData } = req.body;

      // 1. Basic Validation
      if (!testId || !answers) {
        return res
          .status(400)
          .json({ message: "Missing required submission data." });
      }

      // 2. Check for existing submission (Prevent double submission)
      const existingSubmission = await TestSubmission.findOne({
        testId,
        studentId: req.user.uid, // req.user comes from your auth middleware
      });

      if (existingSubmission) {
        return res
          .status(403)
          .json({ message: "You have already submitted this test." });
      }
      const isFlagged = proctoringData.tabSwitchCount >= 3;

      const verificationStatus = proctoringData?.entrySelfieUrl
        ? "Verified"
        : "Unverified_Camera_Failure";

      // 4. Create the record
      const newSubmission = new TestSubmission({
        verificationStatus,
        ...req.body,
        studentId: req.user.uid, // Always take ID from the verified token, not the body
        isFlagged: isFlagged,
        proctoringData: {
          deviceId: proctoringData?.deviceId || "Unknown",
          entrySelfieUrl: proctoringData?.entrySelfieUrl || "",
          tabSwitchCount: proctoringData?.tabSwitchCount || 0,
        },
      });

      await newSubmission.save({ session });
      await User.findOneAndUpdate(
        { uid: req.user.uid },
        {
          $addToSet: { completedTests: testId },
          $inc: { overallProgress: 5 }, // Increment progress by a set percentage
        },
        { session },
      );

      await session.commitTransaction();

      // 5. Update Student Progress (Optional)
      // You could update the student's 'Completed' array in their User profile here

      res.status(201).json({
        success: true,
        message: "Test submitted and graded successfully.",
        submissionId: newSubmission._id,
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("Submission Error:", error);
      res
        .status(500)
        .json({ message: "Internal Server Error", error: error.message });
    }
    session.endSession();
  });
  return router;
}
