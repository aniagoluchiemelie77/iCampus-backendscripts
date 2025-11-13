import express from "express";
import { authenticate } from "../../index.js";
import { Course } from "../../tableDeclarations.js";

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

  return router;
}
