import express from "express";
import {
  authLimiter,
  protect,
  idempotencyMiddleware,
} from "../middleware/auth.js";
import {
  fetchConnections,
  fetchUserNotifications,
  fetchUnreadNotificationCount,
  fetchSingleNotification,
  fetchProfileInformation,
  fetchProfileContent,
  fetchProfileConnections,
  fetchLectureExceptions,
  fetchCourseAssignments,
  fetchCourseLectures,
  fetchLectureExceptionsLecturerView,
  fetchOngoingLectures,
  fetchCourseDetailsForOngoingLecture,
  fetchAllExceptionsForOngoingLecture,
  fetchCourseDetails,
  fetchAllLecturesByCourseId,
  getAds,
  fetchUserSessions,
  getUserPreferences,
  fetchBanksUsingCountryCode,
  fetchAllUsers,
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
  deletePhoneNumber,
  verifyPasswordInapp,
  revokeLoggedInDeviceSession,
  patchUserPreferences,
  sendPhoneNumberOTP,
  toggleFollowingUsers,
  updateUserProfile,
  checkUsernameAvailability,
  searchUserUsingUidOrNameQuery,
  checkAccountState,
  handleUnifiedCourseSearch,
  toggleTheme,
  aiChat,
  createQuickMeeting,
  registerDropOffStation,
  handleUnifiedResourceSearch,
  saveFcmToken,
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
import { upload } from "../middleware/auth.js";
import { uploadCourseDetails } from "../controllers/classActions.js";
import { initiateFlwCharge } from "../controllers/paymentController.js";
import {
  createPaymentIntent,
  confirmPayment,
  resolveBankAccount,
  savePayoutAccount,
} from "../controllers/paymentsController.js";

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
router.post("/fcm-token", protect, idempotencyMiddleware, saveFcmToken);
router.get("/check-account-state", protect, checkAccountState);
router.get("/search", protect, searchUserUsingUidOrNameQuery);
router.get("/fetch-connections", protect, fetchConnections);
router.post(
  "/follow/toggle",
  protect,
  idempotencyMiddleware,
  toggleFollowingUsers,
);
router.get("/username-availability", protect, checkUsernameAvailability);
router.patch(
  "/update-profile",
  protect,
  idempotencyMiddleware,
  updateUserProfile,
);
router.patch(
  "/preferences",
  protect,
  idempotencyMiddleware,
  patchUserPreferences,
);
router.delete("/account/delete", protect, idempotencyMiddleware, deleteAccount);
router.post(
  "/payments/initiate-charge",
  protect,
  idempotencyMiddleware,
  initiateFlwCharge,
);
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
router.get("/fetch-all-users", protect, fetchAllUsers);
router.get("/courses/resources/search", protect, handleUnifiedResourceSearch);
router.post("/reviews/create", idempotencyMiddleware, createReviewController);
router.put("/preferences/toggleTheme", protect, toggleTheme);
router.post(
  "/courses/manual-create",
  protect,
  idempotencyMiddleware,
  uploadCourseDetailsManually,
);
router.post("/online-classes/create", protect, createQuickMeeting);
router.post(
  "/stations/register",
  protect,
  idempotencyMiddleware,
  registerDropOffStation,
);
router.get("/ads/fetch-active", protect, getAds);
router.get("/fetch-sessions", protect, fetchUserSessions);
router.get("/preferences", protect, getUserPreferences);
router.post(
  "/course/extract-course-details-from-uploads",
  protect,
  idempotencyMiddleware,
  // The app sends the field as "file"; .array("files") rejected every
  // upload with "Unexpected field". Accept either name.
  (req, res, next) =>
    upload.any()(req, res, (err) => {
      if (!err) return next();
      const status = err.status || (err.code === "LIMIT_FILE_SIZE" ? 413 : 400);
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "File is too large. Upload a file under 15MB."
          : err.message;
      return res.status(status).json({ message });
    }),
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
// Must stay above "/notifications/:id" or Express would treat it as an id.
router.get(
  "/notifications/unread-count",
  protect,
  fetchUnreadNotificationCount,
);
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
// Paged profile tabs and follower/following lists (loaded on demand).
router.get("/profile/:uid/content", protect, fetchProfileContent);
router.get("/profile/:uid/connections", protect, fetchProfileConnections);
router.get(
  "/courses/:courseId/fetch-all-lectures",
  protect,
  fetchAllLecturesByCourseId,
);
router.get("/payments/banks/:countryCode", protect, fetchBanksUsingCountryCode);
// Every purchase: the server prices it, then verifies the Flutterwave payment.
router.post("/payments/intent", protect, createPaymentIntent);
router.post("/payments/confirm", protect, confirmPayment);
router.get("/payments/resolve-account", protect, resolveBankAccount);
router.post("/payments/payout-account", protect, idempotencyMiddleware, savePayoutAccount);

export default router;

//npx nodemon index.js
//email: alice@icampus.edu
//password: icampusUser01
//npm test controllertests/${filename}
