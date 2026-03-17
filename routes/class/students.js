import express from "express";
import { authenticate } from "../../index.js";
import { Course } from "../../tableDeclarations.js";
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

        // 1. Gemini Extraction (Using the nested structure we discussed)
        const prompt = `

          Extract all details from this course registration document.  

          Return ONLY a valid JSON object with the following structure:

            {

              "studentInfo": {

                "schoolName": "The name of the University/Institution found at the very top logo or header",

                "studentName": "Full name of the student",

                "college": "The college or faculty name",

                "department": "The department name",

                "level": "The level digits only, e.g., 300",

                "matricNo": "The registration/matric number",

                "date": "The date on the document"

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

          Context: For the school name, look at the circular logo at the top (e.g., "University of Port Harcourt" or similar).

        `;
        const filePart = {
          inlineData: {
            data: req.file.buffer.toString("base64"),
            mimeType: req.file.mimetype,
          },
        };

        const result = await model.generateContent([prompt, filePart]);
        const { studentInfo, courses } = JSON.parse(result.response.text());

        // 2. SECURITY CHECK: Verify document matches the current User
        // We check matricNumber, schoolName, and level against the authenticated user (req.user)
        const isOwner =
          studentInfo.matricNo === req.user.matricNumber &&
          studentInfo.schoolName
            .toLowerCase()
            .includes(req.user.schoolName.toLowerCase());

        if (!isOwner) {
          return res.status(403).json({
            message:
              "Document verification failed. The Matric Number or School on this file does not match your profile.",
          });
        }

        // 3. PROCESS EACH COURSE
        const processedCourseIds = [];

        for (const courseData of courses) {
          // Search if the course already exists in the DB for this school
          let course = await Course.findOne({
            courseCode: courseData.courseCode,
            schoolName: studentInfo.schoolName,
          });

          if (course) {
            // If it exists, add user to studentsEnrolled (using $addToSet to avoid duplicates)
            course.studentsEnrolled.addToSet(req.user.uid);
            await course.save();
          } else {
            let newId;
            let isUnique = false;
            // If it doesn't exist, create it
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

        // 4. Update the User's enrolled courses list
        await User.findByIdAndUpdate(req.user.uid, {
          $addToSet: { coursesEnrolled: { $each: processedCourseIds } },
        });

        res.status(200).json({
          message: `Courses processed and saved successfully`,
          studentName: studentInfo.studentName,
          courses: courses,
        });
      } catch (error) {
        console.error("Extraction Error:", error);
        res.status(500).json({ message: "AI failed to process the document" });
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
      if ((user.pointsBalance || 0) < 1.0) {
        return res
          .status(402)
          .json({ message: "Insufficient iCash balance (1.0 required)" });
      }
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const monthlyCount = await CourseException.countDocuments({
        studentId,
        createdAt: { $gte: startOfMonth },
      });
      const limits = { free: 3, pro: 5, premium: 7 };
      if (monthlyCount >= (limits[user.plan] || 3)) {
        return res
          .status(403)
          .json({ message: `Monthly limit reached for ${user.plan} plan.` });
      }
      user.pointsBalance -= 1.0;

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
        message: "Success",
        exception,
        newBalance: user.pointsBalance,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  return router;
}
