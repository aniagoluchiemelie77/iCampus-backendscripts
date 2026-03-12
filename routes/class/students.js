import express from "express";
import { authenticate } from "../../index.js";
import { Course } from "../../tableDeclarations.js";
import { upload } from "../../workers/multerWorker.js";
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
        studentsEnrolled: user, // optional: if you store enrolled students in each course
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
      // Show only published, active courses for the marketplace
      const courses = await Course.find({ isPublished: true, isActive: true })
        .select(
          "courseTitle courseCode instructorName price rating thumbnailUrl courseDuration",
        )
        .limit(20);

      res.status(200).json(courses);
    } catch (error) {
      res.status(500).json({ message: "Error fetching marketplace" });
    }
  });
  //AI course detail extraction from coursee file upload
  router.post(
    "/ai/extract-course",
    authenticate,
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
          generationConfig: { responseMimeType: "application/json" },
        });

        const prompt = `
      Extract course details from this document. 
      Return a JSON object with: courseCode, courseTitle, department, level, semester, session, credits.
      Context: Today's date is March 12, 2026.
    `;

        // Convert the buffer from Multer into the format Gemini expects
        const filePart = {
          inlineData: {
            data: req.file.buffer.toString("base64"),
            mimeType: req.file.mimetype,
          },
        };

        const result = await model.generateContent([prompt, filePart]);
        const response = result.response;
        const extractedData = JSON.parse(response.text());

        // Save to MongoDB and link to the user
        const newCourse = new Course({
          ...extractedData,
          studentsEnrolled: [req.user.uid], // From your auth middleware
          schoolName: req.user.schoolName,
          isActive: true,
        });

        await newCourse.save();

        // Also update the User model's coursesEnrolled array
        await User.findByIdAndUpdate(req.user.uid, {
          $addToSet: { coursesEnrolled: newCourse._id },
        });

        res.status(200).json(newCourse);
      } catch (error) {
        console.error("Extraction Error:", error);
        res.status(500).json({ message: "AI failed to process the document" });
      }
    },
  );
  return router;
}
