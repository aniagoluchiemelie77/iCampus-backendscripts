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
  markAllMessagesAsRead,
  toggleFollowingUsers,
  updateUserProfile,
  updateDownloadedCourseViewProgress,
  verifyiTagUsernameAvailability,
  searchBookInLibrary,
  searchUserUsingUidOrNameQuery,
  checkAccountState,
  handleUnifiedCourseSearch,
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
} from "../controllers/signinActions.js";
import { Course, Lectures } from "../tableDeclarations.js";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const verificationCodes = {};

export default function () {
  const router = express.Router();

  router.post("/register", signUp);
  router.post("/login", authLimiter, Login);
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
  router.get("/categories", async (req, res) => {
    try {
      const uniqueCategories = await Course.distinct("niche", {
        isPublished: true,
      });
      const filteredCategories = uniqueCategories
        .filter((cat) => !!cat)
        .sort((a, b) => a.localeCompare(b));

      res.status(200).json(filteredCategories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Server error fetching niches" });
    }
  });
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
  router.get("/:uid", async (req, res) => {
    try {
      const { uid } = req.params;
      const user = await User.findOne({ uid: uid })
        .select("uid firstname lastname email profilePic")
        .lean();

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json(user);
    } catch (error) {
      console.error("iCampus DB Error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  router.get("/lectures/ongoing", protect, fetchOngoingLectures);
  router.get("/lectures/details", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ message: "URL parameter is required" });
      }
      const lecture = await Lectures.findOne({ videoUrl: url });
      if (!lecture) {
        return res.status(404).json({ message: "Lecture not found" });
      }
      res.status(200).json(lecture);
    } catch (error) {
      console.error("Backend Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  router.post("/ai/chat", async (req, res) => {
    const { message, context, history, userId } = req.body;
    const { appMetadata } = context;
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const appRules = `
        Here is your App Knowledge Base:
        - iScore: Academic ranking (Higher = better performance).
        - iCash: Campus P2P wallet. Transfers use @iTags.
        - Enrollment: Users must register courses in the 'Academic' tab.
        - Support: If a bug is reported, tell them to upload a screenshot.
      `;
      let contextString = `You are iAssistant, the official support agent and also academic AI for iCampus.
        If a user asks an app-related question, use ${appRules} knowledge to answer.
        User Status: ${appMetadata.tier} user, ${appMetadata.isVerified ? "Verified" : "Unverified"}.
        Current Context: ${context.type}.
        Role: ${appMetadata.usertype}.\n`;

      if (context.type === "course") {
        contextString += `Course: ${context.data.courseTitle} (${context.data.courseCode}). 
        Dept: ${context.data.department}.`;
      } else if (context.type === "lecture") {
        contextString += `Lecture: ${context.data.topicName}. Type: ${context.data.lectureType}. 
        Location: ${context.data.location}.`;
      }
      if (
        message.toLowerCase().includes("issue") ||
        message.toLowerCase().includes("can't")
      ) {
        contextString += `The user is reporting an issue. Use the User Status to explain why they might be seeing errors (e.g., if they are 'free' tier, they might not have access to certain features).`;
      }
      const chat = model.startChat({
        history: [
          { role: "user", parts: [{ text: contextString + " Understood?" }] },
          {
            role: "model",
            parts: [
              {
                text: "Understood. I am ready to assist with this specific context.",
              },
            ],
          },
          ...history,
        ],
      });
      const result = await chat.sendMessage(message);
      const response = result.response;
      if (userId) {
        await User.findOneAndUpdate(
          { uid: userId, usertype: { $in: ["student", "lecturer"] } },
          { $inc: { "monthlyStats.aiQueries": 1 } },
        );
      }

      res.json({ reply: response.text() });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch AI response" });
    }
  });
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
  router.get(
    "/payments/banks/:countryCode",
    protect,
    fetchBanksUsingCountryCode,
  );
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

  return router;
}
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js
//ngrok http 5000

//On powershell as admin: Start-Service RabbitMQ
