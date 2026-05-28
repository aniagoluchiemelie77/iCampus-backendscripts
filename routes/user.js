import express from "express";
import axios from "axios";
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
} from "../controllers/userActionsController.js";
import {
  SignUp,
  Login,
  RefreshToken,
  fetchInstitutionByCountry,
  ValidateInstitution,
  ValidateEmail,
  VerifyEmailUsingCode,
  ForgotPassword,
  ChangePassword,
} from "../controllers/signinActions.js";
import { Course, Exceptions, Lectures } from "../tableDeclarations.js";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const verificationCodes = {};

export default function (User) {
  const router = express.Router();

  router.post("/register", SignUp);
  router.post("/login", authLimiter, Login);
  router.post("/revoke-session", protect, revokeLoggedInDeviceSession);
  router.post("/refresh-token", RefreshToken);
  router.patch("/:uid", async (req, res) => {
    try {
      const updatedUser = await User.findOneAndUpdate(
        { uid: req.params.uid },
        { $set: req.body },
        { new: true },
      );
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ message: "User updated", user: updatedUser });
    } catch (error) {
      console.error("❌ Update failed:", error);
      res.status(500).json({ error: error.message });
    }
  });
  router.post("/institutions/validate", ValidateInstitution);
  router.post("/verifyEmail", ValidateEmail);
  router.get("/institutions", fetchInstitutionByCountry);
  router.post("/verifyEmailCode", authLimiter, VerifyEmailUsingCode);
  router.post("/forgotPassword", ForgotPassword);
  router.post("/changePassword", ChangePassword);
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
  router.get("/exceptions/lectures/:lectureId", protect, async (req, res) => {
    try {
      const { lectureId } = req.params;
      const exceptions = await Exceptions.find({ lectureId }).sort({
        date: -1,
      });
      res.status(200).json(exceptions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch course exceptions" });
    }
  });
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
  router.get("/courses/:courseId", protect, async (req, res) => {
    try {
      const { courseId } = req.params;
      const course = await Course.findOne({ courseId: courseId })
        .populate(
          "lecturerIds studentsEnrolled",
          "firstname lastname profilePic",
        )
        .exec();

      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      res.status(200).json(course);
    } catch (error) {
      console.error("Fetch Course Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  router.get("/courses/:courseId", protect, async (req, res) => {
    try {
      const { courseId } = req.params;
      const userId = req.user.uid;
      const course = await Course.findOne({
        courseId: courseId,
        studentsEnrolled: userId,
      });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found or you are not enrolled in this course.",
        });
      }
      return res.status(200).json({
        success: true,
        data: course,
      });
    } catch (error) {
      console.error(`Error fetching course ${req.params.courseId}:`, error);
      return res.status(500).json({
        success: false,
        message: "Server error while fetching course details.",
        error: error.message,
      });
    }
  });
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
  router.get("/me", protect, async (req, res) => {
    try {
      const user = await User.findOne({ uid: req.user.uid });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json({
        success: true,
        user: {
          uid: user.uid,
          isSuspended: user.isSuspended,
        },
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });
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

  return router;
}
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js
//ngrok http 5000

//On powershell as admin: Start-Service RabbitMQ
