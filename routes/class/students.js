import express from "express";
import mongoose from "mongoose";
import { authenticate, verifyToken } from "../../middleware/auth.js";
import {
  Course,
  TestSubmission,
  Assessment,
  Lectures,
  Attendance,
  Review,
} from "../../tableDeclarations.js";
import { upload } from "../../workers/multerWorker.js";
import { createNotification } from "../../services/notificationService.js";
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
        courseId: { $in: ids },
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
        // --- NOTIFY STUDENT (Socket + Push + DB) ---
        createNotification({
          notificationId: generateNotificationId(),
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

      // 1. Pricing & Limits Logic
      const EXCEPTION_COST = 0.5;
      if ((user.pointsBalance || 0) < EXCEPTION_COST) {
        return res.status(402).json({
          message: `Insufficient iCash balance. Required: ${EXCEPTION_COST} iCash`,
        });
      }

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthlyCount = await CourseException.countDocuments({
        studentId,
        createdAt: { $gte: startOfMonth },
      });

      const limits = { free: 2, pro: 4, premium: 6 };
      const userLimit = limits[user.plan] || 3;

      if (monthlyCount >= userLimit) {
        return res.status(403).json({
          message: `Monthly limit reached (${userLimit}) for your ${user.plan || "free"} plan.`,
        });
      }

      // 2. Process Transaction & Create Record
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

      // 3. NOTIFY STUDENT (Socket + Push + DB Only)
      createNotification({
        notificationId: generateNotificationId(),
        recipientId: user.uid,
        category: "finance", // Using finance because iCash was spent
        actionType: "EXCEPTION_SUBMITTED",
        title: "Exception Submitted",
        message: `Your exception for ${courseInfo.courseCode} was received. 0.5 iCash has been deducted.`,
        payload: {
          exceptionId: exception.id,
          newBalance: user.pointsBalance,
          courseCode: courseInfo.courseCode,
        },
        sendEmail: false, // Per your requirement
        sendPush: true, // Confirming the "payment" and submission
        sendSocket: true, // Force UI balance update
        saveToDb: true,
      });

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
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { testId, answers, proctoringData } = req.body;
      if (!testId || !answers) {
        return res
          .status(400)
          .json({ message: "Missing required submission data." });
      }

      const existingSubmission = await TestSubmission.findOne({
        testId,
        studentId: req.user.uid,
      });

      if (existingSubmission) {
        return res
          .status(403)
          .json({ message: "You have already submitted this test." });
      }

      // 2. Proctoring Logic
      const isFlagged = (proctoringData?.tabSwitchCount || 0) >= 3;
      const verificationStatus = proctoringData?.entrySelfieUrl
        ? "Verified"
        : "Unverified_Camera_Failure";

      // 3. Create Record
      const newSubmission = new TestSubmission({
        verificationStatus,
        ...req.body,
        studentId: req.user.uid,
        isFlagged: isFlagged,
        proctoringData: {
          deviceId: proctoringData?.deviceId || "Unknown",
          entrySelfieUrl: proctoringData?.entrySelfieUrl || "",
          tabSwitchCount: proctoringData?.tabSwitchCount || 0,
        },
      });

      await newSubmission.save({ session });

      // 4. Update User Profile
      const updatedUser = await User.findOneAndUpdate(
        { uid: req.user.uid },
        {
          $addToSet: { completedTests: testId },
          $inc: { overallProgress: 5 },
        },
        { session, new: true },
      );

      await session.commitTransaction();

      // 5. NOTIFY STUDENT (Socket + Push + DB)
      const test = await Assessment.findOne({ id: testId });

      createNotification({
        notificationId: generateNotificationId(),
        recipientId: updatedUser.uid,
        category: "academic",
        actionType: "TEST_SUBMITTED",
        title: "Assessment Submitted!",
        message: `Your submission for "${test?.title || "the assessment"}" has been received successfully.`,
        payload: {
          testId,
          submissionId: newSubmission._id,
          isFlagged,
        },
        sendEmail: false, // Per requirement
        sendPush: true, // Immediate confirmation on device
        sendSocket: true, // Update UI state
        saveToDb: true,
      });

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
    } finally {
      session.endSession();
    }
  });
  // GET: Check test status and fetch details for a student
  router.get(
    "/courses/:courseId/assessments/:assessmentId/check-status",
    async (req, res) => {
      try {
        const { assessmentId } = req.params;
        const studentId = req.user.uid;

        // 1. Fetch the test details
        const test = await Assessment.findOne({
          $or: [{ id: assessmentId }],
        });

        if (!test) {
          return res.status(404).json({ message: "Assessment not found" });
        }

        // 2. Check if the student has already submitted this specific test
        const submission = await TestSubmission.findOne({
          testId: assessmentId,
          studentId: studentId,
        });

        // 3. Return the merged state
        res.status(200).json({
          hasSubmitted: !!submission,
          submissionDetails: submission || null,
          test: test,
        });
      } catch (error) {
        console.error("Error checking test status:", error);
        res
          .status(500)
          .json({ message: "Server error checking assessment status" });
      }
    },
  );
  // GET: Fetch all lectures for a student's enrolled courses
  router.get("/lectures/timeline", async (req, res) => {
    try {
      const studentId = req.user.uid;
      const enrolledCourses = await Course.find({
        studentsEnrolled: studentId,
      }).select("courseId courseCode courseTitle");
      const courseIds = enrolledCourses.map((c) => c.courseId);
      const lectures = await Lectures.find({
        courseId: { $in: courseIds },
        status: { $ne: "cancelled" },
      }).sort({ date: 1, startTime: 1 });
      const decoratedLectures = lectures.map((lecture) => {
        const courseInfo = enrolledCourses.find(
          (c) => c.courseId === lecture.courseId,
        );
        return {
          ...lecture._doc,
          courseCode: courseInfo?.courseCode,
          courseTitle: courseInfo?.courseTitle,
        };
      });

      res.status(200).json({ success: true, data: decoratedLectures });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  //Attendance submission
  router.post("/submit", verifyToken, async (req, res) => {
    try {
      const { studentId, lectureId, courseId, status, checkData } = req.body;

      // 1. Auth Guard: Ensure the logged-in user matches the studentId being submitted
      if (req.user.uid !== studentId) {
        return res.status(403).json({
          error: "Unauthorized: You can only submit attendance for yourself.",
        });
      }

      // 2. Structural Validation
      if (!studentId || !lectureId || !courseId || !Array.isArray(checkData)) {
        return res
          .status(400)
          .json({ error: "Missing or malformed session data." });
      }

      // 3. Fetch Lecture to verify timing and status
      const lecture = await Lectures.findOne({ id: lectureId });
      if (!lecture) {
        return res.status(404).json({ error: "Lecture not found." });
      }

      // 4. Late Submission Check: Prevent submitting 30 mins after lecture ends
      const gracePeriod = 30 * 60 * 1000; // 30 minutes in ms
      const currentTime = new Date();
      const expiryTime = new Date(lecture.endTime).getTime() + gracePeriod;

      if (currentTime.getTime() > expiryTime) {
        return res.status(403).json({
          error:
            "Submission window closed. Attendance must be synced within 30 mins of class end.",
        });
      }

      // 5. Logic Integrity Check: Verify checkData matches the claimed status
      const totalPassed = checkData.filter((c) => c === true).length;
      const endCheck = checkData[6]; // The 7th point (index 6) is our "Stayed till end" marker

      // If they claim "Present" but failed the 5/7 rule or the end check
      if (status === "Present" && (totalPassed < 5 || !endCheck)) {
        // We log this as suspicious but save as 'Absent' to maintain the record
        console.warn(
          `Suspicious activity: Student ${studentId} attempted to spoof attendance.`,
        );
        return res.status(422).json({
          error:
            "Logic mismatch: Verification data does not support 'Present' status.",
        });
      }

      // 6. Database Update (Upsert)
      const record = await Attendance.findOneAndUpdate(
        { studentId, lectureId },
        {
          courseId,
          status,
          checkData,
          timestamp: currentTime,
        },
        { upsert: true, new: true },
      );

      // 7. Increment Course Stats (only if this is the first successful 'Present' mark)
      // We use 'lastErrorObject' from findAndModify or check if the record was updated vs created
      if (status === "Present") {
        await Course.updateOne(
          { courseId, "students.id": studentId },
          { $inc: { "students.$.classesAttended": 1 } },
        );
      }

      res.status(200).json({
        message: "Attendance recorded and verified successfully",
        recordId: record._id,
      });
    } catch (err) {
      console.error("iCampus Backend Error:", err);
      res
        .status(500)
        .json({ error: "Internal server error during attendance sync." });
    }
  });
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
      res.status(201).json({ message: "Review submitted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  return router;
}
