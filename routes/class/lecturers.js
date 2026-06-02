import express from "express";
import { protect } from "../../middleware/auth.js";
import {
  Course,
  Lectures,
  Assessment,
  Transactions,
  TestSubmission,
} from "../../tableDeclarations.js";
import { createNotification } from "../../services/notificationService.js";
import PDFDocument from "pdfkit-table";
import { generateNotificationId } from "../../utils/idGenerator.js";
import { uploadAndVerifyLessonVideo } from "../../controllers/lectures.js";
import {
  manageExceptions,
  createLectureSchedule,
  createAssessment,
  deleteLecture,
  fetchLectureAttendanceReport,
  uploadCourseMaterial,
  deleteCourseMaterial,
  createCourseContent,
  editCourseContent,
  deleteCourseContent,
  createCourseAssignment,
  deleteCourseAssignment,
  getAssessmentReport,
} from "../../controllers/classActions.js";
import {
  fetchAllCourseAssessments,
  fetchLecturersLecturesTimeline,
} from "../../controllers/fetchActions.js";

export default function (User) {
  const router = express.Router();
  router.post("/courses", protect, async (req, res) => {
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
  router.get("/courses/lecturer-view", protect, async (req, res) => {
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
  router.get("/lectures/timeline", protect, fetchLecturersLecturesTimeline);
  router.post(
    "/courses/addCourseContent/:courseId",
    protect,
    createCourseContent,
  );
  router.put(
    "/courses/editCourseContent/:courseId",
    protect,
    editCourseContent,
  );
  router.delete(
    "/courses/deleteCourseContent/:courseId",
    protect,
    deleteCourseContent,
  );
  router.post(
    "/courses/uploadMaterial/:courseId",
    protect,
    uploadCourseMaterial,
  );
  router.delete(
    "/courses/deleteMaterial/:courseId",
    protect,
    deleteCourseMaterial,
  );
  router.post(
    "/courses/:courseId/assignments",
    protect,
    createCourseAssignment,
  );
  router.delete(
    "/courses/:courseId/assignments/:assignmentId",
    protect,
    deleteCourseAssignment,
  );
  router.patch("/exceptions/:id/status", protect, manageExceptions);
  router.post(
    "/courses/:courseId/lectures/createSchedule",
    protect,
    createLectureSchedule,
  );
  router.post("/courses/:courseId/assessments", protect, createAssessment);
  router.get(
    "/courses/:courseId/assessments",
    protect,
    fetchAllCourseAssessments,
  );
  router.get("/tests/:testId/download-analysis", protect, getAssessmentReport);
  router.get("/tests/:testId/analysis-data", protect, async (req, res) => {
    try {
      const { testId } = req.params;
      const test = await Assessment.findOne({ id: testId });
      if (!test) return res.status(404).json({ message: "Not found" });

      const submissions = await TestSubmission.find({ testId });
      const passMark = test.totalMarks / 2;
      const passedCount = submissions.filter((s) => s.score >= passMark).length;
      const failedCount = submissions.length - passedCount;

      const topPerformers = [...submissions]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      res.json({
        test,
        submissions,
        passedCount,
        failedCount,
        passRate: ((passedCount / (submissions.length || 1)) * 100).toFixed(1),
        topPerformers,
      });
    } catch (error) {
      res.status(500).send("Error");
    }
  });
  // PUT route to postpone a specific lecture
  router.put(
    "/courses/:courseId/lectures/:lectureId/postpone",
    protect,
    async (req, res) => {
      try {
        const { lectureId, courseId } = req.params;
        const { newDate, newStartTime, topicName } = req.body;
        const updatedLecture = await Lectures.findByIdAndUpdate(
          lectureId,
          {
            date: newDate,
            startTime: newStartTime,
            status: "postponed",
          },
          { new: true },
        );
        if (!updatedLecture)
          return res.status(404).json({ message: "Lecture not found" });

        const course = await Course.findOne({ courseId });
        const students = await User.find({
          usertype: "student",
          department: course.department,
          level: course.level,
        }).select("uid firstName");

        const notificationPromises = students.map((student) =>
          createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            category: "classroom",
            actionType: "LECTURE_POSTPONED",
            title: "Lecture Rescheduled",
            message: `The lecture "${topicName}" has been postponed to ${newDate} at ${newStartTime}.`,
            payload: {
              userName: student.firstName,
              topicName: topicName,
              newDate: newDate,
              newTime: newStartTime,
              courseId: updatedLecture.courseId,
              lectureId: updatedLecture.lectureId,
            },
            entityId: updatedLecture.lectureId,
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          }),
        );

        Promise.all(notificationPromises).catch((err) =>
          console.error("Notify Error:", err),
        );

        res.status(200).json({
          message: "Lecture postponed and students notified",
          updatedLecture,
        });
      } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
      }
    },
  );
  router.delete("/lectures/:lectureId", protect, deleteLecture);
  router.post("/lectures/start", async (req, res) => {
    try {
      const { lectureId, courseId } = req.body;

      // 1. Validation: Ensure IDs are present
      if (!lectureId || !courseId) {
        return res
          .status(400)
          .json({ message: "Lecture ID and Course ID are required" });
      }
      const existingLecture = await Lectures.findById(lectureId);
      if (!existingLecture) {
        return res.status(404).json({ message: "Lecture not found" });
      }

      if (existingLecture.status === "ongoing") {
        return res.status(200).json(existingLecture); // Already live, just return it
      }

      // 3. Update status to 'ongoing'
      const lecture = await Lectures.findByIdAndUpdate(
        lectureId,
        { status: "ongoing", actualStartTime: new Date() }, // Track actual start time
        { new: true },
      );

      // 4. Emit via Socket (with safety check)
      if (req.io) {
        // Use the course room so only enrolled students get the popup
        req.io.to(`course_${courseId}`).emit("lecture_started", lecture);
        console.log(`Live signal sent to course_${courseId}`);
      } else {
        console.error(
          "Socket.io instance (req.io) not found on request object",
        );
      }

      res.status(200).json(lecture);
    } catch (error) {
      console.error("Error starting lecture:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });
  router.post("/upload-video", protect, uploadAndVerifyLessonVideo);
  router.post(
    "/lectures/:lectureId/report",
    protect,
    fetchLectureAttendanceReport,
  );
  return router;
}
