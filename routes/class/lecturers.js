import express from "express";
import { protect } from "../../middleware/auth.js";
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
  editLectures,
  getCourseGradebook,
} from "../../controllers/classActions.js";
import {
  fetchAllCourseAssessments,
  fetchLecturersLecturesTimeline,
  fetchLecturerEnrolledCourses,
} from "../../controllers/fetchActions.js";

export default function () {
  const router = express.Router();
  router.get(
    "/courses/fetch-my-courses",
    protect,
    fetchLecturerEnrolledCourses,
  );
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
  router.get("/tests/:testId/analysis-data", protect, getAssessmentReport);
  router.put(
    "/courses/:courseId/lectures/:lectureId/edit",
    protect,
    editLectures,
  );
  router.delete("/lectures/:lectureId", protect, deleteLecture);
  router.post("/upload-video", protect, uploadAndVerifyLessonVideo);
  router.post(
    "/lectures/:lectureId/report",
    protect,
    fetchLectureAttendanceReport,
  );
  router.get(
    "/:courseId/get-performance-analysis",
    protect,
    getCourseGradebook,
  );
  return router;
}
