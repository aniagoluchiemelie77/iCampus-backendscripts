import express from "express";
import { handleGenerateCertificate } from "../controllers/classActions.js";
import { initiateFlwCharge } from "../controllers/paymentController.js";
import { authLimiter, protect } from "../middleware/auth.js";
import {
  getDownloads,
  fetchConnections,
  fetchUserNotifications,
  fetchSingleNotification,
  fetchProfileInformation,
  fetchBlockedUsers,
  fetchLectureExceptions,
  fetchCourseAssignments,
  fetchCourseLectures,
  fetchLectureExceptionsLecturerView,
  fetchLeaderBoards,
  fetchBanksUsingCountryCode,
  fetchOngoingLectures,
  fetchFeaturedBooksFromLibrary,
  fetchCourseDetailsForOngoingLecture,
  fetchAllExceptionsForOngoingLecture,
  fetchCourseDetails,
  fetchAllLecturesByCourseId,
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
  updateDownloadedCourseViewProgress,
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
} from "../controllers/signinActions.js";

const router = express.Router();

router.post("/register", signUp);
router.post("/login", authLimiter, Login);
router.post("/admin-login", authLimiter, AdminLogin);
router.post("/revoke-session", protect, revokeLoggedInDeviceSession);
router.post("/refresh-token", refreshToken);
router.post("/institutions/validate", validateInstitution);
router.post("/verifyEmail", validateEmail);
router.get("/institutions", fetchInstitutionByCountry);
router.post("/verifyEmailCode", authLimiter, verifyEmailUsingCode);
router.post("/forgotPassword", forgotPassword);
router.post("/changePassword", changePassword);
router.get("/get-notifications", protect, fetchUserNotifications);
router.get("/notifications/:id", protect, fetchSingleNotification);
router.patch(
  "/notifications/mark-all-read",
  protect,
  markAllNotificationsAsRead,
);
router.patch("/notifications/:id/read", protect, markNotificationAsRead);
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
router.get("/exceptions", protect, fetchLectureExceptions);
router.get("/courses/lectures/:lectureId", fetchCourseLectures);
router.get("/lectures/ongoing", protect, fetchOngoingLectures);
router.post("/ai/chat", protect, aiChat);
router.get("/check-account-state", protect, checkAccountState);
router.get("/library/search", protect, searchBookInLibrary);
router.get("/library/featured", protect, fetchFeaturedBooksFromLibrary);
router.get("/fetchLeaderBoards", protect, fetchLeaderBoards);
router.get("/search", protect, searchUserUsingUidOrNameQuery);
router.get("/fetch-connections", protect, fetchConnections);
router.get("/profile/search:identifier", protect, fetchProfileInformation);
router.post("/follow/toggle", protect, toggleFollowingUsers);
router.put("/update-itag", protect, customizeItag);
router.get("/check-itag/:val", protect, verifyiTagUsernameAvailability);
router.patch("/update-profile", protect, updateUserProfile);
router.post("/payments/initiate-charge", protect, initiateFlwCharge);
router.get("/payments/banks/:countryCode", protect, fetchBanksUsingCountryCode);
router.post("/block/toggle", protect, toggleBlockedUsers);
router.get("/blocked-list", protect, fetchBlockedUsers);
router.patch("/preferences/:userId", protect, patchUserPreferences);
router.delete("/account/delete", protect, deleteAccount);
router.post("/password/verify", protect, verifyPasswordInapp);
router.put("/password/update", protect, createNewPasswordInApp);
router.patch("/update-emails", protect, updateEmails);
router.delete("/recovery-email", protect, deleteRecoveryEmail);
router.delete("/phone-number", protect, deletePhoneNumber);
router.post("/verify-phone-otp", protect, verifyPhoneNumberOTP);
router.post("/send-phone-otp", protect, sendPhoneNumberOTP);
router.get("/downloads/fetch-all", protect, getDownloads);
router.get("/courses/search", protect, handleUnifiedCourseSearch);
router.patch(
  "/downloads/update-progress",
  protect,
  updateDownloadedCourseViewProgress,
);
router.post(
  "/downloads/generate-certificate",
  protect,
  handleGenerateCertificate,
);
router.post("/reviews/create", createReviewController);
router.get(
  "/courses/:courseId/fetch-all-lectures",
  protect,
  fetchAllLecturesByCourseId,
);
router.put("/preferences/toggleTheme", protect, toggleTheme);
router.get("/refresh-user-details", protect, refreshUserDetails);
router.post("/courses/manual-create", protect, uploadCourseDetailsManually);
router.post("/online-classes/create", protect, createQuickMeeting);
router.post("/stations/register", protect, registerDropOffStation);

export default router;
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js
//ngrok http 5000
//email: alice@icampus.ed
//password: icampusUser01
//On powershell as admin: Start-Service RabbitMQ
/*
*/