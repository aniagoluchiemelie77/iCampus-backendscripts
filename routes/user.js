import express from "express";
import { initiateFlwCharge } from "../controllers/paymentController.js";
import {
  authLimiter,
  protect,
  idempotencyMiddleware,
} from "../middleware/auth.js";
import {
  fetchConnections,
  fetchUserNotifications,
  fetchSingleNotification,
  fetchProfileInformation,
  fetchBlockedUsers,
  fetchLectureExceptions,
  fetchCourseAssignments,
  fetchCourseLectures,
  fetchLectureExceptionsLecturerView,
  fetchBanksUsingCountryCode,
  fetchOngoingLectures,
  fetchFeaturedBooksFromLibrary,
  fetchCourseDetailsForOngoingLecture,
  fetchAllExceptionsForOngoingLecture,
  fetchCourseDetails,
  fetchAllLecturesByCourseId,
  getAds,
  fetchUserSessions,
} from "../controllers/fetchActions.js";
import { uploadCourseDetailsManually } from "../controllers/classActions.js";
import {
  createReviewController,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteAccount,
  createNewPasswordInApp,
  verifyPhoneNumberOTP,
  deleteRecoveryEmail,
  updateEmails,
  toggleBlockedUsers,
  deletePhoneNumber,
  customizeItag,
  verifyPasswordInapp,
  revokeLoggedInDeviceSession,
  patchUserPreferences,
  sendPhoneNumberOTP,
  toggleFollowingUsers,
  updateUserProfile,
  verifyiTagUsernameAvailability,
  searchBookInLibrary,
  searchUserUsingUidOrNameQuery,
  checkAccountState,
  handleUnifiedCourseSearch,
  toggleTheme,
  refreshUserDetails,
  aiChat,
  createQuickMeeting,
  registerDropOffStation,
  handleUnifiedResourceSearch,
} from "../controllers/userActionsController.js";
import {
  signUp,
  Login,
  refreshToken,
  fetchInstitutionByCountry,
  validateInstitution,
  validateEmail,
  verifyEmailUsingCode,
  forgotPassword,
  changePassword,
  AdminLogin,
  switchToInstitutionAdmin,
} from "../controllers/signinActions.js";
import { upload } from "../workers/multerWorker.js";
import { uploadCourseDetails } from "../controllers/classActions.js";

const router = express.Router();
router.patch(
  "/notifications/mark-all-read",
  protect,
  idempotencyMiddleware,
  markAllNotificationsAsRead,
);
router.get("/lectures/ongoing", protect, fetchOngoingLectures);
router.get("/exceptions", protect, fetchLectureExceptions);
router.post("/ai/chat", protect, aiChat);
router.get("/check-account-state", protect, checkAccountState);
router.get("/library/search", protect, searchBookInLibrary);
router.get("/library/featured", protect, fetchFeaturedBooksFromLibrary);
router.get("/search", protect, searchUserUsingUidOrNameQuery);
router.get("/fetch-connections", protect, fetchConnections);
router.post(
  "/follow/toggle",
  protect,
  idempotencyMiddleware,
  toggleFollowingUsers,
);
router.put("/update-itag", protect, idempotencyMiddleware, customizeItag);
router.patch(
  "/update-profile",
  protect,
  idempotencyMiddleware,
  updateUserProfile,
);
router.post(
  "/payments/initiate-charge",
  protect,
  idempotencyMiddleware,
  initiateFlwCharge,
);
router.post(
  "/block/toggle",
  protect,
  idempotencyMiddleware,
  toggleBlockedUsers,
);
router.get("/blocked-list", protect, fetchBlockedUsers);
router.patch(
  "/preferences",
  protect,
  idempotencyMiddleware,
  patchUserPreferences,
);
router.delete("/account/delete", protect, idempotencyMiddleware, deleteAccount);
router.post(
  "/password/verify",
  protect,
  idempotencyMiddleware,
  verifyPasswordInapp,
);
router.put(
  "/password/update",
  protect,
  idempotencyMiddleware,
  createNewPasswordInApp,
);
router.patch("/update-emails", protect, idempotencyMiddleware, updateEmails);
router.delete(
  "/recovery-email",
  protect,
  idempotencyMiddleware,
  deleteRecoveryEmail,
);
router.delete(
  "/phone-number",
  protect,
  idempotencyMiddleware,
  deletePhoneNumber,
);
router.post(
  "/verify-phone-otp",
  protect,
  idempotencyMiddleware,
  verifyPhoneNumberOTP,
);
router.post(
  "/send-phone-otp",
  protect,
  idempotencyMiddleware,
  sendPhoneNumberOTP,
);
router.get("/courses/search", protect, handleUnifiedCourseSearch);
router.get("/courses/resources/search", protect, handleUnifiedResourceSearch);
router.post("/reviews/create", idempotencyMiddleware, createReviewController);
router.put("/preferences/toggleTheme", protect, toggleTheme);
router.get("/refresh-user-details", protect, refreshUserDetails);
router.post(
  "/courses/manual-create",
  protect,
  idempotencyMiddleware,
  uploadCourseDetailsManually,
);
router.post("/online-classes/create", protect, createQuickMeeting);
router.post("/stations/register", protect, registerDropOffStation);
router.get("/ads/fetch-active", protect, getAds);
router.get("/fetch-sessions", protect, fetchUserSessions);
router.post(
  "/course/extract-course-details-from-uploads",
  protect,
  idempotencyMiddleware,
  upload.array("files"),
  uploadCourseDetails,
);
router.post(
  "/switch-to-admin",
  protect,
  idempotencyMiddleware,
  switchToInstitutionAdmin,
);
router.post("/register", idempotencyMiddleware, signUp);
router.post("/login", authLimiter, idempotencyMiddleware, Login);
router.post("/admin-login", authLimiter, idempotencyMiddleware, AdminLogin);
router.post(
  "/revoke-session",
  protect,
  idempotencyMiddleware,
  revokeLoggedInDeviceSession,
);
router.post("/refresh-token", refreshToken);
router.post(
  "/institutions/validate",
  idempotencyMiddleware,
  validateInstitution,
);
router.post("/verifyEmail", idempotencyMiddleware, validateEmail);
router.get("/institutions", fetchInstitutionByCountry);
router.post(
  "/verifyEmailCode",
  authLimiter,
  idempotencyMiddleware,
  verifyEmailUsingCode,
);
router.post("/forgotPassword", idempotencyMiddleware, forgotPassword);
router.post("/changePassword", idempotencyMiddleware, changePassword);
router.get("/get-notifications", protect, fetchUserNotifications);
router.get("/notifications/:id", protect, fetchSingleNotification);
router.patch(
  "/notifications/:id/read",
  protect,
  idempotencyMiddleware,
  markNotificationAsRead,
);
router.get(
  "/exceptions/course/:courseId",
  protect,
  fetchLectureExceptionsLecturerView,
);
router.get(
  "/exceptions/lectures/:lectureId",
  protect,
  fetchAllExceptionsForOngoingLecture,
);
router.get(
  "/course/ongoing-lecture/:courseId",
  protect,
  fetchCourseDetailsForOngoingLecture,
);
router.get(
  "/courses/fetch-course-details/:courseId",
  protect,
  fetchCourseDetails,
);
router.get("/courses/:courseId/assignments", protect, fetchCourseAssignments);
router.get("/courses/lectures/:lectureId", fetchCourseLectures);
router.get("/profile/search/:identifier", protect, fetchProfileInformation);
router.get("/check-itag/:val", protect, verifyiTagUsernameAvailability);
router.get("/payments/banks/:countryCode", protect, fetchBanksUsingCountryCode);
router.get(
  "/courses/:courseId/fetch-all-lectures",
  protect,
  fetchAllLecturesByCourseId,
);
export default router;

//npx nodemon index.js
//email: alice@icampus.edu
//password: icampusUser01
//npm test controllertests/${filename} 