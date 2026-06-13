import express from "express";
import mongoose from "mongoose";
import { protect } from "../../middleware/auth.js";
import { upload } from "../../workers/multerWorker.js";
import {
  submitLectureException,
  checkTestStatus,
  compareStudentFacesWithGemini,
  submitAssessment,
  submitOnlineClassAttendance,
  uploadCourseDetails,
} from "../../controllers/classActions.js";
import {
  fetchStudentsLecturesTimeline,
  fetchStudentsEnrolledCourses,
} from "../../controllers/fetchActions.js";

export default function () {
  const router = express.Router();

  router.get(
    "/courses/fetch-my-courses",
    protect,
    fetchStudentsEnrolledCourses,
  );
  router.post(
    "/course/extract-course-details-from-uploads",
    protect,
    upload.array("files"),
    uploadCourseDetails,
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
  router.post(
    "/attendance/verify-student",
    protect,
    compareStudentFacesWithGemini,
  );
  return router;
}
