import "../workers/reditFile.js";
import express from "express";
import bcrypt from "bcrypt";
import axiosRetry from "axios-retry";
import crypto from "crypto";
import { getChannel } from "../rabbitmq.js";
import axios from "axios";
import jwt from "jsonwebtoken";
import { createNotification } from "../services/notificationService.js";
import { handleGenerateCertificate } from "../controllers/classActions.js";
import { getFallbackBooks } from "../utils/libraryHelpers.js";
import { generateExpiryDate } from "../utils/dateHelper.js";
import { authLimiter, addUserRecord, protect } from "../middleware/auth.js";
import twilio from "twilio";
import { client } from "../workers/reditFile.js";
import { getDownloads } from "../controllers/fetchActions.js";
import {
  createReviewController,
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
import {
  UserDownloads,
  PhoneNumberVerification,
  Posts,
  UserBankOrCardDetails,
  DeletedUser,
  userPrefs,
  UniversitiesAndColleges,
  Notification,
  ITag,
  Product,
  Course,
  TransactionMiddleState,
  Deals,
  EmailVerification,
  OperationalInstitutions,
  Exceptions,
  iTag,
  Lectures,
  Follow,
} from "../tableDeclarations.js";
import geoip from "geoip-lite";
axiosRetry(axios, { retries: 3 });
import {
  generateNotificationId,
  generateUniqueCardNumber,
  generateUserUID,
  generateUniqueDealId,
  generateTokens,
  generateCode,
  generateUniqueReferralCode,
} from "../utils/idGenerator.js";
import * as cheerio from "cheerio";
import {
  verifyGoogleToken,
  verifyGithubToken,
} from "../api/foreignFetchApis.js";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const verificationCodes = {};
const now = new Date();
const formattedTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "numeric",
  hour12: true,
}).format(now);

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
  router.get("/notifications", async (req, res) => {
    try {
      // 1. Destructure based on what the Frontend is actually sending
      const {
        userId,
        limit = "50",
        offset = "0",
        unread,
        category,
      } = req.query;

      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
      }

      const filter = {
        $or: [{ recipientId: userId }, { isPublic: true }],
      };

      // 3. Match Frontend: url += '&unread=true'
      if (unread === "true") {
        filter.isRead = false;
      }

      // 4. Match Frontend: url += '&category=finance'
      if (category) {
        filter.category = category;
      }

      const notifications = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(Math.max(parseInt(offset), 0))
        .limit(Math.max(parseInt(limit), 1));

      res.status(200).json({ notifications });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  router.get("/notifications/:id", async (req, res) => {
    try {
      const { id } = req.params;

      // 1. Search using both ID types for maximum compatibility
      const notification = await Notification.findOne({
        $or: [{ notificationId: id }],
      });

      // 2. Error handling if not found
      if (!notification) {
        return res.status(404).json({
          message: "Notification not found",
          notification: null,
        });
      }

      // 3. Optional: Automatically mark as read when viewed in detail
      if (!notification.isRead) {
        notification.isRead = true;
        await notification.save();
      }

      // 4. Return the data in the structure your frontend expects (data.notification)
      res.status(200).json({
        notification,
      });
    } catch (error) {
      console.error("Error fetching single notification:", error);
      res
        .status(500)
        .json({ message: "Server error fetching notification details" });
    }
  });
  router.patch("/notifications/mark-all-read/:userId", async (req, res) => {
    try {
      const { userId } = req.params;

      // Update all notifications where recipientId matches and isRead is false
      const result = await Notification.updateMany(
        {
          $or: [{ recipientId: userId }],
          isRead: false,
        },
        { $set: { isRead: true } },
      );

      res.status(200).json({
        message: "All notifications marked as read",
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error("Error marking all as read:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  router.patch("/notifications/:id/read", async (req, res) => {
    try {
      const { id } = req.params;
      const notification = await Notification.findOneAndUpdate(
        {
          $or: [{ notificationId: id }],
        },
        { isRead: true },
        { new: true },
      );

      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }

      res
        .status(200)
        .json({ message: "Notification marked as read", notification });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  router.get("/exceptions/course/:courseId", protect, async (req, res) => {
    try {
      const { courseId } = req.params;
      const exceptions = await Exceptions.find({ courseId }).sort({ date: -1 });
      res.status(200).json(exceptions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch course exceptions" });
    }
  });
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
  router.post("/verify-payment", async (req, res) => {
    const { transaction_id, courseId, userId } = req.body;

    try {
      const response = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_CLIENT_SECRET}`,
          },
        },
      );

      const { status, amount, currency, customer } = response.data.data;

      // 2. Check if payment is successful and matches your expected amount
      if (status === "successful") {
        // 3. Update the User's enrolledCourses in MongoDB
        await User.findOneAndUpdate(
          { uid: userId },
          { $addToSet: { coursesEnrolled: courseId } },
        );

        res.status(200).json({ message: "Course unlocked successfully!" });
      } else {
        res.status(400).json({ message: "Payment verification failed" });
      }
    } catch (error) {
      res
        .status(500)
        .json({ message: "Internal server error during verification" });
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
  router.get("/courses/:courseId/assignments", protect, async (req, res) => {
    try {
      const course = await Course.findOne(
        { courseId: req.params.courseId },
        "assignments",
      );
      if (!course) return res.status(404).json({ message: "Course not found" });

      res.status(200).json(course.assignments);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  router.get("/exceptions", protect, async (req, res) => {
    try {
      const { courseId } = req.query;
      const userId = req.user.uid;
      const userRole = req.user.usertype;

      if (!courseId) {
        return res.status(400).json({ message: "courseId is required" });
      }
      let query = { courseId };
      if (userRole === "student") {
        query.studentId = userId;
      } else if (userRole === "lecturer") {
        const course = await Course.findOne({
          courseId: courseId,
          lecturerIds: userId,
        });

        if (!course) {
          return res.status(403).json({
            success: false,
            message: "Access denied. You do not teach this course.",
          });
        }
      } else {
        return res.status(403).json({ message: "Unauthorized user type" });
      }
      const exceptions = await Exceptions.find(query)
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({
        success: true,
        count: exceptions.length,
        exceptions,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  router.get("/courses/lectures/:lectureId", async (req, res) => {
    try {
      const { lectureId } = req.params;
      const lecture = await Lectures.findOne({ id: lectureId });
      if (!lecture) {
        return res.status(404).json({ error: "Lectures session not found" });
      }
      const now = new Date();
      const startTime = new Date(lecture.startTime);

      if (lecture.status === "scheduled" && now >= startTime) {
        lecture.status = "ongoing";
        await lecture.save();
      }

      res.json(lecture);
    } catch (err) {
      console.error("Fetch lecture error:", err);
      res
        .status(500)
        .json({ error: "Server error while fetching lecture details" });
    }
  });
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
  router.get("/lectures/ongoing/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const ongoingLecture = await Lectures.findOne({
        status: "ongoing",
        courseId: {
          $in: await Course.find({ studentsEnrolled: userId }).distinct(
            "courseId",
          ),
        },
      }).populate("courseId"); // Optional: get course details like title

      if (ongoingLecture) {
        return res.status(200).json({
          ongoing: true,
          lecture: ongoingLecture,
        });
      }

      res.status(200).json({ ongoing: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
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
  router.get("/library/search", async (req, res) => {
    const { q, userId } = req.query;
    const searchUrl = `https://1lib.sk/s/${encodeURIComponent(q)}`;
    try {
      if (userId) {
        const today = new Date();
        const user = await User.findOne({ uid: userId });
        const lastAccess = user.monthlyStats.lastLibraryAccess;
        const isNewSession =
          !lastAccess || today - new Date(lastAccess) > 1000 * 60 * 60;
        await User.findOneAndUpdate(
          { uid: userId },
          {
            $inc: {
              "monthlyStats.libraryUsageSessions": isNewSession ? 1 : 0,
              "monthlyStats.booksFound": 1,
            },
            $set: { "monthlyStats.lastLibraryAccess": today },
          },
        );
      }
      const { data } = await axios.get(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        },
      });

      const $ = cheerio.load(data);
      const books = [];

      // 1lib.sk specific selectors
      $(".resItemBox").each((index, element) => {
        const row = $(element);

        // Extracting metadata
        const title = row.find('h3[itemprop="name"] a').text().trim();
        const author = row.find(".authors a").text().trim() || "Unknown Author";
        const thumbnail =
          row.find(".cover").attr("data-src") || row.find(".cover").attr("src");
        const detailsUrl = row.find('h3[itemprop="name"] a').attr("href");

        // Filesize and Extension are usually inside .property_value or property_size
        const extension = row.find(".property_value").first().text().trim();
        const size = row.find(".property_size").text().trim();
        const year = row.find(".property_year").text().trim();

        if (title) {
          books.push({
            id: detailsUrl?.split("/").pop() || Math.random().toString(),
            title,
            author,
            thumbnail: thumbnail?.startsWith("http")
              ? thumbnail
              : `https://1lib.sk${thumbnail}`,
            extension: extension || "PDF",
            size: size || "N/A",
            year: year || "N/A",
            downloadUrl: `https://1lib.sk${detailsUrl}`,
          });
        }
      });

      res.json(books);
    } catch (error) {
      console.error("Scraping Error:", error.message);
      res.status(500).json({ error: "Failed to connect to the library" });
    }
  });
  router.get("/library/featured", async (req, res) => {
    try {
      const rawDept = req.query.department;
      const department =
        rawDept && rawDept.trim().length > 0 ? rawDept.trim() : null;
      const BASE_URL = "https://1lib.sk";
      let targetUrl = department
        ? `${BASE_URL}/s/${encodeURIComponent(department)}`
        : `${BASE_URL}/popular.php`;

      const { data } = await axios.get(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        },
        timeout: 5000,
      });

      const $ = cheerio.load(data);
      const featuredBooks = [];

      $(".bookDetailsBox, .resItemBox").each((index, element) => {
        if (index >= 12) return;

        const row = $(element);
        const title = row.find('h3[itemprop="name"] a, .title a').text().trim();
        const author =
          row.find(".authors a, .author").first().text().trim() ||
          "Various Authors";

        // Selectors can vary; check both common locations for images
        const thumbnail =
          row.find("img.cover").attr("data-src") ||
          row.find("img.cover").attr("src") ||
          row.find(".bookCover img").attr("src");

        const detailsUrl = row.find('a[href^="/book/"]').attr("href");

        // Metadata extraction
        const extension =
          row.find(".property_value").first().text().trim() || "PDF";
        const size = row.find(".property_size").text().trim() || "N/A";
        const year = row.find(".property_year").text().trim() || "N/A";

        if (title && detailsUrl) {
          featuredBooks.push({
            id: detailsUrl.split("/").pop(),
            title,
            author,
            thumbnail: thumbnail?.startsWith("http")
              ? thumbnail
              : `${BASE_URL}${thumbnail}`,
            extension: extension.toUpperCase(),
            size,
            year,
            downloadUrl: `${BASE_URL}${detailsUrl}`,
          });
        }
      });

      if (featuredBooks.length === 0) {
        return res.json(getFallbackBooks());
      }

      res.json(featuredBooks);
    } catch (error) {
      console.error("Featured Scrape Error:", error.message);
      res.json(getFallbackBooks());
    }
  });
  router.get("/fetchLeaderBoards", async (req, res) => {
    try {
      // 1. Top 10 Students
      const topStudents = await User.find({ usertype: "student" })
        .sort({ currentIScore: -1 })
        .limit(10)
        .select(
          "uid firstname lastname currentIScore email previousIScore profilePic department schoolName",
        );

      // 2. Top 10 Instructors (Lecturers + OtherUsers with high reviews)
      const topInstructors = await User.find({
        usertype: { $in: ["lecturer", "otherUser"] },
      })
        .sort({ currentIScore: -1, "monthlyStats.avgReview": -1 })
        .limit(10)
        .select(
          "uid firstname lastname currentIScore email profilePic jobTitle previousIScore",
        );

      // 3. Top 10 Institutions
      const topInstitutions = await OperationalInstitutions.find()
        .sort({ currentiScoreAvg: -1 })
        .limit(10);

      res.status(200).json({
        success: true,
        data: {
          students: topStudents,
          instructors: topInstructors,
          institutions: topInstitutions,
        },
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  router.get("/search", protect, async (req, res) => {
    const { q, uid, viewerRole, viewerTier } = req.query;
    try {
      let users;

      if (uid) {
        const user = await User.findOne({ uid });
        users = user ? [user] : [];
      } else if (q) {
        users = await User.find({
          $or: [
            { firstname: { $regex: q, $options: "i" } },
            { lastname: { $regex: q, $options: "i" } },
            { username: { $regex: q, $options: "i" } },
          ],
        }).limit(20);
      } else {
        return res
          .status(400)
          .json({ success: false, message: "Query or UID required" });
      }

      const safeResults = users.map((u) => {
        const isPro = viewerTier === "pro" || viewerTier === "premium";
        const isEnterprise = viewerRole === "enterprise";

        return {
          uid: u.uid,
          firstname: u.firstname,
          username: u.username,
          lastname: u.lastname,
          profilePic: u.profilePic,
          usertype: u.usertype,
          tier: u.tier,
          isVerified: u.isVerified,
          organizationName: u.organizationName || "",
          displayScore:
            isEnterprise || isPro ? Math.round(u.currentIScore) : "Locked",
        };
      });

      res.json({ success: true, data: uid ? safeResults[0] : safeResults });
    } catch (error) {
      res.status(500).json({ message: error.message, success: false });
    }
  });
  router.get("/profile/search:identifier", protect, async (req, res) => {
    try {
      const { identifier } = req.params;
      const { viewerUid, viewerTier, viewerRole, viewerFirstname } = req.query;
      const targetUser = await User.findOne({
        $or: [
          { uid: identifier },
          { username: identifier },
          { firstname: identifier },
          { lastname: identifier },
        ],
      })
        .select("-password -refreshTokens -iCashPin")
        .lean();
      if (!targetUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      const viewer = await User.findOne({ uid: viewerUid })
        .select("blockedUsers")
        .lean();

      const isBlockedByViewer = (viewer?.blockedUsers || []).includes(
        targetUser.uid,
      );
      const isViewerBlockedByTarget = (targetUser.blockedUsers || []).includes(
        viewerUid,
      );
      if (isBlockedByViewer || isViewerBlockedByTarget) {
        return res.status(403).json({
          success: false,
          message:
            "User not found or you have restricted access to this profile.",
          isBlocked: true,
          targetUid: targetUser.uid,
        });
      }
      // 2. Parallel aggregation for all profile sections
      const [
        followersList,
        followingList,
        isFollowing,
        courses,
        userPosts,
        iTagData,
        bookmarkedPosts,
      ] = await Promise.all([
        // Fetch Followers details (populating from User identity)
        Follow.find({ followingId: targetUser.uid })
          .select("followerId")
          .lean(),

        // Fetch Following details
        Follow.find({ followerId: targetUser.uid })
          .select("followingId")
          .lean(),

        // Check if viewer follows target
        Follow.findOne({ followerId: viewerUid, followingId: targetUser.uid }),

        // Fetch Courses (Academic/Professional)
        targetUser.usertype === "lecturer" ||
        targetUser.usertype === "otherUser"
          ? Course.find({ lecturerIds: targetUser.uid })
              .select(
                "courseTitle courseCode thumbnailUrl session semester isActive description rating studentsEnrolled price",
              )
              .lean()
          : null,

        Post.find({
          $or: [{ "userId.uid": uid }, { originalAuthor: uid }],
        })
          .sort({ createdAt: -1 })
          .lean(),
        // Fetch iTag details
        ITag.findOne({ userId: targetUser.uid }).lean(),
        Post.find({ postId: { $in: targetUser.bookmarks || [] } })
          .sort({ createdAt: -1 })
          .lean(),
      ]);

      // 3. Post-Aggregation Processing

      // Format Courses: Calculate enrollment count
      const formattedCourses = courses
        ? courses.map((course) => ({
            ...course,
            enrolledCount: course.studentsEnrolled
              ? course.studentsEnrolled.length
              : 0,
            studentsEnrolled: undefined, // Hide raw ID array
          }))
        : [];

      // Fetch Full Identity for Followers/Following
      // We do this via IDs to ensure we get the latest profile pics/tiers
      const followerIds = followersList.map((f) => f.followerId);
      const followingIds = followingList.map((f) => f.followingId);

      const [followerDetails, followingDetails] = await Promise.all([
        User.find({ uid: { $in: followerIds } })
          .select(
            "firstname lastname username profilePic tier isVerified usertype organizationName",
          )
          .lean(),
        User.find({ uid: { $in: followingIds } })
          .select(
            "firstname lastname username profilePic tier isVerified usertype organizationName",
          )
          .lean(),
      ]);

      // 4. Privacy & Notification Logic
      const isOwner = viewerUid === targetUser.uid;
      const isPremiumViewer = viewerTier === "premium";

      if (!isOwner && !isPremiumViewer) {
        createNotification({
          notificationId: generateNotificationId("profile"),
          recipientId: targetUser.uid,
          category: "social",
          actionType: "PROFILE_VIEW",
          title: "Profile View",
          message: `${viewerFirstname || "Someone"} viewed your profile`,
          payload: { viewerUid, userName: viewerFirstname },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        }).catch((err) => console.error("Notification Error:", err));
      }

      const canSeeScore =
        isOwner || viewerRole === "enterprise" || viewerTier !== "free";
      const profileData = {
        ...targetUser,
        currentIScore: canSeeScore ? targetUser.currentIScore : "Locked",
        followersList: followerDetails,
        followersCount: followerDetails.length,
        followingList: followingDetails,
        followingCount: followingDetails.length,
        isFollowing: !!isFollowing,
        courses: formattedCourses,
        posts: userPosts,
        iTagData: iTagData || null,
        bookmarkedPosts: bookmarkedPosts,
        bookmarksCount: targetUser.bookmarks?.length || 0,
        likesCount: targetUser.likes?.length || 0,
      };
      res.status(200).json({
        success: true,
        data: profileData,
      });
    } catch (error) {
      console.error("Comprehensive Profile Fetch Error:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });
  router.post("/follow/toggle", async (req, res) => {
    try {
      const { followerId, followingId } = req.body;

      if (!followerId || !followingId) {
        return res.status(400).json({ success: false, message: "Missing IDs" });
      }

      if (followerId === followingId) {
        return res
          .status(400)
          .json({ success: false, message: "You cannot follow yourself" });
      }
      const existingFollow = await Follow.findOne({ followerId, followingId });

      if (existingFollow) {
        await Follow.deleteOne({ id: existingFollow.id });
        const targetUser = await User.findOne({ uid: followingId })
          .select("firstname")
          .lean();
        return res.status(200).json({
          success: true,
          action: "unfollowed",
          message: `Unfollowed ${targetUser.firstname} successfully`,
        });
      } else {
        await Follow.create({ followerId, followingId });
        const followerUser = await User.findOne({ uid: followerId })
          .select("firstname")
          .lean();
        const followerName = followerUser ? followerUser.firstname : "Someone";
        createNotification({
          notificationId: generateNotificationId("social"),
          recipientId: followingId,
          category: "social",
          actionType: "NEW_FOLLOWER",
          title: "New Follower",
          message: `${followerName} started following you`,
          payload: { followerId },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        }).catch((err) => console.error("Follow Notification Error:", err));

        return res.status(200).json({
          success: true,
          action: "followed",
          message: `Followed ${followerName} successfully`,
        });
      }
    } catch (error) {
      console.error("Follow Toggle Error:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });
  router.put("/update-itag", protect, customizeItag);
  router.get("/check-itag/:val", async (req, res) => {
    try {
      const { val } = req.params;
      const iTagData = await ITag.findOne({ username: val });

      if (!iTagData) {
        return res.status(404).json({
          available: true,
          message: "iTag username available",
        });
      }
      return res.status(200).json({
        available: false,
        message: "iTag username already exists",
      });
    } catch (error) {
      console.error("Error fetching iTag:", error);
      return res.status(500).json({
        message: "Server error",
      });
    }
  });
  router.patch("/update-profile", protect, async (req, res) => {
    try {
      const userId = req.user.id;
      const updates = req.body;
      const allowedUpdates = [
        "bio",
        "skills",
        "username",
        "headline",
        "jobTitle",
        "website",
        "alternateEmails",
        "firstname",
        "lastname",
        "email",
        "profilePic",
        "organizationName",
        "department",
      ];
      const filteredUpdates = Object.keys(updates)
        .filter((key) => allowedUpdates.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        });

      const updatedUser = await User.findOneAndUpdate(
        { uid: userId },
        { $set: filteredUpdates },
        { new: true },
      ).select("-resetPinOTP -iCashPin -password -refreshTokens");

      res.status(200).json({
        success: true,
        data: updatedUser,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Server Error" });
    }
  });
  router.post("/payments/initiate-charge", async (req, res) => {
    const { paymentType, paymentData } = req.body;
    const SECRET_KEY = process.env.FLUTTERWAVE_CLIENT_SECRET;

    try {
      const flwResponse = await fetch(
        `https://api.flutterwave.com/v3/charges?type=${paymentType}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(paymentData),
        },
      );

      const data = await flwResponse.json();
      res.status(flwResponse.status).json({ success: true, data });
    } catch (err) {
      res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  });
  router.get("/payments/banks/:countryCode", async (req, res) => {
    const { countryCode } = req.params;

    try {
      const flwResponse = await fetch(
        `https://api.flutterwave.com/v3/banks/${countryCode}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          },
        },
      );
      const data = await flwResponse.json();
      res.status(flwResponse.status).json(data);
    } catch (error) {
      res
        .status(500)
        .json({ status: "error", message: "Failed to fetch banks" });
    }
  });
  router.post("/block/toggle", protect, toggleBlockedUsers);
  router.get("/blocked-list", protect, async (req, res) => {
    try {
      const user = await User.findOne({ uid: req.user.uid });
      const blockedList = await User.find({
        uid: { $in: user.blockedUsers || [] },
      }).select(
        "uid firstname lastname username profilePic tier organizationName",
      );
      res.status(200).json(blockedList);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
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
  router.patch("/downloads/update-progress", protect, async (req, res) => {
    const { productId, progress, completedLessons, lastWatched } = req.body;
    const userId = req.user.id;
    try {
      const updatedUserDownloads = await UserDownloads.findOneAndUpdate(
        {
          userId: userId,
          "ownedProducts.productId": productId,
        },
        {
          $set: {
            "ownedProducts.$.progress": progress,
            "ownedProducts.$.completedLessons": completedLessons,
            "ownedProducts.$.lastWatched": lastWatched,
            lastAccessed: new Date(),
          },
        },
        { new: true },
      );

      if (!updatedUserDownloads) {
        return res
          .status(404)
          .json({ message: "Product not found in user's library" });
      }
      res.status(200).json({ success: true, data: updatedUserDownloads });
    } catch (error) {
      res.status(500).json({ message: "Server Error", error });
    }
  });
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
