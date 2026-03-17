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

      // Fetch courses taught by this lecturer
      const courses = await Course.find({
        courseId: { $in: payload.ids },
        lecturerIds: user,
      });

      if (!courses || courses.length === 0) {
        return res
          .status(404)
          .json({ message: "No teaching courses found registered for you" });
      }

      // Format course details with student count
      const filteredDetails = courses.map((course) => ({
        courseId: course.courseId,
        courseCode: course.courseCode,
        title: course.courseTitle,
        credits: course.credits,
        semester: course.semester,
        createdAt: course.createdAt,
        numberOfStudents: course.studentsEnrolled?.length || 0,
      }));

      console.log("Filtered course details:", filteredDetails);
      return res.status(200).json({ details: filteredDetails });
    } catch (error) {
      console.error("Error fetching course details:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });
  router.get("/courses/lecturer-view", authenticate, async (req, res) => {
    try {
      const { lecturerId, semester, session } = req.query;

      const query = { lecturerIds: lecturerId };
      if (semester && semester !== "All") query.semester = semester;
      if (session && session !== "All") query.session = session;

      const courses = await Course.find(query).lean();

      // 1. Get all unique student UIDs across all courses
      const allStudentUids = [
        ...new Set(courses.flatMap((c) => c.studentsEnrolled)),
      ];

      // 2. Fetch those users from the User collection
      const students = await User.find(
        { uid: { $in: allStudentUids } },
        "firstname lastname email matricNumber uid current_level",
      ).lean();

      // 3. Map students back into their respective courses
      const results = courses.map((course) => ({
        ...course,
        studentsEnrolled: students.filter((s) =>
          course.studentsEnrolled.includes(s.uid),
        ),
        studentCount: course.studentsEnrolled.length,
      }));

      res.status(200).json(results);
    } catch (error) {
      res.status(500).json({ message: "Error fetching lecturer courses" });
    }
  });
 router.post(
   "/courses/updateContent/:courseId",
   authenticate,
   async (req, res) => {
     try {
       const { courseId } = req.params;
       const { updatedContents } = req.body;

       if (!Array.isArray(updatedContents)) {
         return res.status(400).json({ message: "Invalid content format" });
       }

       const updatedCourse = await Course.findByIdAndUpdate(
         courseId,
         { $set: { courseContents: updatedContents } },
         { new: true },
       );

       if (!updatedCourse) {
         return res.status(404).json({ message: "Course not found" });
       }

       res.status(200).json({
         message: "Course content updated successfully",
         courseContents: updatedCourse.courseContents,
       });
     } catch (error) {
       console.error("Update Course Error:", error);
       res
         .status(500)
         .json({ message: "Server error updating course contents" });
     }
   },
 );
 router.post(
   "/courses/uploadMaterial/:courseId",
   authenticate,
   async (req, res) => {
     try {
       const { courseId } = req.params;
       // Assuming 'req.file.path' or 'req.file.location' (for S3) is provided by your upload middleware
       const fileUrl = req.file.path;

       const updatedCourse = await Course.findByIdAndUpdate(
         courseId,
         { $push: { resources: fileUrl } }, // Add new file to general resources
         { new: true },
       );

       res.status(200).json({
         message: "File uploaded",
         resources: updatedCourse.resources,
       });
     } catch (error) {
       res.status(500).json({ message: "Upload failed" });
     }
   },
 );
 router.post(
   "/courses/:courseId/assignments",
   authenticate,
   async (req, res) => {
     try {
       const { courseId } = req.params;
       const { title, description, dueDate } = req.body;
       if (!dueDate || isNaN(Date.parse(dueDate))) {
         return res
           .status(400)
           .json({ message: "A valid due date is required" });
       }

       const newAssignment = {
         title,
         description,
         dueDate: new Date(dueDate),
         fileUrl: req.file ? req.file.path : null, // Store path if a file was uploaded
         submissions: [],
       };

       const updatedCourse = await Course.findOneAndUpdate(
         { courseId: courseId },
         { $push: { assignments: newAssignment } },
         { new: true },
       );

       if (!updatedCourse)
         return res.status(404).json({ message: "Course not found" });

       res.status(201).json({
         message: "Assignment created successfully",
         assignments: updatedCourse.assignments,
       });
     } catch (error) {
       res
         .status(500)
         .json({ message: "Error creating assignment", error: error.message });
     }
   },
 );

  return router;
}
