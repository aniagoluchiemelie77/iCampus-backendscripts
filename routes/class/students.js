import express from "express";
import mongoose from "mongoose";
import { protect, idempotencyMiddleware } from "../../middleware/auth.js";
import {
  submitLectureException,
  checkTestStatus,
  compareStudentFacesWithGemini,
  submitAssessment,
  submitOnlineClassAttendance,
} from "../../controllers/classActions.js";
import {
  fetchStudentsLecturesTimeline,
  fetchStudentsEnrolledCourses,
} from "../../controllers/fetchActions.js";

const router = express.Router();

router.get("/courses/fetch-my-courses", protect, fetchStudentsEnrolledCourses);
router.post(
  "/exceptions/submit",
  protect,
  idempotencyMiddleware,
  submitLectureException,
);
router.post("/test/submit", protect, idempotencyMiddleware, submitAssessment);
router.get(
  "/courses/:courseId/assessments/:assessmentId/check-status",
  protect,
  checkTestStatus,
);
router.get("/lectures/timeline", protect, fetchStudentsLecturesTimeline);
router.post(
  "/submit-attendance",
  protect,
  idempotencyMiddleware,
  submitOnlineClassAttendance,
);
router.post(
  "/attendance/verify-student",
  protect,
  idempotencyMiddleware,
  compareStudentFacesWithGemini,
);

export default router;
