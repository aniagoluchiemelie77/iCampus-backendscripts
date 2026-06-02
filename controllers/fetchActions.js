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
} from "../tableDeclarations.js";
import { client } from "../workers/reditFile.js";
import { createNotification } from "../services/notificationService.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import axiosRetry from "axios-retry";
import axios from "axios";
import * as cheerio from "cheerio";
import { getFallbackBooks } from "../utils/libraryHelpers.js";
axiosRetry(axios, { retries: 3 });

export const getDownloads = async (req, res) => {
  try {
    const userId = req.user.id;
    const userLibrary = await UserDownloads.findOne({ userId });

    if (!userLibrary || !userLibrary.ownedProducts.length) {
      return res.status(200).json({ success: true, data: [] });
    }
    const productIds = userLibrary.ownedProducts.map((p) => p.productId);
    const productsInfo = await Product.find({ productId: { $in: productIds } });
    const mergedData = userLibrary.ownedProducts
      .map((ownedItem) => {
        const details = productsInfo.find(
          (p) => p.productId === ownedItem.productId,
        );
        return {
          ...details?.toObject(),
          progress: ownedItem.progress,
          lastAccessed: ownedItem.lastAccessed,
          completedLessons: ownedItem.completedLessons || [],
        };
      })
      .filter((item) => item.title);

    res.status(200).json({
      success: true,
      data: mergedData,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const fetchConnections = async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    const connections = await Follow.find({ followerId: currentUserId }).select(
      "followingId",
    );
    if (!connections.length) {
      return res.json({ success: true, data: [] });
    }
    const followingUids = connections.map((c) => c.followingId);
    const users = await User.find({ uid: { $in: followingUids } }).select(
      "uid username firstname lastname profilePic tier organizationName",
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

    res.json({ success: true, data: formattedConnections });
  } catch (error) {
    console.error("fetchConnections Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
export const fetchPosts = async (req, res) => {
  const limit = parseInt(req.query.limit) || 15;
  const cursorScore = req.query.cursor ? parseFloat(req.query.cursor) : null;
  const isInitialLoad = !cursorScore;

  try {
    if (isInitialLoad) {
      const cached = await client.get("hot_posts");
      if (cached) return res.json(JSON.parse(cached));
    }
    const pipeline = [
      {
        $lookup: {
          from: "users",
          localField: "originalAuthor",
          foreignField: "uid",
          as: "authorDetails",
        },
      },
      {
        $unwind: {
          path: "$authorDetails",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          rankingScore: {
            $add: [
              {
                $cond: [
                  { $eq: ["$authorDetails.isSubscriber", true] },
                  1000,
                  0,
                ],
              },
              {
                $multiply: [
                  "$impressions",
                  0.1,
                  {
                    $switch: {
                      branches: [
                        {
                          case: { $eq: ["$authorDetails.tier", "premium"] },
                          then: 5,
                        },
                        {
                          case: { $eq: ["$authorDetails.tier", "pro"] },
                          then: 2,
                        },
                      ],
                      default: 1,
                    },
                  },
                ],
              },
              { $divide: [{ $toLong: "$createdAt" }, 1000000000] },
            ],
          },
        },
      },
    ];
    if (cursorScore) {
      pipeline.push({ $match: { rankingScore: { $lt: cursorScore } } });
    }
    pipeline.push(
      { $sort: { rankingScore: -1 } },
      { $limit: limit },
      {
        $project: {
          "authorDetails.password": 0,
          "authorDetails.iCashPin": 0,
        },
      },
    );
    const posts = await Posts.aggregate(pipeline);
    const nextCursor =
      posts.length === limit ? posts[posts.length - 1].rankingScore : null;
    const responseData = { posts, nextCursor };
    if (isInitialLoad) {
      await client.setEx("hot_posts", 300, JSON.stringify(responseData));
    }
    res.json(responseData);
  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).json({ error: err.message });
  }
};
export const fetchUserTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.uid;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      Transactions.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Transactions.countDocuments({ userId }),
    ]);
    const totalPages = Math.ceil(total / limit);

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
    res.status(500).json({ message: error.message });
  }
};
export const fetchUserTransactionStats = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: "Month and year parameters are required.",
      });
    }
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const stats = await Transactions.aggregate([
      { $match: { userId, createdAt: { $gte: start, $lte: end } } },
      {
        $facet: {
          flow: [
            { $group: { _id: "$payType", total: { $sum: "$amountICash" } } },
          ],
          topRecipients: [
            { $match: { payType: "out", type: "p2p_sent" } },
            {
              $group: {
                _id: "$metadata.recipientId",
                count: { $sum: 1 },
                total: { $sum: "$amountICash" },
              },
            },
            {
              $lookup: {
                from: "users",
                localField: "_id",
                foreignField: "uid",
                as: "userDetails",
              },
            },
            // FIXED: Safeguard against deleted or missing profiles breaking totals
            {
              $unwind: {
                path: "$userDetails",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 1,
                count: 1,
                total: 1,
                name: {
                  $trim: {
                    // Clean up trailing spaces if lastname is null/blank
                    input: {
                      $concat: [
                        { $ifNull: ["$userDetails.firstname", "Unknown"] },
                        " ",
                        { $ifNull: ["$userDetails.lastname", "User"] },
                      ],
                    },
                  },
                },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 3 },
          ],
          monthly: [
            {
              $group: {
                _id: { $month: "$createdAt" },
                total: { $sum: "$amountICash" },
              },
            },
          ],
        },
      },
    ]);
    const result = stats[0] || { flow: [], topRecipients: [], monthly: [] };
    res.json(result);
  } catch (e) {
    console.error("Aggregation crash in fetchUserTransactionStats:", e);
    res.status(500).json({ error: e.message });
  }
};
export const fetchItagByUsername = async (req, res) => {
  try {
    const { username } = req.params;
    let isPremium;
    let isUser;
    const iTagData = await ITag.findOne({
      username: { $regex: new RegExp(`^${username}$`, "i") },
    });
    if (!iTagData) {
      return res.status(404).json({ message: "User not found" });
    }
    const maskedNumber = iTagData.cardNumber.replace(/\d(?=\d{4})/g, "*");
    isPremium = iTagData.tier === "premium";
    isUser = iTagData.userId === req.user.id;

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
    res.status(500).json({ message: "Internal Server Error" });
  }
};
export const fetchAllUserConversations = async (req, res) => {
  try {
    const uid = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const skip = (page - 1) * limit;

    const conversations = await Message.aggregate([
      { $match: { $or: [{ senderId: uid }, { recipientId: uid }] } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          id: {
            $cond: [{ $eq: ["$senderId", uid] }, "$recipientId", "$senderId"],
          },
          lastMessage: { $first: "$$ROOT" },
        },
      },
      { $sort: { "lastMessage.timestamp": -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "id",
          foreignField: "uid",
          as: "otherUser",
        },
      },
      { $unwind: "$otherUser" },
      {
        $project: {
          id: 0,
          otherUser: {
            uid: 1,
            firstname: 1,
            username: 1,
            lastname: 1,
            profilePic: 1,
            tier: 1,
            organizationName: 1,
          },
          lastMessage: 1,
        },
      },
    ]);

    res.json({
      success: true,
      data: conversations,
      hasMore: conversations.length === limit,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const fetchPal2PalConversation = async (req, res) => {
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
    res.json({
      success: true,
      data: messages.reverse(),
      hasMore: skip + messages.length < totalMessages,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const fetchUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = "50", offset = "0", unread, category } = req.query;

    if (!userId) {
      return res.status(400).json({ message: "Missing userId" });
    }

    const filter = {
      $or: [{ recipientId: userId }, { isPublic: true }],
    };
    if (unread === "true") {
      filter.isRead = false;
    }
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
};
export const fetchSingleNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;
    const notification = await Notification.findOne({
      notificationId: id,
      recipientId: userId,
    });
    if (!notification) {
      return res.status(404).json({
        message: "Notification not found",
        notification: null,
      });
    }
    if (!notification.isRead) {
      notification.isRead = true;
      await notification.save();
    }

    res.status(200).json({
      success: true,
      notification,
    });
  } catch (error) {
    console.error("Error fetching single notification:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching notification details",
    });
  }
};
export const fetchProfileInformation = async (req, res) => {
  try {
    const { identifier } = req.params;
    const viewerUid = req.user.uid;
    const { viewerTier, viewerRole, viewerFirstname } = req.query;
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
    const [
      followersList,
      followingList,
      isFollowing,
      courses,
      userPosts,
      iTagData,
      bookmarkedPosts,
    ] = await Promise.all([
      Follow.find({ followingId: targetUser.uid }).select("followerId").lean(),
      Follow.find({ followerId: targetUser.uid }).select("followingId").lean(),
      Follow.findOne({ followerId: viewerUid, followingId: targetUser.uid }),
      targetUser.usertype === "lecturer" || targetUser.usertype === "otherUser"
        ? Course.find({ lecturerIds: targetUser.uid })
            .select(
              "courseTitle courseCode thumbnailUrl session semester isActive description rating studentsEnrolled price",
            )
            .lean()
        : null,

      Posts.find({
        $or: [{ "userId.uid": uid }, { originalAuthor: uid }],
      })
        .sort({ createdAt: -1 })
        .lean(),
      ITag.findOne({ userId: targetUser.uid }).lean(),
      Posts.find({ postId: { $in: targetUser.bookmarks || [] } })
        .sort({ createdAt: -1 })
        .lean(),
    ]);
    const formattedCourses = courses
      ? courses.map((course) => ({
          ...course,
          enrolledCount: course.studentsEnrolled
            ? course.studentsEnrolled.length
            : 0,
          studentsEnrolled: undefined, // Hide raw ID array
        }))
      : [];
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
};
export const fetchBlockedUsers = async (req, res) => {
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
};
export const fetchLectureExceptions = async (req, res) => {
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
};
export const fetchCourseAssignments = async (req, res) => {
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
};
export const fetchCourseLectures = async (req, res) => {
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
};
export const fetchLectureExceptionsLecturerView = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.id;
    const course = await Course.findOne({ courseId: courseId });
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    const isLecturer = course.lecturerIds?.some(
      (id) => id.toString() === userId.toString(),
    );
    if (!isLecturer) {
      return res.status(403).json({
        message:
          "Access Denied: You are not authorized to view this course's exceptions",
      });
    }
    const exceptions = await Exceptions.find({ courseId }).sort({ date: -1 });

    res.status(200).json(exceptions);
  } catch (error) {
    console.error("Error fetching lecture exceptions:", error);
    res.status(500).json({ message: "Failed to fetch course exceptions" });
  }
};
export const fetchLeaderBoards = async (req, res) => {
  try {
    const topStudents = await User.find({ usertype: "student" })
      .sort({ currentIScore: -1 })
      .limit(10)
      .select(
        "uid firstname lastname currentIScore email previousIScore profilePic department schoolName",
      );

    const topInstructors = await User.find({
      usertype: { $in: ["lecturer", "otherUser"] },
    })
      .sort({ currentIScore: -1, "monthlyStats.avgReview": -1 })
      .limit(10)
      .select(
        "uid firstname lastname currentIScore email profilePic jobTitle previousIScore",
      );
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
};
export const fetchBanksUsingCountryCode = async (req, res) => {
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
    res.status(flwResponse.status).json(data);
  } catch (error) {
    res.status(500).json({ status: "error", message: "Failed to fetch banks" });
  }
};
export const fetchOngoingLectures = async (req, res) => {
  try {
    const userId = req.user.id;
    const enrolledOrTaughtCourseIds = await Course.find({
      $or: [{ studentsEnrolled: userId }, { lecturerIds: userId }],
    }).distinct("courseId");
    const ongoingLecture = await Lectures.findOne({
      status: "ongoing",
      courseId: { $in: enrolledOrTaughtCourseIds },
    }).populate("courseId");
    if (ongoingLecture) {
      return res.status(200).json({
        ongoing: true,
        lecture: ongoingLecture,
      });
    }
    res.status(200).json({ ongoing: false });
  } catch (err) {
    console.error("Error fetching ongoing lecture:", err);
    res.status(500).json({ error: err.message });
  }
};
export const fetchFeaturedBooksFromLibrary = async (req, res) => {
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
      return res.json(getFallbackBooks());
    }

    res.json(featuredBooks);
  } catch (error) {
    console.error("Featured Scrape Error:", error.message);
    res.json(getFallbackBooks());
  }
};
export const fetchCourseDetailsForOngoingLecture = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await Course.findOne({ courseId: courseId }).lean();
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.status(200).json(course);
  } catch (error) {
    console.error("Fetch Course Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
export const fetchAllExceptionsForOngoingLecture = async (req, res) => {
  try {
    const { lectureId } = req.params;
    const exceptions = await Exceptions.find({ lectureId }).sort({
      date: -1,
    });
    res.status(200).json(exceptions);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch course exceptions" });
  }
};
export const fetchCourseDetails = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.uid;

    const course = await Course.findOne({
      courseId: courseId,
      $or: [{ studentsEnrolled: userId }, { lecturerIds: userId }],
    });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found or you do not have permission to view it.",
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
};
export const fetchStudentsLecturesTimeline = async (req, res) => {
  try {
    const studentId = req.user.uid;
    const enrolledCourses = await Course.find({
      studentsEnrolled: studentId,
    }).select("courseId courseCode courseTitle");
    const courseIds = enrolledCourses.map((c) => c.courseId);
    const lectures = await Lectures.find({
      courseId: { $in: courseIds },
      status: { $ne: "cancelled" },
    }).sort({ date: 1, startTime: 1 });
    const decoratedLectures = lectures.map((lecture) => {
      const courseInfo = enrolledCourses.find(
        (c) => c.courseId === lecture.courseId,
      );
      return {
        ...lecture._doc,
        courseCode: courseInfo?.courseCode,
        courseTitle: courseInfo?.courseTitle,
      };
    });

    res.status(200).json({ success: true, data: decoratedLectures });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
export const fetchAllCourseAssessments = async (req, res) => {
  try {
    const { courseId } = req.params;
    const assessments = await Assessment.find({ courseId })
      .sort({ updatedAt: -1 })
      .select("-__v");

    res.status(200).json({
      success: true,
      count: assessments.length,
      data: assessments,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
export const fetchAllLecturesByCourseId = async (req, res) => {
  try {
    const { courseId } = req.params;
    const lectures = await Lectures.find({ courseId: courseId }).lean();

    if (!lectures || lectures.length === 0) {
      return res
        .status(404)
        .json({ error: "No lectures found for this course" });
    }
    res.json(lectures);
  } catch (err) {
    console.error("Fetch course lectures error:", err);
    res
      .status(500)
      .json({ error: "Server error while fetching lectures for this course" });
  }
};
export const fetchLecturersLecturesTimeline = async (req, res) => {
  try {
    const lecturerId = req.user.uid;
    const taughtCourses = await Course.find({
      lecturerIds: lecturerId,
    }).select("courseId courseCode courseTitle");
    const courseIds = taughtCourses.map((c) => c.courseId);
    const lectures = await Lectures.find({
      courseId: { $in: courseIds },
      status: { $ne: "cancelled" },
    }).sort({ date: 1, startTime: 1 });
    const decoratedLectures = lectures.map((lecture) => {
      const courseInfo = taughtCourses.find(
        (c) => c.courseId === lecture.courseId,
      );
      return {
        ...lecture._doc,
        courseCode: courseInfo?.courseCode,
        courseTitle: courseInfo?.courseTitle,
      };
    });

    res.status(200).json({ success: true, data: decoratedLectures });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};