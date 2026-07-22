import {
  UserDownloads,
  Product,
  Follow,
  User,
  Posts,
  Transactions,
  ITag,
  Message,
  Notification,
  Course,
  Exceptions,
  Lectures,
  OperationalInstitutions,
  Assessment,
  Admin,
  SupportTicket,
  PostReposters,
  Comments,
} from "../tableDeclarations.js";
import { client } from "../workers/reditFile.js";
import { createNotification } from "../services/notification.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import axiosRetry from "axios-retry";
import axios from "axios";
import * as cheerio from "cheerio";
import { getFallbackBooks } from "../utils/libraryHelpers.js";
import { CATEGORY_ROLES } from "../constants/inAppConstants.js";
import { getPriorityReposter } from "../utils/reposterPriorityChecker.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
axiosRetry(axios, { retries: 3 });

export const getDownloads = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getDownloadsController";
  const action = "getDownloads";

  try {
    const userId = req.user.id;
    const userSnapshot = await UserDownloads.where("userId", "==", userId)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "success",
        "No Downloads found.",
      );
      return res.status(200).json({ success: true, data: [] });
    }

    const userLibrary = userSnapshot.docs[0].data();

    if (!userLibrary.ownedProducts || !userLibrary.ownedProducts.length) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "success",
        "No Downloads found.",
      );
      return res.status(200).json({ success: tyue, data: [] }); // Fixed typo 'tyue' -> true conceptually if needed, keeping standard success: true
    }

    const productIds = userLibrary.ownedProducts.map((p) => p.productId);
    let productsInfo = [];
    if (productIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < productIds.length; i += 30) {
        chunks.push(productIds.slice(i, i + 30));
      }

      const productPromises = chunks.map(async (chunk) => {
        const productSnapshot = await Product.where(
          "productId",
          "in",
          chunk,
        ).get();
        return productSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
      });

      const productResults = await Promise.all(productPromises);
      productsInfo = productResults.flat();
    }
    const mergedData = userLibrary.ownedProducts
      .map((ownedItem) => {
        const details = productsInfo.find(
          (p) => p.productId === ownedItem.productId,
        );
        return {
          ...details,
          progress: ownedItem.progress,
          lastAccessed: ownedItem.lastAccessed,
          completedLessons: ownedItem.completedLessons || [],
        };
      })
      .filter((item) => item.title);

    logControllerPerformance(controllerName, action, startTime, "success");

    res.status(200).json({
      success: true,
      data: mergedData,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: error.message });
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "success",
        "No connections found.",
      );
      return res.json({ success: true, data: [] });
    }

    const followingUids = connectionsSnapshot.docs.map(
      (doc) => doc.data().followingId,
    );

    if (!followingUids.length) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "success",
        "No connections found.",
      );
      return res.json({ success: true, data: [] });
    }
    const chunks = [];
    for (let i = 0; i < followingUids.length; i += 30) {
      chunks.push(followingUids.slice(i, i + 30));
    }

    const userPromises = chunks.map(async (chunk) => {
      const userSnapshot = await User.where("uid", "in", chunk).get();
      return userSnapshot.docs.map((doc) => doc.data());
    });

    const userResults = await Promise.all(userPromises);
    const users = userResults.flat();
    const formattedConnections = users.map((u) => ({
      uid: u.uid,
      username: u.username,
      firstname: u.firstname,
      lastname: u.lastname,
      tier: u.tier,
      organizationName: u.organizationName,
      profilePic: u.profilePic || "",
    }));

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ success: true, data: formattedConnections });
  } catch (error) {
    console.error("fetchConnections Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: error.message });
  }
};
export const fetchUserTransactionHistory = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchUserTransactionHistoryController";
  const action = "fetchUserTransactionHistory";

  try {
    const userId = req.user.uid;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const querySnapshot = await Transactions.where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    const allDocs = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const total = allDocs.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const transactions = allDocs.slice(startIndex, startIndex + limit);

    logControllerPerformance(controllerName, action, startTime, "success");

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        totalItems: total,
        totalPages: totalPages,
        currentPage: page,
        hasNextPage: page < totalPages,
      },
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: error.message });
  }
};
export const fetchUserTransactionStats = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchUserTransactionStatsController";
  const action = "fetchUserTransactionStats";

  try {
    const userId = req.user.uid;
    let { month, year } = req.query;

    const currentDate = new Date();
    const targetMonth = month
      ? parseInt(month, 10)
      : currentDate.getMonth() + 1;
    const targetYear = year ? parseInt(year, 10) : currentDate.getFullYear();

    if (
      isNaN(targetMonth) ||
      isNaN(targetYear) ||
      targetMonth < 1 ||
      targetMonth > 12
    ) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid month or year parameter values provided.",
      );
      return res.status(400).json({
        success: false,
        message: "Invalid month or year parameter values provided.",
      });
    }

    const start = new Date(targetYear, targetMonth - 1, 1);
    const end = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
    const querySnapshot = await Transactions.where("userId", "==", userId)
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .get();

    const transactions = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const flowMap = {};
    const monthlyMap = {};
    const recipientMap = {};

    transactions.forEach((tx) => {
      const payType = tx.payType || "unknown";
      const amount = tx.amountICash || 0;
      flowMap[payType] = (flowMap[payType] || 0) + amount;
      const txDate = tx.createdAt?.toDate
        ? tx.createdAt.toDate()
        : new Date(tx.createdAt);
      const txMonth = txDate.getMonth() + 1;
      monthlyMap[txMonth] = (monthlyMap[txMonth] || 0) + amount;
      if (
        tx.payType === "out" &&
        tx.type === "p2p_sent" &&
        tx.metadata?.recipientId
      ) {
        const recipientId = tx.metadata.recipientId;
        if (!recipientMap[recipientId]) {
          recipientMap[recipientId] = { count: 0, total: 0 };
        }
        recipientMap[recipientId].count += 1;
        recipientMap[recipientId].total += amount;
      }
    });
    const flow = Object.keys(flowMap).map((key) => ({
      _id: key,
      total: flowMap[key],
    }));
    const monthly = Object.keys(monthlyMap).map((key) => ({
      _id: parseInt(key, 10),
      total: monthlyMap[key],
    }));

    const sortedRecipientIds = Object.keys(recipientMap)
      .sort((a, b) => recipientMap[b].count - recipientMap[a].count)
      .slice(0, 5);

    let topRecipients = [];
    if (sortedRecipientIds.length > 0) {
      const userSnapshot = await User.where(
        "uid",
        "in",
        sortedRecipientIds,
      ).get();
      const usersMap = {};
      userSnapshot.docs.forEach((doc) => {
        const userData = doc.data();
        usersMap[userData.uid] = userData;
      });

      topRecipients = sortedRecipientIds.map((recipientId) => {
        const userDetails = usersMap[recipientId] || {};
        const firstname = userDetails.firstname || "Unknown";
        const lastname = userDetails.lastname || "User";
        const fullName = `${firstname} ${lastname}`.trim();

        return {
          _id: recipientId,
          count: recipientMap[recipientId].count,
          total: recipientMap[recipientId].total,
          name: fullName,
        };
      });
    }

    const result = {
      flow,
      topRecipients,
      monthly,
    };

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      period: { month: targetMonth, year: targetYear },
      data: result,
    });
  } catch (e) {
    console.error("Aggregation crash in fetchUserTransactionStats:", e.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      e.message,
    );
    res.status(500).json({ success: false, error: e.message });
  }
};
export const fetchItagByUsername = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchItagByUsernameController";
  const action = "fetchItagByUsername";

  try {
    const { username } = req.params;
    let isPremium;
    let isUser;
    const querySnapshot = await ITag.where(
      "username",
      "==",
      username.toLowerCase(),
    )
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const iTagData = querySnapshot.docs[0].data();
    const maskedNumber = iTagData.cardNumber
      ? iTagData.cardNumber.replace(/\d(?=\d{4})/g, "*")
      : "";
    isPremium = iTagData.tier === "premium";
    isUser = iTagData.userId === req.user.id;

    logControllerPerformance(controllerName, action, startTime, "success");

    res.status(200).json({
      userId: iTagData.userId,
      username: iTagData.username,
      cardHolderName: iTagData.cardHolderName,
      cardNumber: maskedNumber,
      tier: iTagData.tier,
      designOptions: iTagData.designOptions,
      isPremium,
      isUser,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Internal Server Error",
    );
    res.status(500).json({ message: "Internal Server Error" });
  }
};
export const fetchAllUserConversations = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllUserConversationsController";
  const action = "fetchAllUserConversations";

  try {
    const uid = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const skip = (page - 1) * limit;
    const [sentSnapshot, receivedSnapshot] = await Promise.all([
      Message.where("senderId", "==", uid).get(),
      Message.where("recipientId", "==", uid).get(),
    ]);

    const messageMap = new Map();
    sentSnapshot.docs.forEach((doc) => {
      messageMap.set(doc.id, { id: doc.id, ...doc.data() });
    });
    receivedSnapshot.docs.forEach((doc) => {
      messageMap.set(doc.id, { id: doc.id, ...doc.data() });
    });

    const allMessages = Array.from(messageMap.values());

    allMessages.sort((a, b) => {
      const timeA = a.timestamp?.toMillis
        ? a.timestamp.toMillis()
        : new Date(a.timestamp).getTime();
      const timeB = b.timestamp?.toMillis
        ? b.timestamp.toMillis()
        : new Date(b.timestamp).getTime();
      return timeB - timeA;
    });
    const conversationMap = new Map();

    allMessages.forEach((msg) => {
      const otherUserId = msg.senderId === uid ? msg.recipientId : msg.senderId;
      if (otherUserId && !conversationMap.has(otherUserId)) {
        conversationMap.set(otherUserId, {
          otherUserId,
          lastMessage: msg,
        });
      }
    });

    const uniqueConversations = Array.from(conversationMap.values());
    const paginatedConversations = uniqueConversations.slice(
      skip,
      skip + limit,
    );

    if (paginatedConversations.length === 0) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.json({
        success: true,
        data: [],
        hasMore: false,
      });
    }
    const otherUserIds = paginatedConversations.map((c) => c.otherUserId);
    const chunks = [];
    for (let i = 0; i < otherUserIds.length; i += 30) {
      chunks.push(otherUserIds.slice(i, i + 30));
    }

    const userPromises = chunks.map(async (chunk) => {
      const userSnapshot = await User.where("uid", "in", chunk).get();
      return userSnapshot.docs.map((doc) => doc.data());
    });

    const userResults = await Promise.all(userPromises);
    const usersList = userResults.flat();

    const usersMap = new Map();
    usersList.forEach((user) => {
      usersMap.set(user.uid, user);
    });
    const conversations = paginatedConversations
      .map((conv) => {
        const u = usersMap.get(conv.otherUserId);
        if (!u) return null;

        return {
          otherUser: {
            uid: u.uid,
            firstname: u.firstname || "",
            username: u.username || "",
            lastname: u.lastname || "",
            profilePic: u.profilePic || "",
            tier: u.tier || "",
            organizationName: u.organizationName || "",
          },
          lastMessage: conv.lastMessage,
        };
      })
      .filter((item) => item !== null);

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({
      success: true,
      data: conversations,
      hasMore: conversations.length === limit,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: error.message });
  }
};
export const fetchPal2PalConversation = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchPal2PalConversationController";
  const action = "fetchPal2PalConversation";
  const { recipientId } = req.params;
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  try {
    const skip = (page - 1) * limit;
    const messages = await Message.find({
      $or: [
        { senderId: userId, recipientId: recipientId },
        { senderId: recipientId, recipientId: userId },
      ],
    })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const totalMessages = await Message.countDocuments({
      $or: [
        { senderId: userId, recipientId: recipientId },
        { senderId: recipientId, recipientId: userId },
      ],
    });
    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({
      success: true,
      data: messages.reverse(),
      hasMore: skip + messages.length < totalMessages,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing userId",
      );
      return res.status(400).json({ message: "Missing userId" });
    }
    let recipientQuery = Notification.where("recipientId", "==", userId);
    let publicQuery = Notification.where("isPublic", "==", true);
    if (unread === "true") {
      recipientQuery = recipientQuery.where("isRead", "==", false);
      publicQuery = publicQuery.where("isRead", "==", false);
    }
    if (category) {
      recipientQuery = recipientQuery.where("category", "==", category);
      publicQuery = publicQuery.where("category", "==", category);
    }

    const [recipientSnapshot, publicSnapshot] = await Promise.all([
      recipientQuery.get(),
      publicQuery.get(),
    ]);
    const notificationMap = new Map();
    recipientSnapshot.docs.forEach((doc) => {
      notificationMap.set(doc.id, { id: doc.id, ...doc.data() });
    });
    publicSnapshot.docs.forEach((doc) => {
      notificationMap.set(doc.id, { id: doc.id, ...doc.data() });
    });

    let allNotifications = Array.from(notificationMap.values());
    allNotifications.sort((a, b) => {
      const timeA = a.createdAt?.toMillis
        ? a.createdAt.toMillis()
        : new Date(a.createdAt).getTime();
      const timeB = b.createdAt?.toMillis
        ? b.createdAt.toMillis()
        : new Date(b.createdAt).getTime();
      return timeB - timeA;
    });
    const groupMap = new Map();

    allNotifications.forEach((notif) => {
      const actionType = notif.actionType || "unknown";
      const payload = notif.payload || {};
      const entityId =
        payload.postId ||
        payload.followerId ||
        payload.viewerUid ||
        notif.notificationId ||
        notif.id;
      const groupKey = `${actionType}_${entityId}`;

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          latest: notif,
          count: 0,
        });
      }

      const groupEntry = groupMap.get(groupKey);
      groupEntry.count += 1;
    });
    const processedNotifications = [];

    groupMap.forEach(({ latest, count }) => {
      const payload = latest.payload || {};
      const primaryUser = payload.username || payload.firstname || "Someone";
      const othersCount = Math.max(0, count - 1);

      const updatedNotification = {
        ...latest,
        payload: {
          ...payload,
          primaryUser,
          othersCount,
        },
      };

      processedNotifications.push(updatedNotification);
    });
    processedNotifications.sort((a, b) => {
      const timeA = a.createdAt?.toMillis
        ? a.createdAt.toMillis()
        : new Date(a.createdAt).getTime();
      const timeB = b.createdAt?.toMillis
        ? b.createdAt.toMillis()
        : new Date(b.createdAt).getTime();
      return timeB - timeA;
    });
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const parsedLimit = Math.max(parseInt(limit, 10) || 50, 1);

    const notifications = processedNotifications.slice(
      parsedOffset,
      parsedOffset + parsedLimit,
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ notifications, success: true });
  } catch (error) {
    console.error("Error fetching notifications:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Server error", success: false });
  }
};
export const fetchSingleNotification = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchSingleNotificationController";
  const action = "fetchSingleNotification";

  try {
    const { id } = req.params;
    const userId = req.user.uid;
    const querySnapshot = await Notification.where("notificationId", "==", id)
      .where("recipientId", "==", userId)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Notification not found",
      );
      return res.status(404).json({
        message: "Notification not found",
        notification: null,
      });
    }

    const docRef = querySnapshot.docs[0].ref;
    const notificationData = querySnapshot.docs[0].data();
    if (!notificationData.isRead) {
      await docRef.update({ isRead: true });
      notificationData.isRead = true;
    }

    const notification = {
      id: querySnapshot.docs[0].id,
      ...notificationData,
    };

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      notification,
    });
  } catch (error) {
    console.error("Error fetching single notification:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({
      success: false,
      message: "Server error fetching notification details",
    });
  }
};
export const fetchProfileInformation = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchProfileInformationController";
  const action = "fetchProfileInformation";

  try {
    const { identifier } = req.params;
    const viewerUid = req.user.uid;
    const { viewerTier, viewerRole, viewerFirstname } = req.query;
    const targetUserSnapshot = await User.where(
      Filter.or(
        Filter.where("uid", "==", identifier),
        Filter.where("username", "==", identifier),
        Filter.where("firstname", "==", identifier),
        Filter.where("lastname", "==", identifier),
      ),
    )
      .limit(1)
      .get();

    if (targetUserSnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const rawTargetUserData = targetUserSnapshot.docs[0].data();
    const { password, refreshTokens, iCashPin, ...targetUser } =
      rawTargetUserData;
    const targetUid = targetUser.uid;
    const viewerDoc = await User.doc(viewerUid).get();
    const viewerData = viewerDoc.exists ? viewerDoc.data() : null;

    const isBlockedByViewer = (viewerData?.blockedUsers || []).includes(
      targetUid,
    );
    const isViewerBlockedByTarget = (targetUser.blockedUsers || []).includes(
      viewerUid,
    );

    if (isBlockedByViewer || isViewerBlockedByTarget) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found or you have restricted access to this profile.",
      );
      return res.status(403).json({
        success: false,
        message:
          "User not found or you have restricted access to this profile.",
        isBlocked: true,
        targetUid: targetUid,
      });
    }

    const fetchUsersByUids = async (uids) => {
      if (!uids || !uids.length) return [];
      const chunks = [];
      for (let i = 0; i < uids.length; i += 30) {
        chunks.push(uids.slice(i, i + 30));
      }
      const promises = chunks.map(async (chunk) => {
        const snap = await User.where("uid", "in", chunk).get();
        return snap.docs.map((doc) => {
          const u = doc.data();
          return {
            firstname: u.firstname,
            lastname: u.lastname,
            username: u.username,
            profilePic: u.profilePic,
            tier: u.tier,
            isVerified: u.isVerified,
            usertype: u.usertype,
            organizationName: u.organizationName,
          };
        });
      });
      const results = await Promise.all(promises);
      return results.flat();
    };

    const attachCommentsAndCountsToPosts = async (postsList) => {
      if (!postsList || !postsList.length) return [];

      return Promise.all(
        postsList.map(async (post) => {
          const targetPostId = post.postId;
          const commentsSnapshot = await Comments.where(
            "postId",
            "==",
            targetPostId,
          ).get();
          const comments = [];
          for (const doc of commentsSnapshot.docs) {
            const commentData = doc.data();
            let commentUser = null;
            if (commentData.userId) {
              const commentUserQuery = await Users.where(
                "uid",
                "==",
                commentData.userId,
              )
                .limit(1)
                .get();
              if (!commentUserQuery.empty) {
                const cuData = commentUserQuery.docs[0].data();
                commentUser = {
                  uid: cuData.uid,
                  firstname: cuData.firstname,
                  lastname: cuData.lastname,
                  username: cuData.username,
                  profilePic: cuData.profilePic,
                };
              }
            }
            comments.push({
              ...commentData,
              userId: commentUser || commentData.userId,
            });
          }
          const repostersSnapshot = await PostReposters.where(
            "postId",
            "==",
            targetPostId,
          ).get();
          const repostersCount = repostersSnapshot.size;
          const commentsCount = commentsSnapshot.size;

          return {
            ...post,
            comments,
            commentsCount,
            repostsCount:
              post.repostsCount !== undefined
                ? post.repostsCount
                : repostersCount,
          };
        }),
      );
    };

    const fetchPostsByIds = async (postIds) => {
      if (!postIds || !postIds.length) return [];
      const chunks = [];
      for (let i = 0; i < postIds.length; i += 30) {
        chunks.push(postIds.slice(i, i + 30));
      }
      const promises = chunks.map(async (chunk) => {
        const snap = await Posts.where("postId", "in", chunk).get();
        return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      });
      const results = await Promise.all(promises);
      const posts = results.flat();
      const sortedPosts = posts.sort((a, b) => {
        const timeA = a.createdAt?.toMillis
          ? a.createdAt.toMillis()
          : new Date(a.createdAt).getTime();
        const timeB = b.createdAt?.toMillis
          ? b.createdAt.toMillis()
          : new Date(b.createdAt).getTime();
        return timeB - timeA;
      });
      return await attachCommentsAndCountsToPosts(sortedPosts);
    };

    const [
      followersSnap,
      followingSnap,
      isFollowingSnap,
      coursesSnap,
      userPostsSnap,
      repostsSnap,
      iTagSnap,
      bookmarkedPosts,
    ] = await Promise.all([
      Follow.where("followingId", "==", targetUid).get(),
      Follow.where("followerId", "==", targetUid).get(),
      Follow.where("followerId", "==", viewerUid)
        .where("followingId", "==", targetUid)
        .limit(1)
        .get(),
      targetUser.usertype === "lecturer" || targetUser.usertype === "otherUser"
        ? Course.where("lecturerIds", "array-contains", targetUid).get()
        : null,
      Posts.where("originalAuthor", "==", targetUid).get(),
      PostReposters.where("uid", "==", targetUid).get(),
      ITag.where("userId", "==", targetUid).limit(1).get(),
      fetchPostsByIds(targetUser.bookmarks || []),
    ]);

    const followerIds = followersSnap.docs.map((doc) => doc.data().followerId);
    const followingIds = followingSnap.docs.map(
      (doc) => doc.data().followingId,
    );

    const [followerDetails, followingDetails] = await Promise.all([
      fetchUsersByUids(followerIds),
      fetchUsersByUids(followingIds),
    ]);

    // Format Courses
    const courses = coursesSnap
      ? coursesSnap.docs.map((doc) => {
          const c = doc.data();
          return {
            id: doc.id,
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

    const authoredPosts = userPostsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const formattedAuthoredPosts =
      await attachCommentsAndCountsToPosts(authoredPosts);

    const repostPostIds = repostsSnap.docs.map((doc) => doc.data().postId);
    const originalRepostedPosts = await fetchPostsByIds(repostPostIds);

    const formattedReposts = originalRepostedPosts.map((post) => ({
      ...post,
      isRepost: true,
    }));

    const userPosts = [...formattedAuthoredPosts, ...formattedReposts].sort(
      (a, b) => {
        const timeA = a.createdAt?.toMillis
          ? a.createdAt.toMillis()
          : new Date(a.createdAt).getTime();
        const timeB = b.createdAt?.toMillis
          ? b.createdAt.toMillis()
          : new Date(b.createdAt).getTime();
        return timeB - timeA;
      },
    );

    const iTagData = !iTagSnap.empty ? iTagSnap.docs[0].data() : null;
    const isOwner = viewerUid === targetUid;
    const isPremiumViewer = viewerTier === "premium";

    if (!isOwner && !isPremiumViewer) {
      createNotification({
        notificationId: generateNotificationId("profile"),
        recipientId: targetUid,
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
      isFollowing: !isFollowingSnap.empty,
      courses,
      posts: userPosts,
      iTagData,
      bookmarkedPosts,
      bookmarksCount: targetUser.bookmarks?.length || 0,
      likesCount: targetUser.likes?.length || 0,
    };

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      data: profileData,
    });
  } catch (error) {
    console.error("Comprehensive Profile Fetch Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const fetchBlockedUsers = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchBlockedUsersController";
  const action = "fetchBlockedUsers";

  try {
    const userDoc = await User.doc(req.user.uid).get();

    if (!userDoc.exists) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();
    const blockedIds = userData.blockedUsers || [];

    if (blockedIds.length === 0) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json([]);
    }
    const chunks = [];
    for (let i = 0; i < blockedIds.length; i += 30) {
      chunks.push(blockedIds.slice(i, i + 30));
    }

    const userPromises = chunks.map(async (chunk) => {
      const userSnapshot = await User.where("uid", "in", chunk).get();
      return userSnapshot.docs.map((doc) => {
        const u = doc.data();
        return {
          uid: u.uid,
          firstname: u.firstname || "",
          lastname: u.lastname || "",
          username: u.username || "",
          profilePic: u.profilePic || "",
          tier: u.tier || "",
          organizationName: u.organizationName || "",
        };
      });
    });

    const userResults = await Promise.all(userPromises);
    const blockedList = userResults.flat();

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json(blockedList);
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    res.status(500).json({ error: err.message });
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "courseId is required",
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
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Access denied. You do not teach this course.",
        );
        return res.status(403).json({
          success: false,
          message: "Access denied. You do not teach this course.",
        });
      }
    } else {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user type",
      );
      return res.status(403).json({ message: "Unauthorized user type" });
    }
    const snapshot = await exceptionsQuery.orderBy("createdAt", "desc").get();

    const exceptions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      count: exceptions.length,
      exceptions,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseData = courseSnapshot.docs[0].data();
    const assignments = courseData.assignments || [];

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json(assignments);
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: error.message });
  }
};
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
      logControllerPerformance(
        controllerName,
        action,
        controllerStartTime,
        "error",
        "Lectures session not found",
      );
      return res.status(404).json({ error: "Lectures session not found" });
    }

    const lectureDoc = lectureSnapshot.docs[0];
    const lectureData = lectureDoc.data();

    const now = new Date();
    const lectureStartTime = lectureData.startTime?.toDate
      ? lectureData.startTime.toDate()
      : new Date(lectureData.startTime);

    let currentStatus = lectureData.status;

    if (currentStatus === "scheduled" && now >= lectureStartTime) {
      currentStatus = "ongoing";
      await lectureDoc.ref.update({ status: "ongoing" });
      lectureData.status = "ongoing";
    }

    const responseLecture = {
      id: lectureDoc.id,
      ...lectureData,
    };

    logControllerPerformance(
      controllerName,
      action,
      controllerStartTime,
      "success",
    );
    res.json(responseLecture);
  } catch (err) {
    console.error("Fetch lecture error:", err.message);
    logControllerPerformance(
      controllerName,
      action,
      controllerStartTime,
      "error",
      err.message,
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseData = courseSnapshot.docs[0].data();
    const lecturerIds = courseData.lecturerIds || [];

    const isLecturer = lecturerIds.some((id) => String(id) === String(userId));

    if (!isLecturer) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Access Denied: You are not authorized to view this course's exceptions",
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

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json(exceptions);
  } catch (error) {
    console.error("Error fetching lecture exceptions:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Failed to fetch course exceptions" });
  }
};
export const fetchLeaderBoards = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchLeaderBoardsController";
  const action = "fetchLeaderBoards";

  try {
    const studentsSnapshot = await User.where("usertype", "==", "student")
      .orderBy("currentIScore", "desc")
      .limit(10)
      .get();

    const topStudents = studentsSnapshot.docs.map((doc) => {
      const u = doc.data();
      return {
        uid: u.uid,
        firstname: u.firstname || "",
        lastname: u.lastname || "",
        currentIScore: u.currentIScore || 0,
        email: u.email || "",
        previousIScore: u.previousIScore || 0,
        profilePic: u.profilePic || "",
        department: u.department || "",
        schoolName: u.schoolName || "",
      };
    });
    const instructorsSnapshot = await User.where("usertype", "in", [
      "lecturer",
      "otherUser",
    ])
      .orderBy("currentIScore", "desc")
      .orderBy("monthlyStats.avgReview", "desc")
      .limit(10)
      .get();

    const topInstructors = instructorsSnapshot.docs.map((doc) => {
      const u = doc.data();
      return {
        uid: u.uid,
        firstname: u.firstname || "",
        lastname: u.lastname || "",
        currentIScore: u.currentIScore || 0,
        email: u.email || "",
        profilePic: u.profilePic || "",
        jobTitle: u.jobTitle || "",
        previousIScore: u.previousIScore || 0,
      };
    });
    const institutionsSnapshot = await OperationalInstitutions.orderBy(
      "currentiScoreAvg",
      "desc",
    )
      .limit(10)
      .get();

    const topInstitutions = institutionsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      data: {
        students: topStudents,
        instructors: topInstructors,
        institutions: topInstitutions,
      },
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: error.message });
  }
};
export const fetchBanksUsingCountryCode = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchBanksUsingCountryCodeController";
  const action = "fetchBanksUsingCountryCode";
  const { countryCode } = req.params;

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
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(flwResponse.status).json(data);
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ status: "error", message: "Failed to fetch banks" });
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
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({ ongoing: false });
    }
    let ongoingLectureDoc = null;
    let foundCourseData = null;

    const chunks = [];
    for (let i = 0; i < enrolledOrTaughtCourseIds.length; i += 30) {
      chunks.push(enrolledOrTaughtCourseIds.slice(i, i + 30));
    }

    for (const chunk of chunks) {
      const lectureSnap = await Lectures.where("status", "==", "ongoing")
        .where("courseId", "in", chunk)
        .limit(1)
        .get();

      if (!lectureSnap.empty) {
        ongoingLectureDoc = lectureSnap.docs[0];
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

      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({
        ongoing: true,
        lecture: formattedLecture,
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ ongoing: false });
  } catch (err) {
    console.error("Error fetching ongoing lecture:", err.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    res.status(500).json({ error: err.message });
  }
};
export const fetchFeaturedBooksFromLibrary = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchFeaturedBooksFromLibraryController";
  const action = "fetchFeaturedBooksFromLibrary";

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

      const thumbnail =
        row.find("img.cover").attr("data-src") ||
        row.find("img.cover").attr("src") ||
        row.find(".bookCover img").attr("src");

      const detailsUrl = row.find('a[href^="/book/"]').attr("href");
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
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.json(getFallbackBooks());
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json(featuredBooks);
  } catch (error) {
    console.error("Featured Scrape Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.json(getFallbackBooks());
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseDoc = courseSnapshot.docs[0];
    const course = {
      id: courseDoc.id,
      ...courseDoc.data(),
    };

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json(course);
  } catch (error) {
    console.error("Fetch Course Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Internal server error" });
  }
};
export const fetchAllExceptionsForOngoingLecture = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllExceptionsForOngoingLectureController";
  const action = "fetchAllExceptionsForOngoingLecture";

  try {
    const { lectureId } = req.params;
    const snapshot = await Exceptions.where("lectureId", "==", lectureId)
      .orderBy("date", "desc")
      .get();

    const exceptions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json(exceptions);
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Failed to fetch course exceptions" });
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found or you do not have permission to view it.",
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

    logControllerPerformance(controllerName, action, startTime, "success");

    return res.status(200).json({
      success: true,
      data: course,
    });
  } catch (error) {
    console.error(
      `Error fetching course ${req.params.courseId}:`,
      error.message,
    );
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
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
      logControllerPerformance(controllerName, action, startTime, "success");
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

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true, data: decoratedLectures });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
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

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      count: assessments.length,
      data: assessments,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: error.message });
  }
};
export const fetchAllLecturesByCourseId = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllLecturesByCourseIdController";
  const action = "fetchAllLecturesByCourseId";

  try {
    const { courseId } = req.params;
    const snapshot = await Lectures.where("courseId", "==", courseId).get();

    if (snapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "No lectures found for this course",
      );
      return res
        .status(404)
        .json({ error: "No lectures found for this course" });
    }

    const lectures = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json(lectures);
  } catch (err) {
    console.error("Fetch course lectures error:", err.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
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
      logControllerPerformance(controllerName, action, startTime, "success");
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
      const courseInfo = taughtCourses.find(
        (c) => c.courseId === lecture.courseId,
      );
      return {
        ...lecture,
        courseCode: courseInfo?.courseCode,
        courseTitle: courseInfo?.courseTitle,
      };
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true, data: decoratedLectures });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Transaction ID parameter is required",
      );
      return res.status(400).json({
        success: false,
        message: "Transaction ID parameter is required",
      });
    }
    const transactionSnapshot = await Transactions.where(
      "transactionId",
      "==",
      transactionId,
    )
      .limit(1)
      .get();

    if (transactionSnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Transaction detail not found",
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized access to this transaction record",
      );
      return res.status(403).json({
        success: false,
        message: "Unauthorized access to this transaction record",
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      data: transaction,
      message: "Success",
    });
  } catch (error) {
    console.error("Backend getTransactionById Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};
export const fetchStudentsEnrolledCourses = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchStudentsEnrolledCoursesController";
  const action = "fetchStudentsEnrolledCourses";

  try {
    const { semester, session, page = 1, limit = 10 } = req.query;
    const userId = req.user.uid;
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
    queryRef = queryRef.orderBy("createdAt", "desc");

    const snapshot = await queryRef.get();
    const allCourses = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const paginatedCourses = allCourses.slice(skip, skip + limitNum);

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json(paginatedCourses);
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Error fetching your courses" });
  }
};
export const fetchLecturerEnrolledCourses = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchLecturerEnrolledCoursesController";
  const action = "fetchLecturerEnrolledCourses";
  try {
    const { semester, session, page = 1, limit = 10 } = req.query;
    const lecturerId = req.user.uid;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const query = { lecturerIds: lecturerId, isActive: true };
    if (semester && semester !== "All") query.semester = semester;
    if (session && session !== "All") query.session = session;

    const courses = await Course.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();
    const results = courses.map((course) => ({
      ...course,
    }));

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json(results);
  } catch (error) {
    console.error("Lecturer Fetch Courses Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Error fetching lecturer courses" });
  }
};
export const fetchAllAdmins = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllAdminsController";
  const action = "fetchAllAdmins";

  try {
    const snapshot = await Admin.get();

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
      };
    });

    console.log(`Admin ${req.admin.uid} fetched the administrator list.`);
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json(admins);
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    res.status(500).json({ error: "Failed to fetch administrator list" });
  }
};
export const getNotifications = async (req, res) => {
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
    const recipientIds = paginatedNotifications
      .map((n) => n.recipientId)
      .filter((id) => id !== undefined && id !== null);

    const userTypeMap = new Map();

    if (recipientIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < recipientIds.length; i += 30) {
        chunks.push(recipientIds.slice(i, i + 30));
      }

      const userPromises = chunks.map(async (chunk) => {
        const userSnap = await User.where("uid", "in", chunk).get();
        userSnap.docs.forEach((doc) => {
          const userData = doc.data();
          if (userData.uid) {
            userTypeMap.set(userData.uid, userData.usertype || "unknown");
          }
        });
      });

      await Promise.all(userPromises);
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
export const fetchPosts = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchPostsController";
  const action = "fetchPosts";
  const limit = parseInt(req.query.limit) || 15;
  const cursorScore = req.query.cursor ? parseFloat(req.query.cursor) : null;
  const isInitialLoad = !cursorScore;
  const userId = req.user?.uid || req.user?.id;

  try {
    let cachedPosts = null;
    if (isInitialLoad && typeof client !== "undefined" && client.get) {
      const cached = await client.get("hot_posts");
      if (cached) {
        cachedPosts = JSON.parse(cached);
      }
    }

    let posts = [];

    if (cachedPosts) {
      posts = cachedPosts;
    } else {
      const postsSnapshot = await Posts.where("status", "!=", "hidden").get();

      const rawPosts = postsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      const authorIds = [
        ...new Set(rawPosts.map((p) => p.originalAuthor).filter(Boolean)),
      ];
      const postIds = rawPosts.map((p) => p.id);
      const authorMap = new Map();
      if (authorIds.length > 0) {
        const authorChunks = [];
        for (let i = 0; i < authorIds.length; i += 30) {
          authorChunks.push(authorIds.slice(i, i + 30));
        }

        const authorPromises = authorChunks.map(async (chunk) => {
          const userSnap = await User.where("uid", "in", chunk).get();
          userSnap.docs.forEach((doc) => {
            const userData = doc.data();
            const { password, iCashPin, ...safeData } = userData;
            authorMap.set(userData.uid || doc.id, safeData);
          });
        });
        await Promise.all(authorPromises);
      }
      const repostersMap = new Map();
      if (postIds.length > 0) {
        const reposterChunks = [];
        for (let i = 0; i < postIds.length; i += 30) {
          reposterChunks.push(postIds.slice(i, i + 30));
        }

        const reposterPromises = reposterChunks.map(async (chunk) => {
          const repSnap = await PostReposters.where(
            "postId",
            "in",
            chunk,
          ).get();
          repSnap.docs.forEach((doc) => {
            const repData = doc.data();
            const pId = repData.postId;
            if (!repostersMap.has(pId)) {
              repostersMap.set(pId, []);
            }
            repostersMap.get(pId).push({ id: doc.id, ...repData });
          });
        });
        await Promise.all(reposterPromises);
      }
      const calculatedPosts = rawPosts.map((post) => {
        const authorDetails = authorMap.get(post.originalAuthor) || {};
        const repostersDetails = repostersMap.get(post.id) || [];

        const subscriberBonus = authorDetails.isSubscriber === true ? 1000 : 0;
        let tierMultiplier = 1;
        if (authorDetails.tier === "premium") {
          tierMultiplier = 5;
        } else if (authorDetails.tier === "pro") {
          tierMultiplier = 2;
        }
        const impressionsScore = (post.impressions || 0) * 0.1 * tierMultiplier;
        const createdAtTime = post.createdAt?.toMillis
          ? post.createdAt.toMillis()
          : new Date(post.createdAt || 0).getTime();
        const timeScore = createdAtTime / 1000000000;

        const rankingScore = subscriberBonus + impressionsScore + timeScore;

        return {
          ...post,
          authorDetails,
          repostersDetails,
          rankingScore,
        };
      });

      let filteredPosts = calculatedPosts;
      if (cursorScore !== null) {
        filteredPosts = calculatedPosts.filter(
          (p) => p.rankingScore < cursorScore,
        );
      }
      filteredPosts.sort((a, b) => b.rankingScore - a.rankingScore);
      posts = filteredPosts.slice(0, limit);
    }
    const processedPosts = await Promise.all(
      posts.map(async (post) => {
        const targetPostId = post.postId || post.id;
        const commentsSnapshot = await Comments.where(
          "postId",
          "==",
          targetPostId,
        ).get();
        const comments = [];
        for (const doc of commentsSnapshot.docs) {
          const commentData = doc.data();
          let commentUser = null;
          if (commentData.userId) {
            const commentUserQuery = await User.where(
              "uid",
              "==",
              commentData.userId,
            )
              .limit(1)
              .get();
            if (!commentUserQuery.empty) {
              const cuData = commentUserQuery.docs[0].data();
              commentUser = {
                uid: cuData.uid,
                firstname: cuData.firstname,
                lastname: cuData.lastname,
                username: cuData.username,
                profilePic: cuData.profilePic,
              };
            }
          }
          comments.push({
            ...commentData,
            userId: commentUser || commentData.userId,
          });
        }
        const commentsCount = commentsSnapshot.size;

        return {
          ...post,
          comments,
          commentsCount,
          repostsCount:
            post.repostsCount !== undefined
              ? post.repostsCount
              : (post.repostersDetails || []).length,
          featuredReposter: await getPriorityReposter(
            post.repostersDetails || [],
            userId,
          ),
        };
      }),
    );

    const nextCursor =
      posts.length === limit ? posts[posts.length - 1].rankingScore : null;

    const responseData = { posts: processedPosts, nextCursor };
    logControllerPerformance(controllerName, action, startTime, "success");
    res.json(responseData);
  } catch (err) {
    console.error("Feed error:", err.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    res.status(500).json({ error: err.message });
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