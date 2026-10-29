import { normalizePreferences } from "../utils/preferences.js";
import { isSchoolAdmin } from "../utils/schoolRoles.js";
import {
  Follow,
  User,
  Posts,
  Transactions,
  Notification,
  Course,
  Exceptions,
  Lectures,
  Assessment,
  Admin,
  SupportTicket,
  PostReposters,
  Comments,
  Ads,
  UserSessions,
  userPrefs,
} from "../tableDeclarations.js";
import { Filter } from "../config/firebaseAdmin.js";
import { createNotification } from "../services/notification.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import { setImmediate } from "timers";
import axiosRetry from "axios-retry";
import axios from "axios";
import { CATEGORY_ROLES } from "../constants/inAppConstants.js";
import {
  getPriorityReposter,
  embedPostWithAuthorDetails,
} from "../utils/reposterPriorityChecker.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { embedCourseInstructor } from "../utils/embedFunctions.js";
import {
  canViewPost,
  enrichPosts,
  loadUsersByUid,
} from "../utils/postPipeline.js";
import { loadNotificationGroups } from "../utils/notificationGrouping.js";
import { client as redis } from "../workers/reditFile.js";
axiosRetry(axios, { retries: 3 });

// Start
export const fetchCourseLectures = async (req, res) => {
  const controllerStartTime = Date.now();
  const controllerName = "fetchCourseLecturesController";
  const action = "fetchCourseLectures";

  try {
    const { lectureId } = req.params;
    const lectureSnapshot = await Lectures.where("id", "==", lectureId)
      .limit(1)
      .get();

    if (lectureSnapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          controllerStartTime,
          "error",
          "Lectures session not found",
        ),
      );
      return res.status(404).json({ error: "Lectures session not found" });
    }

    const lectureDoc = lectureSnapshot.docs[0];
    const lectureData = lectureDoc.data();

    const now = new Date();
    const lectureStartTime = lectureData.startTime?.toDate
      ? lectureData.startTime.toDate()
      : new Date(lectureData.startTime);

    if (lectureData.status === "scheduled" && now >= lectureStartTime) {
      lectureData.status = "ongoing";
      lectureDoc.ref
        .update({ status: "ongoing" })
        .catch((err) =>
          console.error("Failed to update lecture status:", err.message),
        );
    }

    const responseLecture = {
      id: lectureDoc.id,
      ...lectureData,
    };

    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        controllerStartTime,
        "success",
      ),
    );
    res.json(responseLecture);
  } catch (err) {
    console.error("Fetch lecture error:", err.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        controllerStartTime,
        "error",
        err.message,
      ),
    );
    res
      .status(500)
      .json({ error: "Server error while fetching lecture details" });
  }
};
export const fetchLectureExceptionsLecturerView = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchLectureExceptionsLecturerViewController";
  const action = "fetchLectureExceptionsLecturerView";

  try {
    const { courseId } = req.params;
    const userId = req.user.id || req.user.uid;

    const courseSnapshot = await Course.where("courseId", "==", courseId)
      .limit(1)
      .get();

    if (courseSnapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Course not found",
        ),
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseData = courseSnapshot.docs[0].data();
    const lecturerIds = courseData.lecturerIds || [];
    const isLecturer = lecturerIds.some((id) => String(id) === String(userId));

    if (!isLecturer) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Access Denied: You are not authorized to view this course's exceptions",
        ),
      );
      return res.status(403).json({
        message:
          "Access Denied: You are not authorized to view this course's exceptions",
      });
    }

    const exceptionsSnapshot = await Exceptions.where(
      "courseId",
      "==",
      courseId,
    )
      .orderBy("date", "desc")
      .get();

    const exceptions = exceptionsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json(exceptions);
  } catch (error) {
    console.error("Error fetching lecture exceptions:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: "Failed to fetch course exceptions" });
  }
};
//End
export const fetchAllExceptionsForOngoingLecture = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllExceptionsForOngoingLectureController";
  const action = "fetchAllExceptionsForOngoingLecture";
  try {
    console.log("Fetching all exceptions for ongoing lecture...");
    const { lectureId } = req.params;
    const snapshot = await Exceptions.where("lectureId", "==", lectureId)
      .orderBy("date", "desc")
      .get();

    if (snapshot.empty) {
      console.log(`No exceptions found for lectureId: ${lectureId}`);
      return res
        .status(404)
        .json({ message: "No exceptions found for this lecture" });
    }
    console.log("Step 2: Processing exceptions data...");

    const exceptions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    console.log(
      `Step 3: Found ${exceptions.length} exceptions for lectureId: ${lectureId}`,
    );

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json(exceptions);
  } catch (error) {
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: "Failed to fetch course exceptions" });
  }
};
export const fetchBanksUsingCountryCode = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchBanksUsingCountryCodeController";
  const action = "fetchBanksUsingCountryCode";
  const countryCode = String(req.params.countryCode || "").toUpperCase();
  // Interpolated into the Flutterwave URL: anything but a 2-letter code
  // (e.g. "../transactions") would reach other endpoints with our secret key.
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return res.status(400).json({ status: "error", message: "Invalid country code" });
  }
  try {
    const flwResponse = await fetch(
      `https://api.flutterwave.com/v3/banks/${countryCode}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_CLIENT_SECRET}`,
        },
      },
    );
    const data = await flwResponse.json();
    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(flwResponse.status).json(data);
  } catch (error) {
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ status: "error", message: "Failed to fetch banks" });
  }
};
export const fetchAllLecturesByCourseId = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllLecturesByCourseIdController";
  const action = "fetchAllLecturesByCourseId";
  try {
    console.log("Step 1");
    const { courseId } = req.params;
    const snapshot = await Lectures.where("courseId", "==", courseId).get();

    if (snapshot.empty) {
      console.log("Lectues not found...");
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "No lectures found for this course",
        ),
      );
      return res
        .status(404)
        .json({ error: "No lectures found for this course" });
    }
    console.log("Step 2");

    const lectures = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    console.log("Step 3: Returning results");

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.json(lectures);
  } catch (err) {
    console.error("Fetch course lectures error:", err.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      ),
    );
    res
      .status(500)
      .json({ error: "Server error while fetching lectures for this course" });
  }
};
export const fetchLecturersLecturesTimeline = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchLecturersLecturesTimelineController";
  const action = "fetchLecturersLecturesTimeline";
  try {
    const lecturerId = req.user.uid;
    const taughtCoursesSnapshot = await Course.where(
      "lecturerIds",
      "array-contains",
      lecturerId,
    ).get();

    const taughtCourses = taughtCoursesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        courseId: data.courseId,
        courseCode: data.courseCode,
        courseTitle: data.courseTitle,
      };
    });

    const courseIds = taughtCourses
      .map((c) => c.courseId)
      .filter((id) => id !== undefined && id !== null);

    if (courseIds.length === 0) {
      setImmediate(() =>
        logControllerPerformance(controllerName, action, startTime, "success"),
      );
      return res.status(200).json({ success: true, data: [] });
    }

    const chunks = [];
    for (let i = 0; i < courseIds.length; i += 30) {
      chunks.push(courseIds.slice(i, i + 30));
    }

    const lectureResults = await Promise.all(
      chunks.map(async (chunk) => {
        const snap = await Lectures.where("courseId", "in", chunk).get();
        return snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
      }),
    );

    const allLectures = lectureResults.flat();

    const filteredLectures = allLectures
      .filter((lecture) => lecture.status !== "cancelled")
      .sort((a, b) => {
        const dateA = a.date?.toMillis
          ? a.date.toMillis()
          : new Date(a.date).getTime();
        const dateB = b.date?.toMillis
          ? b.date.toMillis()
          : new Date(b.date).getTime();

        if (dateA !== dateB) {
          return dateA - dateB;
        }

        const timeA = a.startTime?.toMillis
          ? a.startTime.toMillis()
          : new Date(a.startTime).getTime();
        const timeB = b.startTime?.toMillis
          ? b.startTime.toMillis()
          : new Date(b.startTime).getTime();
        return timeA - timeB;
      });

    const decoratedLectures = filteredLectures.map((lecture) => {
      const courseInfo = taughtCourses.find(
        (c) => c.courseId === lecture.courseId,
      );
      return {
        ...lecture,
        courseCode: courseInfo?.courseCode,
        courseTitle: courseInfo?.courseTitle,
      };
    });

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json({ success: true, data: decoratedLectures });
  } catch (error) {
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: error.message });
  }
};
export const fetchAllAdmins = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllAdminsController";
  const action = "fetchAllAdmins";
  try {
    // School admins only ever see their own school's representatives.
    const requester = req.admin;
    const schoolScoped = isSchoolAdmin(requester.adminType);
    if (schoolScoped && !requester.schoolCode) {
      return res.status(200).json([]);
    }
    const snapshot = schoolScoped
      ? await Admin.where("schoolCode", "==", requester.schoolCode).get()
      : await Admin.get();
    const admins = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        uid: data.uid || "",
        firstname: data.firstname || "",
        lastname: data.lastname || "",
        profilePic: data.profilePic || "",
        adminType: data.adminType || "",
        lastAccessed: data.lastAccessed || null,
        schoolCode: data.schoolCode || null,
        department: data.department || null,
      };
    });

    console.log(`Admin ${req.admin.uid} fetched the administrator list.`);
    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json(admins);
  } catch (err) {
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      ),
    );
    res.status(500).json({ error: "Failed to fetch administrator list" });
  }
};
export const getNotifications = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getNotificationsController";
  const action = "getNotifications";
  try {
    const { category, page = 1, limit = 20 } = req.query;
    const adminType = req.admin.adminType;
    const allowedRoles = CATEGORY_ROLES[category];

    if (!allowedRoles || !allowedRoles.includes(adminType)) {
      return res.status(403).json({
        error:
          "Access denied. Your role does not have permission to view this category.",
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const snapshot = await Notification.where("category", "==", category)
      .orderBy("createdAt", "desc")
      .get();

    const allNotifications = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const paginatedNotifications = allNotifications.slice(
      skip,
      skip + limitNum,
    );
    const recipientIds = [
      ...new Set(
        paginatedNotifications
          .map((n) => n.recipientId)
          .filter((id) => id !== undefined && id !== null),
      ),
    ];

    const userTypeMap = new Map();

    if (recipientIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < recipientIds.length; i += 30) {
        chunks.push(recipientIds.slice(i, i + 30));
      }

      await Promise.all(
        chunks.map(async (chunk) => {
          const userSnap = await User.where("uid", "in", chunk).get();
          userSnap.docs.forEach((doc) => {
            const userData = doc.data();
            if (userData.uid) {
              userTypeMap.set(userData.uid, userData.usertype || "unknown");
            }
          });
        }),
      );
    }

    const notifications = paginatedNotifications.map((notification) => ({
      ...notification,
      recipientUserType: notification.recipientId
        ? userTypeMap.get(notification.recipientId) || "unknown"
        : "unknown",
    }));

    res.status(200).json({
      success: true,
      data: notifications,
      currentPage: pageNum,
    });
  } catch (error) {
    console.error("Fetch Notifications Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
export const fetchActiveTickets = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cursor = req.query.cursor;
    let queryRef = SupportTicket.where("status", "not-in", [
      "closed",
      "resolved",
    ]).orderBy("__name__", "desc");

    if (cursor) {
      const cursorDoc = await SupportTicket.doc(cursor).get();
      if (cursorDoc.exists) {
        queryRef = queryRef.startAfter(cursorDoc);
      }
    }
    const snapshot = await queryRef.limit(limit + 1).get();

    const docs = snapshot.docs;
    const hasMore = docs.length > limit;
    const ticketDocs = hasMore ? docs.slice(0, limit) : docs;

    const tickets = ticketDocs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const nextCursor = hasMore ? tickets[tickets.length - 1].id : null;

    console.log(`Admin ${req.admin.uid} fetched active support tickets.`);
    res.status(200).json({
      tickets,
      nextCursor,
    });
  } catch (err) {
    console.error("Fetch active tickets error:", err);
    res.status(500).json({ error: "Failed to fetch support tickets" });
  }
};
export const adminFetchUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const userSnapshot = await User.where("uid", "==", userId).limit(1).get();

    if (userSnapshot.empty) {
      return res
        .status(404)
        .json({ message: "User not found", success: false });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    const {
      password,
      iCashPin,
      resetPinOTP,
      verificationToken,
      sessions,
      ...safeUserData
    } = userData;

    const user = {
      id: userDoc.id,
      ...safeUserData,
    };

    console.log(`Admin ${req.admin.uid} viewed details for user ${userId}`);
    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user details for admin:", error);
    res.status(500).json({ message: "Server error", success: false });
  }
};
export const adminFetchUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = "10", offset = "0" } = req.query;

    if (!userId) {
      return res.status(400).json({ message: "Missing userId parameter" });
    }
    const snapshot = await Notification.where(
      "recipientId",
      "==",
      userId,
    ).get();

    const allNotifications = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    allNotifications.sort((a, b) => {
      const timeA = a.createdAt?.toMillis
        ? a.createdAt.toMillis()
        : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toMillis
        ? b.createdAt.toMillis()
        : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    const groupMap = new Map();

    for (const notification of allNotifications) {
      const actionType = notification.actionType;
      const payload = notification.payload || {};
      const entityId =
        payload.postId ||
        payload.followerId ||
        payload.viewerUid ||
        notification.notificationId ||
        "default";

      const groupKey = `${actionType}_${entityId}`;

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          latest: notification,
          count: 1,
        });
      } else {
        const group = groupMap.get(groupKey);
        group.count += 1;
      }
    }

    const aggregatedNotifications = [];
    for (const [, group] of groupMap.entries()) {
      const latest = group.latest;
      const payload = latest.payload || {};

      const primaryUser = payload.username || payload.firstname || "Someone";
      const othersCount = Math.max(0, group.count - 1);

      const enrichedNotification = {
        ...latest,
        payload: {
          ...payload,
          primaryUser,
          othersCount,
        },
      };

      aggregatedNotifications.push(enrichedNotification);
    }

    aggregatedNotifications.sort((a, b) => {
      const timeA = a.createdAt?.toMillis
        ? a.createdAt.toMillis()
        : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toMillis
        ? b.createdAt.toMillis()
        : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    const parsedOffset = Math.max(parseInt(offset), 0);
    const parsedLimit = Math.max(parseInt(limit), 1);

    const notifications = aggregatedNotifications.slice(
      parsedOffset,
      parsedOffset + parsedLimit,
    );

    res.status(200).json({ notifications, success: true });
  } catch (error) {
    console.error("Error fetching user notifications for admin:", error);
    res.status(500).json({ message: "Server error", success: false });
  }
};
export const getSupportTicketByRefId = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getSupportTicketByRefIdController";
  const action = "getSupportTicketByRefId";
  try {
    const { ticketRefId } = req.params;
    const currentUserId = req.user.id || req.user.uid;
    const userEmail = req.user.email;

    if (!ticketRefId) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Ticket reference ID parameter is required",
        ),
      );
      return res.status(400).json({
        success: false,
        message: "Ticket reference ID parameter is required",
      });
    }
    const ticketSnapshot = await SupportTicket.where(
      "ticketRefId",
      "==",
      ticketRefId,
    )
      .limit(1)
      .get();

    if (ticketSnapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Support ticket not found",
        ),
      );
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    const ticketDoc = ticketSnapshot.docs[0];
    const ticket = {
      id: ticketDoc.id,
      ...ticketDoc.data(),
    };

    const isOwner =
      ticket.userId === currentUserId || ticket.guestEmail === userEmail;
    const isAdmin =
      req.user.role === "admin" || req.user.role === "super_admin" || req.admin;

    if (!isOwner && !isAdmin) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized access to this support ticket record",
        ),
      );
      return res.status(403).json({
        success: false,
        message: "Unauthorized access to this support ticket record",
      });
    }

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    return res.status(200).json({
      success: true,
      ticket: ticket,
      message: "Success",
    });
  } catch (error) {
    console.error("Backend getSupportTicketByRefId Error:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};
export const fetchUserSessions = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchUserSessionsController";
  const action = "fetchUserSessions";

  try {
    const currentUserId = req.user.uid;

    const sessionsSnapshot = await UserSessions.where(
      "userId",
      "==",
      currentUserId,
    ).get();

    if (sessionsSnapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "success",
          "No sessions found.",
        ),
      );
      return res.json({ success: true, data: [] });
    }

    const sessions = sessionsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        deviceId: data.deviceId,
        deviceName: data.deviceName || "",
        deviceType: data.deviceType || "",
        ipAddress: data.ipAddress || "",
        location: data.location || "",
        lastUsed: data.lastUsed ? data.lastUsed.toDate() : null,
      };
    });

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error("fetchUserSessions Error:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ success: false, message: error.message });
  }
};
export const fetchAllUsers = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllUsersController";
  const action = "fetchAllUsers";
  const CACHE_KEY = "users:all_users";

  try {
    console.log("Inside users fetch try block");
    const cachedData = await redis.get(CACHE_KEY);

    if (cachedData) {
      let parsedUsers;
      console.log("Retrieving users from cache");
      try {
        parsedUsers =
          typeof cachedData === "string" ? JSON.parse(cachedData) : cachedData;
      } catch (parseError) {
        console.error(
          "Users cache parse error, falling back to database:",
          parseError,
        );
        parsedUsers = null;
      }

      if (parsedUsers) {
        res.status(200).json({
          success: true,
          users: parsedUsers,
          source: "cache",
        });

        setImmediate(() => {
          if (typeof logControllerPerformance === "function") {
            logControllerPerformance(
              controllerName,
              action,
              startTime,
              "success",
            );
          }
        });
        return;
      }
    }
    console.log("step 1: fetching users from database");

    const users = [];
    const snapshot = await User.get();

    snapshot.forEach((doc) => {
      const data = doc.data();
      users.push({
        uid: doc.uid || doc.id,
        firstname: data.firstname,
        lastname: data.lastname,
        username: data.username,
        organizationName: data.organizationName,
        profilePic: data.profilePic,
        tier: data.tier,
        usertype: data.usertype,
        isVerified: data.isVerified,
      });
    });
    console.log("step 2: users fetch successful");

    res.status(200).json({
      success: true,
      users,
      source: "database",
    });

    setImmediate(() => {
      const backgroundTasks = [
        redis
          .set(CACHE_KEY, JSON.stringify(users), { ex: 18000 }) // Upstash expects lowercase "ex"
          .catch((err) => console.error("Redis users cache write error:", err)),
      ];

      if (typeof logControllerPerformance === "function") {
        backgroundTasks.push(
          Promise.resolve().then(() =>
            logControllerPerformance(
              controllerName,
              action,
              startTime,
              "success",
            ),
          ),
        );
      }

      Promise.all(backgroundTasks);
    });
  } catch (error) {
    console.error("Critical Users Fetch Error:", error);
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
    return res
      .status(500)
      .json({ success: false, message: "Server unable to sync users" });
  }
};

//Tested and trusted using jest
export const fetchPosts = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 15, 30);
  const cursorScore = req.query.cursor ? parseFloat(req.query.cursor) : null;
  const viewer = req.user || {};
  const userId = viewer.uid || viewer.id;
  try {
    // School-only memos are filtered after the query, so keep reading pages
    // until this one is full (or the feed runs out) instead of returning a
    // short or empty page that looks like the end of the feed.
    const visible = [];
    let lastScore = cursorScore;
    let exhausted = false;
    for (let round = 0; round < 4 && visible.length < limit && !exhausted; round++) {
      let query = Posts.where("status", "!=", "hidden")
        .orderBy("rankingScore", "desc")
        .limit(limit);
      if (lastScore !== null && !isNaN(lastScore)) {
        query = query.startAfter(lastScore);
      }
      const snap = await query.get();
      if (snap.size < limit) exhausted = true;
      for (const doc of snap.docs) {
        // Stop at a full page without advancing the cursor, otherwise the
        // remaining docs of this read are skipped by the next page.
        if (visible.length >= limit) {
          exhausted = false;
          break;
        }
        const post = { id: doc.id, ...doc.data() };
        lastScore = post.rankingScore;
        if (canViewPost(post, viewer)) visible.push(post);
      }
    }

    const posts = await enrichPosts(visible, userId);
    res.json({
      posts,
      nextCursor: exhausted || lastScore === null ? null : lastScore,
    });
  } catch (err) {
    console.error("--- ❌ FEED ERROR CAUGHT ---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    res.status(500).json({ error: err.message });
  }
};
export const fetchConnections = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchConnectionsController";
  const action = "fetchConnections";

  try {
    const currentUserId = req.user.uid;
    const connectionsSnapshot = await Follow.where(
      "followerId",
      "==",
      currentUserId,
    ).get();

    if (connectionsSnapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "success",
          "No connections found.",
        ),
      );
      return res.json({ success: true, data: [] });
    }

    const followingUids = connectionsSnapshot.docs.map(
      (doc) => doc.data().followingId,
    );

    if (!followingUids.length) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "success",
          "No connections found.",
        ),
      );
      return res.json({ success: true, data: [] });
    }

    const chunks = [];
    for (let i = 0; i < followingUids.length; i += 30) {
      chunks.push(followingUids.slice(i, i + 30));
    }
    const userResults = await Promise.all(
      chunks.map((chunk) => User.where("uid", "in", chunk).get()),
    );

    const users = userResults.flatMap((userSnapshot) =>
      userSnapshot.docs.map((doc) => doc.data()),
    );

    const formattedConnections = users.map((u) => ({
      uid: u.uid,
      username: u.username,
      firstname: u.firstname,
      lastname: u.lastname,
      tier: u.tier,
      organizationName: u.organizationName,
      profilePic: u.profilePic || "",
    }));

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.json({ success: true, data: formattedConnections });
  } catch (error) {
    console.error("fetchConnections Error:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ success: false, message: error.message });
  }
};
export const fetchUserNotifications = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchUserNotificationsController";
  const action = "fetchUserNotifications";
  try {
    const userId = req.user.id;
    const { limit = "50", offset = "0", unread, category } = req.query;

    if (!userId) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing userId",
        ),
      );
      return res.status(400).json({ message: "Missing userId" });
    }

    const groups = await loadNotificationGroups(userId, { category });
    const visible =
      unread === "true" ? groups.filter((g) => g.isRead === false) : groups;

    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const parsedLimit = Math.max(parseInt(limit, 10) || 50, 1);
    const notifications = visible.slice(parsedOffset, parsedOffset + parsedLimit);

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json({ notifications, success: true });
  } catch (error) {
    console.error("Error fetching notifications:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: "Server error", success: false });
  }
};
// Same grouping as the list, so the bell badge always matches the Unread tab.
export const fetchUnreadNotificationCount = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchUnreadNotificationCountController";
  const action = "fetchUnreadNotificationCount";
  try {
    const userId = req.user?.uid || req.user?.id;
    if (!userId) {
      return res.status(400).json({ success: false, message: "Missing userId" });
    }
    const groups = await loadNotificationGroups(userId);
    const count = groups.filter((g) => g.isRead === false).length;
    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    return res.status(200).json({ success: true, count });
  } catch (error) {
    console.error("Error counting unread notifications:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const fetchProfileInformation = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchProfileInformationController";
  const action = "fetchProfileInformation";

  try {
    const { identifier } = req.params;
    const viewer = req.user || {};
    const viewerUid = viewer.uid || viewer.id;
    const { viewerTier, viewerRole, viewerFirstname } = req.query;

    const target = await findProfileTarget(identifier);
    if (!target) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        ),
      );
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    const targetUid = target.uid;
    const isOwner = viewerUid === targetUid;

    // Either direction of a block hides the profile. `blockedByViewer` lets the
    // app offer "Unblock" only when the viewer is the one who blocked.
    const blockedByViewer = (viewer.blockedUsers || []).includes(targetUid);
    const viewerBlockedByTarget = (target.blockedUsers || []).includes(
      viewerUid,
    );
    if (!isOwner && (blockedByViewer || viewerBlockedByTarget)) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Blocked profile",
        ),
      );
      return res.status(403).json({
        success: false,
        isBlocked: true,
        blockedByViewer,
        targetUid: blockedByViewer ? targetUid : undefined,
        message: blockedByViewer
          ? "You have blocked this user."
          : "This profile isn't available.",
      });
    }

    // Counts only; lists load per tab via /profile/:uid/content and
    // /profile/:uid/connections, a page at a time.
    const countOf = async (query) => (await query.count().get()).data().count;
    const [
      followersCount,
      followingCount,
      postsCount,
      repostsCount,
      isFollowingSnap,
      coursesSnap,
      firstPostsPage,
    ] = await Promise.all([
      countOf(Follow.where("followingId", "==", targetUid)),
      countOf(Follow.where("followerId", "==", targetUid)),
      countOf(Posts.where("originalAuthor", "==", targetUid)),
      countOf(PostReposters.where("uid", "==", targetUid)),
      isOwner
        ? null
        : Follow.where("followerId", "==", viewerUid)
            .where("followingId", "==", targetUid)
            .limit(1)
            .get(),
      target.usertype === "lecturer" || target.usertype === "otherUser"
        ? Course.where("lecturerIds", "array-contains", targetUid)
            .limit(20)
            .get()
        : null,
      loadProfileContentPage({ tab: "Posts", target, viewer, limit: 6 }),
    ]);

    const courses = coursesSnap
      ? coursesSnap.docs.map((doc) => {
          const c = doc.data();
          return {
            id: doc.id,
            courseId: c.courseId || doc.id,
            courseTitle: c.courseTitle,
            courseCode: c.courseCode,
            thumbnailUrl: c.thumbnailUrl,
            session: c.session,
            semester: c.semester,
            isActive: c.isActive,
            description: c.description,
            rating: c.rating,
            price: c.price,
            enrolledCount: c.studentsEnrolled ? c.studentsEnrolled.length : 0,
          };
        })
      : [];

    if (!isOwner && viewerTier !== "premium") {
      createNotification({
        notificationId: generateNotificationId("profile"),
        recipientId: targetUid,
        isRead: false,
        category: "social",
        actionType: "PROFILE_VIEW",
        title: "Profile View",
        message: `${viewerFirstname || viewer.firstname || "Someone"} viewed your profile`,
        payload: { viewerUid, userName: viewerFirstname || viewer.firstname },
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      }).catch((err) => console.error("Notification Error:", err));
    }

    const canSeeScore =
      isOwner ||
      (viewerRole || viewer.usertype) === "enterprise" ||
      (viewerTier || viewer.tier || "free") !== "free";

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json({
      success: true,
      data: {
        ...toProfileView(target),
        currentIScore: canSeeScore ? (target.currentIScore ?? null) : "Locked",
        isOwner,
        isFollowing: isOwner ? false : !isFollowingSnap.empty,
        followersCount,
        followingCount,
        postsCount,
        repostsCount,
        // Bookmarks are private.
        bookmarksCount: isOwner ? (target.bookmarks || []).length : undefined,
        courses,
        initialContent: { tab: "Posts", ...firstPostsPage },
      },
    });
  } catch (error) {
    console.error("Comprehensive Profile Fetch Error:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const fetchLectureExceptions = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchLectureExceptionsController";
  const action = "fetchLectureExceptions";

  try {
    const { courseId } = req.query;
    const userId = req.user.uid;
    const userRole = req.user.usertype;

    if (!courseId) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "courseId is required",
        ),
      );
      return res.status(400).json({ message: "courseId is required" });
    }

    let exceptionsQuery = Exceptions.where("courseId", "==", courseId);

    if (userRole === "student") {
      exceptionsQuery = exceptionsQuery.where("studentId", "==", userId);
    } else if (userRole === "lecturer") {
      const courseSnapshot = await Course.where("courseId", "==", courseId)
        .where("lecturerIds", "array-contains", userId)
        .limit(1)
        .get();

      if (courseSnapshot.empty) {
        setImmediate(() =>
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Access denied. You do not teach this course.",
          ),
        );
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not teach this course.",
        });
      }
    } else {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user type",
        ),
      );
      return res.status(403).json({ message: "Unauthorized user type" });
    }

    const snapshot = await exceptionsQuery.orderBy("createdAt", "desc").get();
    const exceptions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json({
      success: true,
      count: exceptions.length,
      exceptions,
    });
  } catch (error) {
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: error.message });
  }
};
export const fetchCourseAssignments = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchCourseAssignmentsController";
  const action = "fetchCourseAssignments";

  try {
    const courseSnapshot = await Course.where(
      "courseId",
      "==",
      req.params.courseId,
    )
      .limit(1)
      .get();

    if (courseSnapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Course not found",
        ),
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseData = courseSnapshot.docs[0].data();
    const assignments = courseData.assignments || [];

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json(assignments);
  } catch (error) {
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: error.message });
  }
};
export const fetchOngoingLectures = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchOngoingLecturesController";
  const action = "fetchOngoingLectures";

  try {
    const userId = req.user.id || req.user.uid;
    const [enrolledCoursesSnap, taughtCoursesSnap] = await Promise.all([
      Course.where("studentsEnrolled", "array-contains", userId).get(),
      Course.where("lecturerIds", "array-contains", userId).get(),
    ]);

    const courseIdSet = new Set();
    enrolledCoursesSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (data.courseId) courseIdSet.add(data.courseId);
    });
    taughtCoursesSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (data.courseId) courseIdSet.add(data.courseId);
    });

    const enrolledOrTaughtCourseIds = Array.from(courseIdSet);

    if (enrolledOrTaughtCourseIds.length === 0) {
      setImmediate(() =>
        logControllerPerformance(controllerName, action, startTime, "success"),
      );
      return res.status(200).json({ ongoing: false });
    }

    const chunks = [];
    for (let i = 0; i < enrolledOrTaughtCourseIds.length; i += 30) {
      chunks.push(enrolledOrTaughtCourseIds.slice(i, i + 30));
    }

    const lectureSnaps = await Promise.all(
      chunks.map((chunk) =>
        Lectures.where("status", "==", "ongoing")
          .where("courseId", "in", chunk)
          .limit(1)
          .get(),
      ),
    );

    let ongoingLectureDoc = null;
    for (const snap of lectureSnaps) {
      if (!snap.empty) {
        ongoingLectureDoc = snap.docs[0];
        break;
      }
    }

    if (ongoingLectureDoc) {
      const lectureData = ongoingLectureDoc.data();
      let populatedCourse = null;

      if (lectureData.courseId) {
        const courseSnap = await Course.where(
          "courseId",
          "==",
          lectureData.courseId,
        )
          .limit(1)
          .get();
        if (!courseSnap.empty) {
          populatedCourse = {
            id: courseSnap.docs[0].id,
            ...courseSnap.docs[0].data(),
          };
        }
      }

      const formattedLecture = {
        id: ongoingLectureDoc.id,
        ...lectureData,
        courseId: populatedCourse || lectureData.courseId,
      };

      setImmediate(() =>
        logControllerPerformance(controllerName, action, startTime, "success"),
      );
      return res.status(200).json({
        ongoing: true,
        lecture: formattedLecture,
      });
    }

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json({ ongoing: false });
  } catch (err) {
    console.error("Error fetching ongoing lecture:", err.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      ),
    );
    res.status(500).json({ error: err.message });
  }
};
export const fetchCourseDetailsForOngoingLecture = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchCourseDetailsForOngoingLectureController";
  const action = "fetchCourseDetailsForOngoingLecture";
  try {
    const { courseId } = req.params;
    const courseSnapshot = await Course.where("courseId", "==", courseId)
      .limit(1)
      .get();

    if (courseSnapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Course not found",
        ),
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseDoc = courseSnapshot.docs[0];
    const course = {
      id: courseDoc.id,
      ...courseDoc.data(),
    };

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json(course);
  } catch (error) {
    console.error("Fetch Course Error:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: "Internal server error" });
  }
};
export const fetchCourseDetails = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchCourseDetailsController";
  const action = "fetchCourseDetails";
  try {
    const { courseId } = req.params;
    const userId = req.user.uid;
    const courseSnapshot = await Course.where("courseId", "==", courseId)
      .where(
        Filter.or(
          Filter.where("studentsEnrolled", "array-contains", userId),
          Filter.where("lecturerIds", "array-contains", userId),
        ),
      )
      .limit(1)
      .get();

    if (courseSnapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Course not found or you do not have permission to view it.",
        ),
      );
      return res.status(404).json({
        success: false,
        message: "Course not found or you do not have permission to view it.",
      });
    }

    const courseDoc = courseSnapshot.docs[0];
    const course = {
      id: courseDoc.id,
      ...courseDoc.data(),
    };

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    return res.status(200).json({
      success: true,
      data: course,
    });
  } catch (error) {
    console.error(
      `Error fetching course ${req.params.courseId}:`,
      error.message,
    );
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    return res.status(500).json({
      success: false,
      message: "Server error while fetching course details.",
      error: error.message,
    });
  }
};
export const fetchStudentsLecturesTimeline = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchStudentsLecturesTimelineController";
  const action = "fetchStudentsLecturesTimeline";
  try {
    const studentId = req.user.uid;
    const enrolledCoursesSnapshot = await Course.where(
      "studentsEnrolled",
      "array-contains",
      studentId,
    ).get();

    const enrolledCourses = enrolledCoursesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        courseId: data.courseId,
        courseCode: data.courseCode,
        courseTitle: data.courseTitle,
      };
    });

    const courseIds = enrolledCourses
      .map((c) => c.courseId)
      .filter((id) => id !== undefined && id !== null);

    if (courseIds.length === 0) {
      setImmediate(() =>
        logControllerPerformance(controllerName, action, startTime, "success"),
      );
      return res.status(200).json({ success: true, data: [] });
    }

    const chunks = [];
    for (let i = 0; i < courseIds.length; i += 30) {
      chunks.push(courseIds.slice(i, i + 30));
    }

    const lecturePromises = chunks.map(async (chunk) => {
      const snap = await Lectures.where("courseId", "in", chunk).get();
      return snap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    });

    const lectureResults = await Promise.all(lecturePromises);
    const allLectures = lectureResults.flat();

    const filteredLectures = allLectures
      .filter((lecture) => lecture.status !== "cancelled")
      .sort((a, b) => {
        const dateA = a.date?.toMillis
          ? a.date.toMillis()
          : new Date(a.date).getTime();
        const dateB = b.date?.toMillis
          ? b.date.toMillis()
          : new Date(b.date).getTime();

        if (dateA !== dateB) {
          return dateA - dateB;
        }

        const timeA = a.startTime?.toMillis
          ? a.startTime.toMillis()
          : new Date(a.startTime).getTime();
        const timeB = b.startTime?.toMillis
          ? b.startTime.toMillis()
          : new Date(b.startTime).getTime();
        return timeA - timeB;
      });

    const decoratedLectures = filteredLectures.map((lecture) => {
      const courseInfo = enrolledCourses.find(
        (c) => c.courseId === lecture.courseId,
      );
      return {
        ...lecture,
        courseCode: courseInfo?.courseCode,
        courseTitle: courseInfo?.courseTitle,
      };
    });

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json({ success: true, data: decoratedLectures });
  } catch (error) {
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: error.message });
  }
};
export const fetchAllCourseAssessments = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllCourseAssessmentsController";
  const action = "fetchAllCourseAssessments";
  try {
    const { courseId } = req.params;
    const snapshot = await Assessment.where("courseId", "==", courseId)
      .orderBy("updatedAt", "desc")
      .get();

    const assessments = snapshot.docs.map((doc) => {
      const data = doc.data();
      const { __v, ...rest } = data;
      return {
        id: doc.id,
        ...rest,
      };
    });

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json({
      success: true,
      count: assessments.length,
      data: assessments,
    });
  } catch (error) {
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: error.message });
  }
};
export const getTransactionById = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getTransactionByIdController";
  const action = "getTransactionById";
  try {
    const { transactionId } = req.params;
    const currentUserId = req.user.id || req.user.uid;

    if (!transactionId) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Transaction ID parameter is required",
        ),
      );
      return res.status(400).json({
        success: false,
        message: "Transaction ID parameter is required",
      });
    }

    let transactionSnapshot = await Transactions.where(
      "transactionId",
      "==",
      transactionId,
    )
      .limit(1)
      .get();

    // Older records (e.g. early payouts) have no transactionId field; the
    // app then sends the document id, so fall back to it.
    if (transactionSnapshot.empty) {
      const byDocId = await Transactions.doc(transactionId).get();
      if (byDocId.exists) {
        transactionSnapshot = { empty: false, docs: [byDocId] };
      }
    }

    if (transactionSnapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Transaction detail not found",
        ),
      );
      return res.status(404).json({
        success: false,
        message: "Transaction detail not found",
      });
    }

    const transactionDoc = transactionSnapshot.docs[0];
    const transaction = {
      id: transactionDoc.id,
      ...transactionDoc.data(),
    };

    const isOwner = transaction.userId === currentUserId;
    const isSender = transaction.metadata?.senderId === currentUserId;
    const isRecipient = transaction.metadata?.recipientId === currentUserId;

    if (!isOwner && !isSender && !isRecipient) {
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized access to this transaction record",
        ),
      );
      return res.status(403).json({
        success: false,
        message: "Unauthorized access to this transaction record",
      });
    }

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    return res.status(200).json({
      success: true,
      data: transaction,
      message: "Success",
    });
  } catch (error) {
    console.error("Backend getTransactionById Error:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};
export const getUserPreferences = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getUserPreferencesController";
  const action = "getUserPreferences";
  const userId = req.user?.uid || req.user?.id;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, error: "Unauthorized user context." });
  }

  try {
    const prefsQuery = await userPrefs
      .where("userId", "==", userId)
      .limit(1)
      .get();

    let preferences;

    if (prefsQuery.empty) {
      preferences = normalizePreferences({
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      const doc = prefsQuery.docs[0];
      preferences = normalizePreferences({ id: doc.id, ...doc.data() });
    }

    res.status(200).json({
      success: true,
      preferences,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in getUserPreferences:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res
      .status(500)
      .json({ success: false, error: "Server error fetching preferences" });
  }
};
export const fetchStudentsEnrolledCourses = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchStudentsEnrolledCoursesController";
  const action = "fetchStudentsEnrolledCourses";
  try {
    const { semester, session, page = 1, limit = 10 } = req.query;
    const userId = req.user?.uid;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let queryRef = Course.where(
      "studentsEnrolled",
      "array-contains",
      userId,
    ).where("isActive", "==", true);

    if (semester && semester !== "All") {
      queryRef = queryRef.where("semester", "==", semester);
    }
    if (session && session !== "All") {
      queryRef = queryRef.where("session", "==", session);
    }
    queryRef = queryRef.orderBy("createdAt", "desc").limit(limitNum);

    if (skip > 0) {
      queryRef = queryRef.offset(skip);
    }
    const snapshot = await queryRef.get();

    if (snapshot.empty) {
      setImmediate(() =>
        logControllerPerformance(controllerName, action, startTime, "success"),
      );
      return res.status(200).json([]);
    }
    const rawCourses = snapshot.docs.map((doc) => ({
      id: doc.id,
      courseId: doc.id,
      ...doc.data(),
    }));
    const paginatedCourses = await Promise.all(
      rawCourses.map((course) => embedCourseInstructor(course)),
    );
    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json(paginatedCourses);
  } catch (error) {
    console.error("Error in fetchStudentsEnrolledCourses:", error);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({ message: "Error fetching your courses" });
  }
};
export const getAds = async (req, res) => {
  try {
    const snapshot = await Ads.where("isActive", "==", true)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    const ads = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.status(200).json({
      success: true,
      data: ads,
    });
  } catch (error) {
    console.error("Fetch Ads Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
export const fetchSingleNotification = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchSingleNotificationController";
  const action = "fetchSingleNotification";
  try {
    console.log("Step 1: Fetching single notification...");
    const { id } = req.params;
    const userId = req.user.uid;
    const querySnapshot = await Notification.where("notificationId", "==", id)
      .where("recipientId", "==", userId)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      console.log("Notification not found...");
      setImmediate(() =>
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Notification not found",
        ),
      );
      return res.status(404).json({
        message: "Notification not found",
        notification: null,
      });
    }

    const docRef = querySnapshot.docs[0].ref;
    const notificationData = querySnapshot.docs[0].data();
    console.log("Step 2: Processing notification data...");
    if (!notificationData.isRead) {
      docRef
        .update({ isRead: true })
        .catch((err) =>
          console.error("Failed to mark notification as read:", err.message),
        );
      notificationData.isRead = true;
    }
    console.log("Step 3: Notification data processed.");

    const notification = {
      id: querySnapshot.docs[0].id,
      ...notificationData,
    };
    console.log("Step 4: Returning notification data...");

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    res.status(200).json({
      success: true,
      notification,
    });
  } catch (error) {
    console.error("Error fetching single notification:", error.message);
    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    res.status(500).json({
      success: false,
      message: "Server error fetching notification details",
    });
  }
};
export const fetchLecturerEnrolledCourses = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchLecturerEnrolledCoursesController";
  const action = "fetchLecturerEnrolledCourses";
  try {
    const { semester, session, page = 1, limit = 10 } = req.query;
    const lecturerId = req.user?.uid;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    let queryRef = Course.where(
      "lecturerIds",
      "array-contains",
      lecturerId,
    ).where("isActive", "==", true);

    if (semester && semester !== "All") {
      queryRef = queryRef.where("semester", "==", semester);
    }
    if (session && session !== "All") {
      queryRef = queryRef.where("session", "==", session);
    }
    queryRef = queryRef.orderBy("createdAt", "desc").limit(limitNum);

    if (skip > 0) {
      queryRef = queryRef.offset(skip);
    }
    const snapshot = await queryRef.get();

    if (snapshot.empty) {
      console.log("--- 3. Query finished. Found documents count: 0 ---");
      setImmediate(() =>
        logControllerPerformance(controllerName, action, startTime, "success"),
      );
      return res.status(200).json([]);
    }

    const courses = snapshot.docs.map((doc) => ({
      id: doc.id,
      courseId: doc.id,
      ...doc.data(),
    }));

    console.log(
      `--- 3. Query finished. Found documents count: ${courses.length} ---`,
    );

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    return res.status(200).json(courses);
  } catch (error) {
    console.error("--- ❌ LECTURER COURSES ERROR CAUGHT ---");
    console.error("Error Message:", error.message);
    console.error("Error Stack:", error.stack);

    setImmediate(() =>
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      ),
    );
    return res.status(500).json({ message: "Error fetching lecturer courses" });
  }
};
export const fetchProfileContent = async (req, res) => {
  try {
    const viewer = req.user || {};
    const tab = PROFILE_TABS.includes(req.query.tab) ? req.query.tab : "Posts";
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 30);
    const target = await findProfileTarget(req.params.uid);
    if (!target) return res.status(404).json({ success: false, message: "User not found" });

    const isOwner = (viewer.uid || viewer.id) === target.uid;
    if (
      !isOwner &&
      ((viewer.blockedUsers || []).includes(target.uid) ||
        (target.blockedUsers || []).includes(viewer.uid || viewer.id))
    ) {
      return res.status(403).json({ success: false, message: "This profile isn't available." });
    }
    if (tab === "Bookmarks" && !isOwner) {
      return res.status(403).json({ success: false, message: "Bookmarks are private." });
    }

    const page = await loadProfileContentPage({
      tab,
      target,
      viewer,
      limit,
      cursor: req.query.cursor ? String(req.query.cursor) : null,
    });
    return res.status(200).json({ success: true, tab, ...page });
  } catch (error) {
    console.error("Profile content error:", error.message);
    return res.status(500).json({ success: false, message: "Could not load this tab." });
  }
};
export const fetchProfileConnections = async (req, res) => {
  try {
    const viewer = req.user || {};
    const viewerUid = viewer.uid || viewer.id;
    const type = req.query.type === "following" ? "following" : "followers";
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 50);
    const offset = Math.max(parseInt(req.query.cursor) || 0, 0);
    const target = await findProfileTarget(req.params.uid);
    if (!target) return res.status(404).json({ success: false, message: "User not found" });

    const [matchField, otherField] =
      type === "followers" ? ["followingId", "followerId"] : ["followerId", "followingId"];
    const snap = await Follow.where(matchField, "==", target.uid)
      .select(otherField, "createdAt")
      .get();
    const ordered = snap.docs
      .map((doc) => ({ uid: doc.get(otherField), ms: millisOf(doc.get("createdAt")) }))
      .filter((r) => r.uid)
      .sort((a, b) => b.ms - a.ms);
    const pageIds = ordered.slice(offset, offset + limit).map((r) => r.uid);
    const users = await loadUsersByUid(pageIds);

    // Whether the viewer follows each listed person (drives the row button).
    const viewerFollows = new Set();
    if (viewerUid && pageIds.length) {
      const followSnap = await Follow.where("followerId", "==", viewerUid)
        .where("followingId", "in", pageIds.slice(0, 30))
        .get();
      followSnap.docs.forEach((d) => viewerFollows.add(d.get("followingId")));
    }

    return res.status(200).json({
      success: true,
      type,
      users: pageIds
        .map((uid) => users.get(uid))
        .filter(Boolean)
        .map((u) => ({ ...u, isFollowingByViewer: viewerFollows.has(u.uid) })),
      nextCursor: offset + limit < ordered.length ? String(offset + limit) : null,
      total: ordered.length,
    });
  } catch (error) {
    console.error("Profile connections error:", error.message);
    return res.status(500).json({ success: false, message: "Could not load this list." });
  }
};

// ---------------------------------------------------------------------------
// Profile helpers (used by fetchProfileInformation and the paged endpoints)
// ---------------------------------------------------------------------------
const PROFILE_TABS = ["Posts", "Reposts", "Media", "Jobs", "Events", "Bookmarks"];
// Fields anyone may see on a profile. The whole user document used to be
// sent, including sessions, phone numbers, recovery emails and likes.
const PUBLIC_PROFILE_FIELDS = [
  "uid", "firstname", "lastname", "username", "profilePic", "tier", "isVerified",
  "usertype", "organizationName", "headline", "bio", "skills", "website",
  "jobTitle", "department", "schoolName", "current_level", "country", "email",
  "createdAt",
];
const toProfileView = (user) =>
  Object.fromEntries(
    PUBLIC_PROFILE_FIELDS.filter((k) => user[k] !== undefined).map((k) => [k, user[k]]),
  );

const millisOf = (v) =>
  v?.toMillis
    ? v.toMillis()
    : v?._seconds
      ? v._seconds * 1000
      : new Date(v || 0).getTime() || 0;

/** Resolves a profile by uid, username, first or last name. */
const findProfileTarget = async (identifier) => {
  if (!identifier) return null;
  const snap = await User.where(
    Filter.or(
      Filter.where("uid", "==", identifier),
      Filter.where("username", "==", identifier),
      Filter.where("firstname", "==", identifier),
      Filter.where("lastname", "==", identifier),
    ),
  )
    .limit(1)
    .get();
  if (snap.empty) return null;
  const data = snap.docs[0].data();
  return { ...data, uid: data.uid || snap.docs[0].id };
};

const loadPostsByPostIds = async (postIds) => {
  const byId = new Map();
  const unique = [...new Set(postIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 30) {
    const snap = await Posts.where("postId", "in", unique.slice(i, i + 30)).get();
    snap.docs.forEach((doc) => byId.set(doc.get("postId"), { id: doc.id, ...doc.data() }));
  }
  return byId;
};

// Light fields for ordering and visibility checks; the full post (and its
// comments/reposters) is only loaded for the page being returned.
const POST_INDEX_FIELDS = [
  "postId", "createdAt", "postType", "media", "status", "audience",
  "schoolCode", "originalAuthor",
];
const TAB_FILTERS = {
  Posts: () => true,
  Media: (p) => Array.isArray(p.media?.url) ? p.media.url.length > 0 : !!p.media?.url,
  Jobs: (p) => p.postType === "job",
  Events: (p) => p.postType === "event",
};

/**
 * One page of a profile tab, newest first. Cursors are opaque strings:
 * `${millis}_${id}` for authored posts and reposts, an offset for bookmarks.
 */
const loadProfileContentPage = async ({ tab, target, viewer, limit, cursor = null }) => {
  const viewerUid = viewer?.uid || viewer?.id;
  const afterCursor = (rows) => {
    if (!cursor) return rows;
    const [ms, id] = cursor.split("_");
    const cursorMs = Number(ms);
    return rows.filter((r) => r.ms < cursorMs || (r.ms === cursorMs && r.id < id));
  };
  const byNewest = (a, b) => b.ms - a.ms || (b.id < a.id ? -1 : 1);

  if (tab === "Reposts") {
    const snap = await PostReposters.where("uid", "==", target.uid)
      .select("postId", "repostedAt")
      .get();
    const rows = afterCursor(
      snap.docs.map((d) => ({ id: d.id, postId: d.get("postId"), ms: millisOf(d.get("repostedAt")) })),
    ).sort(byNewest);
    const page = rows.slice(0, limit);
    const posts = await loadPostsByPostIds(page.map((r) => r.postId));
    const visible = page.map((r) => posts.get(r.postId)).filter((p) => p && canViewPost(p, viewer));
    const items = await enrichPosts(visible, viewerUid, { featuredReposterUid: target.uid });
    const last = page[page.length - 1];
    return {
      items: items.map((p) => ({ ...p, isRepost: true })),
      nextCursor: rows.length > limit && last ? `${last.ms}_${last.id}` : null,
    };
  }

  if (tab === "Bookmarks") {
    // Most recently bookmarked first (ids are appended as they're saved).
    const ids = [...(target.bookmarks || [])].reverse();
    const offset = Math.max(parseInt(cursor) || 0, 0);
    const pageIds = ids.slice(offset, offset + limit);
    const posts = await loadPostsByPostIds(pageIds);
    const visible = pageIds.map((id) => posts.get(id)).filter((p) => p && canViewPost(p, viewer));
    return {
      items: await enrichPosts(visible, viewerUid),
      nextCursor: offset + limit < ids.length ? String(offset + limit) : null,
    };
  }

  const matches = TAB_FILTERS[tab] || TAB_FILTERS.Posts;
  const snap = await Posts.where("originalAuthor", "==", target.uid)
    .select(...POST_INDEX_FIELDS)
    .get();
  const rows = afterCursor(
    snap.docs
      .map((d) => ({ id: d.id, data: d.data(), ms: millisOf(d.get("createdAt")) }))
      .filter((r) => canViewPost(r.data, viewer) && matches(r.data)),
  ).sort(byNewest);
  const page = rows.slice(0, limit);
  const full = await Promise.all(page.map((r) => Posts.doc(r.id).get()));
  const posts = full.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() }));
  const last = page[page.length - 1];
  return {
    items: await enrichPosts(posts, viewerUid),
    nextCursor: rows.length > limit && last ? `${last.ms}_${last.id}` : null,
  };
};
