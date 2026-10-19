import { createNotification } from "../services/notification.js";
import vision from "@google-cloud/vision";
import {
  Follow,
  User,
  Posts,
  Comments,
  PostReposters,
} from "../tableDeclarations.js";
import {
  generateNotificationId,
  generatePostId,
} from "../utils/idGenerator.js";
import { extractMentions } from "../utils/postMentionsRegex.js";
import { storage, db } from "../config/firebaseAdmin.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { scan } from "../services/visionAi.js";
import {
  getPriorityReposter,
  embedPostWithAuthorDetails,
} from "../utils/reposterPriorityChecker.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { setImmediate } from "timers";
import { calculateRankingScore } from "../utils/postRanker.js";
import {
  POST_AUDIENCES,
  canPostToSchool,
  canViewPost,
  enrichPosts,
  loadUsersByUid,
  normalizeComment,
  parseCommentInput,
  toPublicUser,
} from "../utils/postPipeline.js";
let visionClient = null;

/** Looks a post up by its postId field, falling back to the document id. */
const findPostDoc = async (postId) => {
  if (!postId) return null;
  const snap = await Posts.where("postId", "==", postId).limit(1).get();
  if (!snap.empty) return snap.docs[0];
  const byId = await Posts.doc(postId).get();
  return byId.exists ? byId : null;
};

/** One engagement formula for every action (they had each drifted). */
const computeRankingScore = (post, { comments, reposts } = {}) => {
  const createdAtMs = post.createdAt?.toMillis
    ? post.createdAt.toMillis()
    : new Date(post.createdAt || Date.now()).getTime();
  return (
    (post.impressions || 0) * 0.1 +
    (Array.isArray(post.likes) ? post.likes.length : 0) * 2 +
    (Array.isArray(post.bookmarks) ? post.bookmarks.length : 0) * 3 +
    (comments ?? post.commentsCount ?? 0) * 4 +
    (reposts ?? post.repostsCount ?? 0) * 5 +
    (post.poll?.totalVotes || 0) * 3 +
    createdAtMs / 1000000000
  );
};

//Tested and trusted using jest
const getVisionClient = () => {
  if (!visionClient) {
    try {
      visionClient = new vision.ImageAnnotatorClient();
    } catch (err) {
      console.warn(
        "Google Cloud Vision client could not be initialized (missing credentials).",
      );
      return null;
    }
  }
  return visionClient;
};
const getPostStats = (post, repostersCount = 0, commentsCount = 0) => ({
  likes: post.likes || [],
  bookmarks: post.bookmarks || [],
  impressions: post.impressions || 0,
  repostsCount: repostersCount,
  commentsCount: commentsCount,
  totalVotes: post.poll?.totalVotes || 0,
});
export const fetchPostUsingPostId = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchPostUsingPostIdController";
  const action = "fetchPostUsingPostId";
  const userId = req.user?.id || req.user?.uid;

  try {
    const { postId } = req.params;
    if (!postId) {
      return res.status(400).json({ error: "Missing postId parameter" });
    }

    const postDoc = await findPostDoc(postId);
    const post = postDoc ? { id: postDoc.id, ...postDoc.data() } : null;
    // Hidden and out-of-audience posts look the same as missing ones, so a
    // school memo's existence isn't revealed to outsiders.
    if (!post || !canViewPost(post, req.user)) {
      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "error", "Post not found");
      });
      return res.status(404).json({ error: "Post not found" });
    }

    const [enriched] = await enrichPosts([post], userId);
    res.status(200).json(enriched);

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (err) {
    console.error("Fetch single post error:", err.message);
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "error", err.message);
    });
    return res.status(500).json({ error: err.message });
  }
};
export const moderateContent = async (postId, content, media) => {
  if (!postId || !media?.url || media.url.length === 0) {
    return;
  }

  const client = getVisionClient();
  if (!client) {
    console.warn(
      `Skipping content moderation for post ${postId}: Vision client unavailable.`,
    );
    return;
  }

  try {
    const result = await scan(media.url, content);
    const postQuery = await Posts.where("postId", "==", postId).limit(1).get();

    if (result?.isViolation) {
      if (!postQuery.empty) {
        const postDocRef = postQuery.docs[0].ref;
        await postDocRef.update({
          status: "hidden",
          updatedAt: new Date(),
        });
      }

      await notifyAdmins(
        { role: ["moderator", "super_admin"] },
        {
          notificationId: generateNotificationId("social"),
          actionType: "MODERATION_ALERT_NUDITY",
          payload: {
            postId: postId,
            reason: result.flaggedCategory || "Policy Violation",
            confidence: result.confidence || 0,
          },
          senderId: "system",
        },
        false,
      );
    } else {
      if (!postQuery.empty) {
        const postDocRef = postQuery.docs[0].ref;
        await postDocRef.update({
          status: "visible",
          updatedAt: new Date(),
        });
      }
    }
  } catch (error) {
    console.error(
      `Error during content moderation scan for post ${postId}:`,
      error.message,
    );
  }
};
export const createPost = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createPostController";
  const action = "createPost";
  try {
    const {
      content,
      media,
      poll,
      isSubscriptionContent,
      postType,
      jobMetadata,
      eventMetadata,
      audience,
    } = req.body;
    const userId = req.user?.id || req.user?.uid;

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user identifier",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user identifier" });
    }

    const requestedAudience = POST_AUDIENCES.includes(audience)
      ? audience
      : "public";
    if (requestedAudience === "school" && !canPostToSchool(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only institution admins can post school-only memos.",
      });
    }

    let processedMedia = media ? { ...media } : null;
    if (
      processedMedia?.mediaType === "video" &&
      Array.isArray(processedMedia.url)
    ) {
      processedMedia.url = [processedMedia.url[0]];
    }

    const authorQuery = await User.where("uid", "==", userId).limit(1).get();
    if (authorQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Author not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "Author not found" });
    }

    const authorDoc = authorQuery.docs[0];
    const author = authorDoc.data();
    const authorName =
      `${author.firstname || ""} ${author.lastname || ""}`.trim();
    const newPostId = generatePostId();
    const resolvedPostType = postType || (poll ? "poll" : "media");
    const initialScore = calculateRankingScore(
      { impressions: 0, createdAt: new Date() },
      author,
    );

    const newPostData = {
      postId: newPostId,
      originalAuthor: userId,
      // The feed filters on status; without it a post never showed up.
      status: "visible",
      audience: requestedAudience,
      // The school comes from the admin's own record, never the client.
      schoolCode: requestedAudience === "school" ? author.schoolCode : null,
      rankingScore: initialScore,
      content: content || "",
      isSubscriptionContent: isSubscriptionContent || false,
      media: processedMedia,
      postType: resolvedPostType,
      poll: poll
        ? {
            options: poll.options.map((opt, index) => ({
              optionId: `opt_${Date.now()}_${index}`,
              text: opt.text,
              votes: [],
            })),
            totalVotes: 0,
            expiresAt:
              poll.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }
        : null,
      jobMetadata: resolvedPostType === "job" ? jobMetadata || null : null,
      eventMetadata:
        resolvedPostType === "event" ? eventMetadata || null : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const postDocRef = Posts.doc(newPostId);

    const mentionedUsernames = extractMentions(content || "");
    const mentionChunks = [];
    for (let i = 0; i < mentionedUsernames.length; i += 10) {
      mentionChunks.push(mentionedUsernames.slice(i, i + 10));
    }

    const [_, mentionSnapshots, followsQuery] = await Promise.all([
      postDocRef.set(newPostData),
      mentionChunks.length > 0
        ? Promise.all(
            mentionChunks.map((chunk) =>
              User.where("username", "in", chunk).get(),
            ),
          )
        : Promise.resolve([]),
      Follow.where("followingId", "==", userId).get(),
    ]);

    moderateContent(newPostId, content, newPostData.media).catch((err) =>
      console.error("Moderation trigger failed:", err),
    );

    let notifiedUids = new Set();
    const notificationPromises = [];

    mentionSnapshots.forEach((mentionedQuery) => {
      mentionedQuery.forEach((doc) => {
        const user = doc.data();
        // Don't notify people who can't open the post (school memos).
        if (!canViewPost(newPostData, user)) return;
        if (user.uid && !notifiedUids.has(user.uid)) {
          notifiedUids.add(user.uid);
          notificationPromises.push(
            createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: user.uid,
              isRead: false,
              recipientEmail: user.email,
              category: "social",
              actionType: "POST_MENTION",
              title: "You were mentioned",
              message: `${authorName} mentioned you in a post.`,
              payload: { postId: newPostData.postId, authorId: userId },
              sendPush: true,
              sendSocket: true,
              saveToDb: true,
            }),
          );
        }
      });
    });

    const followerIds = [];
    followsQuery.forEach((doc) => {
      const follow = doc.data();
      const followerId = follow.followerId;
      if (
        followerId &&
        !notifiedUids.has(followerId) &&
        followerId !== userId
      ) {
        notifiedUids.add(followerId);
        followerIds.push(followerId);
      }
    });

    if (followerIds.length > 0) {
      const userChunks = [];
      for (let i = 0; i < followerIds.length; i += 30) {
        userChunks.push(followerIds.slice(i, i + 30));
      }

      const followerSnapshots = await Promise.all(
        userChunks.map((chunk) => User.where("uid", "in", chunk).get()),
      );

      followerSnapshots.forEach((followerSnap) => {
        followerSnap.forEach((doc) => {
          const followerUser = doc.data();
          if (!canViewPost(newPostData, followerUser)) return;
          notificationPromises.push(
            createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: followerUser.uid,
              recipientEmail: followerUser.email,
              isRead: false,
              category: "social",
              actionType: "NEW_POST",
              title: `New Posts from ${authorName}`,
              message: `${authorName} just shared a new update.`,
              payload: { postId: newPostData.postId, authorId: userId },
              sendPush: true,
              sendSocket: true,
              saveToDb: true,
            }),
          );
        });
      });
    }

    Promise.all(notificationPromises).catch((err) =>
      console.error(
        "Non-blocking notification pipeline failure in post creation:",
        err,
      ),
    );

    res.status(200).json({
      success: true,
      message: "Posts created successfully",
      // Same shape as the feed, so the app can show it immediately.
      data: (await enrichPosts([{ ...newPostData }], userId))[0],
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Create Posts Error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: error.message });
  }
};
export const updatePost = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "updatePostController";
  const action = "updatePost";
  try {
    const { postId } = req.params;
    const {
      content,
      media,
      poll,
      isSubscriptionContent,
      jobMetadata,
      eventMetadata,
      audience,
    } = req.body;
    const userId = req.user?.id || req.user?.uid;

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user identifier",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user identifier" });
    }
    if (audience === "school" && !canPostToSchool(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only institution admins can post school-only memos.",
      });
    }

    const [postQuery, authorQuery] = await Promise.all([
      Posts.where("postId", "==", postId)
        .where("originalAuthor", "==", userId)
        .limit(1)
        .get(),
      User.where("uid", "==", userId).limit(1).get(),
    ]);

    if (postQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Posts not found or unauthorized to edit.",
        );
      });
      return res.status(404).json({
        success: false,
        message: "Posts not found or unauthorized to edit.",
      });
    }

    const postDocRef = postQuery.docs[0].ref;
    const post = postQuery.docs[0].data();
    const author = !authorQuery.empty ? authorQuery.docs[0].data() : null;
    const authorName = author
      ? `${author.firstname || ""} ${author.lastname || ""}`.trim()
      : "Someone";

    let processedMedia = media ? { ...media } : post.media;
    if (
      processedMedia?.mediaType === "video" &&
      Array.isArray(processedMedia.url)
    ) {
      processedMedia.url = [processedMedia.url[0]];
    }

    const updatedContent = content !== undefined ? content : post.content;
    const updatedIsSubscriptionContent =
      isSubscriptionContent !== undefined
        ? isSubscriptionContent
        : post.isSubscriptionContent;

    let updatedJobMetadata = post.jobMetadata;
    if (jobMetadata) {
      updatedJobMetadata =
        post.postType === "job"
          ? { ...post.jobMetadata, ...jobMetadata }
          : jobMetadata;
    }

    let updatedEventMetadata = post.eventMetadata;
    if (eventMetadata) {
      updatedEventMetadata =
        post.postType === "event"
          ? { ...post.eventMetadata, ...eventMetadata }
          : eventMetadata;
    }

    let updatedPoll = post.poll;
    if (poll && post.poll) {
      const updatedOptions = poll.options.map((opt, index) => {
        const existingOpt = post.poll.options.find((o) => o.text === opt.text);
        return {
          optionId: existingOpt
            ? existingOpt.optionId
            : `opt_${Date.now()}_${index}`,
          text: opt.text,
          votes: existingOpt ? existingOpt.votes : [],
        };
      });
      const totalVotes = updatedOptions.reduce(
        (sum, o) => sum + (o.votes ? o.votes.length : 0),
        0,
      );
      updatedPoll = {
        ...post.poll,
        options: updatedOptions,
        totalVotes: totalVotes,
      };
    }

    const updatePayload = {
      content: updatedContent,
      media: processedMedia,
      isSubscriptionContent: updatedIsSubscriptionContent,
      jobMetadata: updatedJobMetadata,
      eventMetadata: updatedEventMetadata,
      poll: updatedPoll,
      updatedAt: new Date(),
    };
    if (POST_AUDIENCES.includes(audience)) {
      updatePayload.audience = audience;
      updatePayload.schoolCode = audience === "school" ? author?.schoolCode || null : null;
    }

    const explicitUsernames = extractMentions(updatedContent || "");
    const mentionChunks = [];
    for (let i = 0; i < explicitUsernames.length; i += 10) {
      mentionChunks.push(explicitUsernames.slice(i, i + 10));
    }

    const [_, mentionSnapshots] = await Promise.all([
      Promise.all([
        postDocRef.update(updatePayload),
        moderateContent(postId, updatedContent, processedMedia).catch((err) =>
          console.error("Moderation trigger failed during update:", err),
        ),
      ]),
      mentionChunks.length > 0
        ? Promise.all(
            mentionChunks.map((chunk) =>
              User.where("username", "in", chunk).get(),
            ),
          )
        : Promise.resolve([]),
    ]);

    const notificationPromises = [];

    mentionSnapshots.forEach((usersToTagQuery) => {
      usersToTagQuery.forEach((doc) => {
        const targetUser = doc.data();
        if (targetUser.uid && targetUser.uid !== userId) {
          notificationPromises.push(
            createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: targetUser.uid,
              isRead: false,
              recipientEmail: targetUser.email,
              category: "social",
              actionType: "POST_MENTION",
              title: "You were mentioned",
              message: `${authorName} mentioned you in an updated post.`,
              payload: { postId: post.postId, authorId: userId },
              sendPush: true,
              sendSocket: true,
              saveToDb: true,
            }),
          );
        }
      });
    });

    notificationPromises.push(
      createNotification({
        notificationId: generateNotificationId("social"),
        recipientId: userId,
        isRead: false,
        recipientEmail: author?.email,
        category: "social",
        actionType: "POST_UPDATED",
        title: "Posts Updated",
        message: "Your post has been successfully updated.",
        payload: { postId: post.postId },
        sendPush: false,
        sendSocket: true,
        saveToDb: true,
      }),
    );

    Promise.all(notificationPromises).catch((err) =>
      console.error(
        "Non-blocking notification pipeline failure in post update:",
        err,
      ),
    );

    res.status(200).json({
      success: true,
      message: "Posts updated successfully",
      post: { ...post, ...updatePayload },
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Update Posts Error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: error.message });
  }
};
export const toggleLike = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleLikeController";
  const action = "toggleLike";
  const { postId } = req.params;
  const userId = req.user?.id || req.user?.uid;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized user identifier" });
  }

  try {
    const result = await db.runTransaction(async (transaction) => {
      // All reads first (Firestore transactions reject reads after writes).
      const [postSnap, userSnap] = await Promise.all([
        transaction.get(Posts.where("postId", "==", postId).limit(1)),
        transaction.get(User.where("uid", "==", userId).limit(1)),
      ]);
      if (postSnap.empty) throw new Error("Post not found");
      const postDoc = postSnap.docs[0];
      const post = postDoc.data();
      if (!canViewPost(post, req.user)) throw new Error("Post not found");

      const likes = Array.isArray(post.likes) ? post.likes : [];
      const wasLiked = likes.includes(userId);
      const updatedLikes = wasLiked
        ? likes.filter((id) => id !== userId)
        : [...likes, userId];

      transaction.update(postDoc.ref, {
        likes: updatedLikes,
        rankingScore: computeRankingScore({ ...post, likes: updatedLikes }),
        updatedAt: new Date(),
      });
      if (!userSnap.empty) {
        const userLikes = userSnap.docs[0].data().likes || [];
        transaction.update(userSnap.docs[0].ref, {
          likes: wasLiked
            ? userLikes.filter((id) => id !== postId)
            : [...new Set([...userLikes, postId])],
          updatedAt: new Date(),
        });
      }
      return { post, wasLiked, updatedLikes };
    });

    const { post, wasLiked, updatedLikes } = result;
    res.status(200).json({
      success: true,
      liked: !wasLiked,
      likes: updatedLikes,
      likesCount: updatedLikes.length,
      message: wasLiked ? "You unliked a post." : "You liked a post.",
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(async () => {
      try {
        const postOwnerId = post.originalAuthor;
        if (!wasLiked && postOwnerId && postOwnerId !== userId) {
          const ownerQuery = await User.where("uid", "==", postOwnerId).limit(1).get();
          const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;
          if (owner) {
            await createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: postOwnerId,
              isRead: false,
              recipientEmail: owner.email,
              category: "social",
              actionType: "POST_LIKED",
              title: "New Like",
              message: `${req.user?.firstname || "Someone"} liked your post.`,
              payload: { postId: post.postId, userId, firstname: req.user?.firstname },
              sendPush: true,
              saveToDb: true,
            });
          }
        }
      } catch (err) {
        console.error("Background notification error in toggleLike:", err);
      }
    });
  } catch (err) {
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "error", err.message);
    });
    const notFound = err.message === "Post not found";
    return res
      .status(notFound ? 404 : 500)
      .json({ success: false, message: notFound ? err.message : "Could not update like." });
  }
};
export const toggleBookmark = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleBookmarkController";
  const action = "toggleBookmark";
  const { postId } = req.params;
  const userId = req.user?.id || req.user?.uid;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized user identifier" });
  }

  try {
    const result = await db.runTransaction(async (transaction) => {
      const [postSnap, userSnap] = await Promise.all([
        transaction.get(Posts.where("postId", "==", postId).limit(1)),
        transaction.get(User.where("uid", "==", userId).limit(1)),
      ]);
      if (postSnap.empty) throw new Error("Post not found");
      const postDoc = postSnap.docs[0];
      const post = postDoc.data();
      if (!canViewPost(post, req.user)) throw new Error("Post not found");

      const bookmarks = Array.isArray(post.bookmarks) ? post.bookmarks : [];
      const wasBookmarked = bookmarks.includes(userId);
      const updatedBookmarks = wasBookmarked
        ? bookmarks.filter((id) => id !== userId)
        : [...bookmarks, userId];

      transaction.update(postDoc.ref, {
        bookmarks: updatedBookmarks,
        rankingScore: computeRankingScore({ ...post, bookmarks: updatedBookmarks }),
        updatedAt: new Date(),
      });
      if (!userSnap.empty) {
        const userBookmarks = userSnap.docs[0].data().bookmarks || [];
        transaction.update(userSnap.docs[0].ref, {
          bookmarks: wasBookmarked
            ? userBookmarks.filter((id) => id !== postId)
            : [...new Set([...userBookmarks, postId])],
          updatedAt: new Date(),
        });
      }
      return { wasBookmarked, updatedBookmarks };
    });

    res.status(200).json({
      success: true,
      bookmarked: !result.wasBookmarked,
      isBookmarked: !result.wasBookmarked,
      bookmarks: result.updatedBookmarks,
      count: result.updatedBookmarks.length,
      message: result.wasBookmarked
        ? "You removed a post from your bookmarks"
        : "You bookmarked a post",
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (err) {
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "error", err.message);
    });
    const notFound = err.message === "Post not found";
    return res
      .status(notFound ? 404 : 500)
      .json({ success: false, message: notFound ? err.message : "Could not update bookmark." });
  }
};
export const addComment = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "addCommentController";
  const action = "addComment";
  const { postId } = req.params;
  const userId = req.user?.id || req.user?.uid;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized user identifier" });
  }

  const parsed = parseCommentInput(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }
  const input = parsed.value;

  try {
    const postDoc = await findPostDoc(postId);
    const post = postDoc ? postDoc.data() : null;
    if (!post || !canViewPost(post, req.user)) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }
    const canonicalPostId = post.postId || postId;

    // Threads are one level deep: a reply to a reply attaches to its root.
    let parentId = null;
    let parentAuthorId = null;
    if (input.parentId) {
      const parentDoc = await Comments.doc(input.parentId).get();
      const parent = parentDoc.exists ? parentDoc.data() : null;
      if (!parent || parent.postId !== canonicalPostId) {
        return res.status(400).json({ success: false, message: "The comment you replied to no longer exists." });
      }
      parentId = parent.parentId || input.parentId;
      parentAuthorId = parent.userId;
    }

    const commentId = Math.random().toString(36).slice(2, 11);
    const createdAt = new Date();
    const commenter = req.user || {};
    const commentData = {
      id: commentId,
      postId: canonicalPostId,
      userId,
      username: commenter.username || commenter.firstname || "",
      profilePic: Array.isArray(commenter.profilePic)
        ? commenter.profilePic[commenter.profilePic.length - 1] || ""
        : commenter.profilePic || "",
      type: input.type,
      text: input.text,
      media: input.media,
      parentId,
      likes: [],
      createdAt,
      timestamp: createdAt,
    };
    await Comments.doc(commentId).set(commentData);

    const [countAgg, repostsAgg] = await Promise.all([
      Comments.where("postId", "==", canonicalPostId).count().get(),
      PostReposters.where("postId", "==", canonicalPostId).count().get(),
    ]);
    const commentsCount = countAgg.data().count;
    await postDoc.ref.update({
      commentsCount,
      rankingScore: computeRankingScore(post, {
        comments: commentsCount,
        reposts: repostsAgg.data().count,
      }),
      updatedAt: createdAt,
    });

    const authorMap = new Map([[userId, toPublicUser(commenter, userId)]]);
    res.status(200).json({
      success: true,
      comment: { ...normalizeComment(commentId, commentData, authorMap), replyCount: 0, replies: [] },
      commentsCount,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(async () => {
      try {
        const preview =
          input.type === "text"
            ? `"${input.text.substring(0, 40)}${input.text.length > 40 ? "…" : ""}"`
            : input.type === "gif"
              ? "a GIF"
              : "a sticker";
        const recipients = new Map();
        if (post.originalAuthor && post.originalAuthor !== userId) {
          recipients.set(post.originalAuthor, {
            title: "New Comment",
            message: `${commenter.firstname || "Someone"} commented on your post: ${preview}`,
          });
        }
        if (parentAuthorId && parentAuthorId !== userId) {
          recipients.set(parentAuthorId, {
            title: "New Reply",
            message: `${commenter.firstname || "Someone"} replied to your comment: ${preview}`,
          });
        }
        await Promise.all(
          [...recipients.entries()].map(async ([recipientId, copy]) => {
            const ownerQuery = await User.where("uid", "==", recipientId).limit(1).get();
            const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;
            return createNotification({
              notificationId: generateNotificationId("social"),
              recipientId,
              isRead: false,
              recipientEmail: owner?.email,
              category: "social",
              actionType: "POST_COMMENTED",
              title: copy.title,
              message: copy.message,
              payload: { postId: canonicalPostId, commentId, firstname: commenter.firstname },
              sendPush: true,
              saveToDb: true,
            });
          }),
        );
      } catch (err) {
        console.error("Background notification error in addComment:", err);
      }
    });
  } catch (err) {
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "error", err.message);
    });
    return res.status(500).json({ success: false, message: "Could not post your comment." });
  }
};
export const incrementImpressions = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "incrementImpressionsController";
  const action = "incrementImpressions";
  try {
    const { postId } = req.params;

    if (!postId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing postId parameter",
        );
      });
      return res
        .status(400)
        .json({ success: false, message: "Missing postId parameter" });
    }

    const result = await db.runTransaction(async (transaction) => {
      const postQuery = await Posts.where("postId", "==", postId)
        .limit(1)
        .get();
      if (postQuery.empty) {
        throw new Error("Post not found");
      }

      const postDoc = postQuery.docs[0];
      const postData = postDoc.data();
      const newImpressions = (postData.impressions || 0) + 1;
      const likesCount = (postData.likes || []).length;
      const bookmarksCount = (postData.bookmarks || []).length;
      const commentsCountSnapshot = await Comments.where(
        "postId",
        "==",
        postId,
      ).get();
      const commentsCount = commentsCountSnapshot.size;

      const impressionsScore = newImpressions * 0.1;
      const engagementScore =
        likesCount * 2 + bookmarksCount * 3 + commentsCount * 4;

      const createdAtTime = postData.createdAt?.toMillis
        ? postData.createdAt.toMillis()
        : new Date(postData.createdAt || Date.now()).getTime();
      const timeScore = createdAtTime / 1000000000;

      const newRankingScore = impressionsScore + engagementScore + timeScore;
      transaction.update(postDoc.ref, {
        impressions: newImpressions,
        rankingScore: newRankingScore,
        updatedAt: new Date(),
      });

      const [repostersSnapshot] = await Promise.all([
        PostReposters.where("postId", "==", postId).get(),
      ]);

      return {
        post: {
          id: postDoc.id,
          ...postData,
          impressions: newImpressions,
          rankingScore: newRankingScore,
        },
        repostersCount: repostersSnapshot.size,
        commentsCount,
      };
    });

    const updatedPost = result.post;
    const repostersCount = result.repostersCount;
    const commentsCount = result.commentsCount;

    res.status(200).json({
      success: true,
      impressions: updatedPost.impressions,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(async () => {
      try {
        const authorId = updatedPost.originalAuthor || updatedPost.userId;
        if (authorId) {
          const authorQuery = await User.where("uid", "==", authorId)
            .limit(1)
            .get();
          if (!authorQuery.empty) {
            const authorDoc = authorQuery.docs[0];
            const author = authorDoc.data();
            if (author && author.usertype !== "enterprise") {
              const currentMinutes = author.monthlyStats?.minutesActive || 0;
              await authorDoc.ref.update({
                "monthlyStats.minutesActive": currentMinutes + 0.5,
                updatedAt: new Date(),
              });
            }
          }
        }

        const io = req.app.get("socketio");
        if (io) {
          io.emit("post_stats_updated", {
            postId: updatedPost.postId,
            stats:
              typeof getPostStats === "function"
                ? getPostStats(updatedPost, repostersCount, commentsCount)
                : updatedPost,
          });
        }
      } catch (err) {
        console.error(
          "Background execution error in incrementImpressions:",
          err,
        );
      }
    });
  } catch (err) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      );
    });
    const statusCode = err.message === "Post not found" ? 404 : 500;
    if (statusCode === 404) {
      return res.status(404).send("Post not found");
    }
    return res.status(500).send(err.message);
  }
};
export const repost = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "repostController";
  const action = "repost";
  const { originalPostId } = req.body;
  const userId = req.user?.id || req.user?.uid;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user identifier",
      );
    });
    return res.status(401).json({ message: "Unauthorized user identifier" });
  }

  if (!originalPostId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing originalPostId.",
      );
    });
    return res.status(400).json({ message: "Missing originalPostId." });
  }

  try {
    const [postQuery, userQuery] = await Promise.all([
      Posts.where("postId", "==", originalPostId).limit(1).get(),
      User.where("uid", "==", userId).limit(1).get(),
    ]);

    if (postQuery.empty || userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Original post or user details not found.",
        );
      });
      return res
        .status(404)
        .json({ message: "Original post details not found." });
    }

    const postDoc = postQuery.docs[0];
    const originalPost = postDoc.data();
    const repostAuthor = userQuery.docs[0].data();
    if (!canViewPost(originalPost, req.user)) {
      return res.status(404).json({ success: false, message: "Original post details not found." });
    }
    if ((originalPost.audience || "public") === "school") {
      return res.status(403).json({
        success: false,
        message: "School memos can't be reposted.",
      });
    }

    const existingRepostQuery = await PostReposters.where("uid", "==", userId)
      .where("postId", "==", originalPostId)
      .limit(1)
      .get();

    const isExisting = !existingRepostQuery.empty;

    if (isExisting) {
      const repostDocRef = existingRepostQuery.docs[0].ref;

      await db.runTransaction(async (transaction) => {
        const latestPostSnap = await transaction.get(postDoc.ref);
        const latestPostData = latestPostSnap.data();
        const currentCount = latestPostData.repostsCount || 0;
        const newRepostsCount = Math.max(0, currentCount - 1);
        const likesCount = (latestPostData.likes || []).length;
        const bookmarksCount = (latestPostData.bookmarks || []).length;
        const commentsCountSnap = await Comments.where(
          "postId",
          "==",
          originalPostId,
        ).get();
        const commentsCount = commentsCountSnap.size;

        const impressionsScore = (latestPostData.impressions || 0) * 0.1;
        const engagementScore =
          likesCount * 2 +
          bookmarksCount * 3 +
          commentsCount * 4 +
          newRepostsCount * 5;

        const createdAtTime = latestPostData.createdAt?.toMillis
          ? latestPostData.createdAt.toMillis()
          : new Date(latestPostData.createdAt || Date.now()).getTime();
        const timeScore = createdAtTime / 1000000000;

        const newRankingScore = impressionsScore + engagementScore + timeScore;
        transaction.delete(repostDocRef);
        transaction.update(postDoc.ref, {
          repostsCount: newRepostsCount,
          rankingScore: newRankingScore,
          updatedAt: new Date(),
        });
      });

      const [updatedPostSnap, repostersSnapshot, commentsSnapshot] =
        await Promise.all([
          postDoc.ref.get(),
          PostReposters.where("postId", "==", originalPostId).get(),
          Comments.where("postId", "==", originalPostId).get(),
        ]);

      const updatedOriginal = updatedPostSnap.data();
      const repostersCount = repostersSnapshot.size;
      const commentsCount = commentsSnapshot.size;
      res.status(200).json({
        success: true,
        reposted: false,
        message: "You undid a repost action",
        repostsCount: repostersCount,
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
      setImmediate(() => {
        try {
          const io = req.app.get("socketio");
          if (io && updatedOriginal) {
            io.emit("post_stats_updated", {
              postId: originalPostId,
              stats:
                typeof getPostStats === "function"
                  ? getPostStats(updatedOriginal, repostersCount, commentsCount)
                  : updatedOriginal,
            });
          }
        } catch (err) {
          console.error(
            "Background socket emission error in undo repost:",
            err,
          );
        }
      });
    } else {
      const repostId = Math.random().toString(36).slice(2, 11);
      const repostedAt = new Date();

      const reposterData = {
        repostId,
        postId: originalPostId,
        uid: repostAuthor.uid || userId,
        firstname: repostAuthor.firstname || null,
        lastname: repostAuthor.lastname || null,
        username: repostAuthor.username || null,
        tier: repostAuthor.tier || "",
        organizationName: repostAuthor.organizationName || null,
        profilePic:
          Array.isArray(repostAuthor?.profilePic) &&
          repostAuthor.profilePic.length > 0
            ? repostAuthor.profilePic[repostAuthor.profilePic.length - 1]
            : [],
        repostedAt,
      };

      const repostDocRef = PostReposters.doc(repostId);

      await db.runTransaction(async (transaction) => {
        const latestPostSnap = await transaction.get(postDoc.ref);
        const latestPostData = latestPostSnap.data();
        const currentCount = latestPostData.repostsCount || 0;
        const newRepostsCount = currentCount + 1;
        const likesCount = (latestPostData.likes || []).length;
        const bookmarksCount = (latestPostData.bookmarks || []).length;
        const commentsCountSnap = await Comments.where(
          "postId",
          "==",
          originalPostId,
        ).get();
        const commentsCount = commentsCountSnap.size;

        const impressionsScore = (latestPostData.impressions || 0) * 0.1;
        const engagementScore =
          likesCount * 2 +
          bookmarksCount * 3 +
          commentsCount * 4 +
          newRepostsCount * 5; // Reposts weigh heavily!

        const createdAtTime = latestPostData.createdAt?.toMillis
          ? latestPostData.createdAt.toMillis()
          : new Date(latestPostData.createdAt || Date.now()).getTime();
        const timeScore = createdAtTime / 1000000000;

        const newRankingScore = impressionsScore + engagementScore + timeScore;
        transaction.set(repostDocRef, reposterData);
        transaction.update(postDoc.ref, {
          repostsCount: newRepostsCount,
          rankingScore: newRankingScore,
          updatedAt: new Date(),
        });
      });

      const [updatedPostSnap, repostersSnapshot, commentsSnapshot] =
        await Promise.all([
          postDoc.ref.get(),
          PostReposters.where("postId", "==", originalPostId).get(),
          Comments.where("postId", "==", originalPostId).get(),
        ]);

      const updatedOriginal = updatedPostSnap.data();
      const repostersCount = repostersSnapshot.size;
      const commentsCount = commentsSnapshot.size;
      res.status(200).json({
        success: true,
        reposted: true,
        message: "Reposted to your profile.",
        repostsCount: repostersCount,
        reposter: {
          ...reposterData,
          profilePic: reposterData.profilePic ? [].concat(reposterData.profilePic) : [],
          repostedAt: repostedAt.toISOString(),
        },
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
      setImmediate(async () => {
        try {
          const io = req.app.get("socketio");
          if (io) {
            io.emit("new_post", {
              ...originalPost,
              ...reposterData,
              isRepost: true,
            });
            io.emit("post_stats_updated", {
              postId: originalPostId,
              stats:
                typeof getPostStats === "function"
                  ? getPostStats(updatedOriginal, repostersCount, commentsCount)
                  : updatedOriginal,
            });
          }

          let notifiedUids = new Set();
          const reposterName =
            repostAuthor && repostAuthor.usertype === "enterprise"
              ? repostAuthor.organizationName
              : repostAuthor.firstname;

          const postOwnerId =
            originalPost.originalAuthor || originalPost.userId;
          if (postOwnerId && postOwnerId !== userId) {
            notifiedUids.add(postOwnerId);
            const ownerQuery = await User.where("uid", "==", postOwnerId)
              .limit(1)
              .get();
            const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;

            await createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: postOwnerId,
              isRead: false,
              recipientEmail: owner?.email,
              category: "social",
              actionType: "POST_REPOSTED",
              title: "Posts Reposted",
              message: `${reposterName || "Someone"} reshared your post.`,
              payload: { postId: originalPostId, originalPostId },
              sendPush: true,
              sendSocket: true,
              saveToDb: true,
            });
          }

          const followersQuery = await Follow.where(
            "followingId",
            "==",
            userId,
          ).get();

          for (const doc of followersQuery.docs) {
            const follow = doc.data();
            const followerId = follow.followerId;
            if (
              followerId &&
              !notifiedUids.has(followerId) &&
              followerId !== userId
            ) {
              notifiedUids.add(followerId);
              const followerSnap = await User.where("uid", "==", followerId)
                .limit(1)
                .get();
              const followerUser = !followerSnap.empty
                ? followerSnap.docs[0].data()
                : null;

              await createNotification({
                notificationId: generateNotificationId("social"),
                recipientId: followerId,
                isRead: false,
                recipientEmail: followerUser?.email,
                category: "social",
                actionType: "NEW_POST",
                title: `New Repost from ${reposterName || "Someone"}`,
                message: `${reposterName || "Someone"} reshared a post.`,
                payload: { postId: originalPostId, authorId: userId },
                sendPush: true,
                sendSocket: true,
                saveToDb: true,
              });
            }
          }
        } catch (err) {
          console.error(
            "Background notification pipeline failure in repost:",
            err,
          );
        }
      });
    }
  } catch (err) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      );
    });
    return res.status(500).json({ message: err.message });
  }
};
export const pollVote = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "pollVoteController";
  const action = "pollVote";
  // The voter is always the signed-in user; a client-supplied userId used to
  // let anyone vote on someone else's behalf.
  const postId = req.params.postId || req.body?.postId;
  const { optionId } = req.body || {};
  const userId = req.user?.id || req.user?.uid;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized user identifier" });
  }
  if (!postId || !optionId) {
    return res.status(400).json({ success: false, message: "Missing required postId or optionId" });
  }

  try {
    const result = await db.runTransaction(async (transaction) => {
      const postSnap = await transaction.get(Posts.where("postId", "==", postId).limit(1));
      if (postSnap.empty) throw new Error("Poll not found");
      const postDoc = postSnap.docs[0];
      const post = postDoc.data();
      if (!canViewPost(post, req.user)) throw new Error("Poll not found");
      if (!post.poll || !Array.isArray(post.poll.options)) throw new Error("Poll not found");

      const expiresAt = post.poll.expiresAt?.toDate
        ? post.poll.expiresAt.toDate()
        : post.poll.expiresAt
          ? new Date(post.poll.expiresAt)
          : null;
      if (expiresAt && !isNaN(expiresAt.getTime()) && new Date() > expiresAt) {
        throw new Error("Poll has expired");
      }
      if (post.poll.options.some((opt) => Array.isArray(opt.votes) && opt.votes.includes(userId))) {
        throw new Error("Already voted");
      }
      const optionIndex = post.poll.options.findIndex((opt) => opt.optionId === optionId);
      if (optionIndex === -1) throw new Error("Poll option not found");

      const options = post.poll.options.map((opt, index) =>
        index === optionIndex ? { ...opt, votes: [...(opt.votes || []), userId] } : opt,
      );
      const updatedPoll = { ...post.poll, options, totalVotes: (post.poll.totalVotes || 0) + 1 };
      transaction.update(postDoc.ref, {
        poll: updatedPoll,
        rankingScore: computeRankingScore({ ...post, poll: updatedPoll }),
        updatedAt: new Date(),
      });
      return { post, updatedPoll };
    });

    const { post, updatedPoll } = result;
    res.status(200).json({
      success: true,
      postId,
      poll: {
        ...updatedPoll,
        expiresAt: updatedPoll.expiresAt?.toDate
          ? updatedPoll.expiresAt.toDate().toISOString()
          : updatedPoll.expiresAt || null,
      },
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(async () => {
      try {
        const postOwnerId = post.originalAuthor;
        if (updatedPoll.totalVotes % 10 === 0 && postOwnerId && postOwnerId !== userId) {
          const ownerQuery = await User.where("uid", "==", postOwnerId).limit(1).get();
          const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;
          await createNotification({
            notificationId: generateNotificationId("social"),
            recipientId: postOwnerId,
            isRead: false,
            recipientEmail: owner?.email,
            category: "social",
            actionType: "POLL_MILESTONE",
            title: "Poll Update",
            message: `${updatedPoll.totalVotes} people have now voted in your poll!`,
            payload: { postId },
            sendPush: true,
            saveToDb: true,
          });
        }
      } catch (err) {
        console.error("Background task failure in pollVote:", err);
      }
    });
  } catch (error) {
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "error", error.message);
    });
    const status = {
      "Poll not found": 404,
      "Poll option not found": 404,
      "Poll has expired": 400,
      "Already voted": 409,
    }[error.message];
    return res
      .status(status || 500)
      .json({ success: false, message: status ? error.message : "Could not register your vote." });
  }
};
export const deletePost = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deletePostController";
  const action = "deletePost";
  try {
    const userUid = req.user?.id || req.user?.uid;
    const { postId } = req.params;

    if (!userUid) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user identifier",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user identifier" });
    }

    if (!postId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing required post identification parameter.",
        );
      });
      return res.status(400).json({
        success: false,
        message: "Missing required post identification parameter.",
      });
    }

    const [result, authorQuery] = await Promise.all([
      db.runTransaction(async (transaction) => {
        const postQuery = await Posts.where("postId", "==", postId)
          .where("originalAuthor", "==", userUid)
          .limit(1)
          .get();

        if (postQuery.empty) {
          throw new Error(
            "Posts record not found or unauthorized deletion access.",
          );
        }

        const postDoc = postQuery.docs[0];
        const postData = postDoc.data();

        transaction.delete(postDoc.ref);

        return postData;
      }),
      User.where("uid", "==", userUid).limit(1).get(),
    ]);

    res.status(200).json({
      success: true,
      message: "Posts entry successfully unlinked and purged.",
      data: { postId },
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(async () => {
      const author = !authorQuery.empty ? authorQuery.docs[0].data() : null;
      const authorEmail = author ? author.email : req.user.email;
      const authorName = author ? author.firstname : req.user.firstname;
      const cleanupPromises = [];

      if (result.media) {
        const mediaList = Array.isArray(result.media)
          ? result.media
          : [result.media];
        const mediaUrls = [];

        mediaList.forEach((m) => {
          if (typeof m === "string") {
            mediaUrls.push(m);
          } else if (m && typeof m === "object") {
            if (Array.isArray(m.url)) {
              mediaUrls.push(...m.url);
            } else if (typeof m.url === "string") {
              mediaUrls.push(m.url);
            }
          }
        });

        const bucket = storage().bucket();

        mediaUrls.forEach((url) => {
          if (
            typeof url === "string" &&
            url.includes("firebasestorage.googleapis.com")
          ) {
            try {
              const decodedUrl = decodeURIComponent(url);
              const pathStartIndex = decodedUrl.indexOf("/o/") + 3;
              const pathEndIndex = decodedUrl.indexOf("?");
              const filePath =
                pathEndIndex !== -1
                  ? decodedUrl.substring(pathStartIndex, pathEndIndex)
                  : decodedUrl.substring(pathStartIndex);

              cleanupPromises.push(
                bucket
                  .file(filePath)
                  .delete()
                  .catch((err) =>
                    console.error(
                      `Firebase file deletion failed for post media path: ${filePath}`,
                      err,
                    ),
                  ),
              );
            } catch (parseError) {
              console.error(
                `Error parsing Firebase media URL for deletion: ${url}`,
                parseError,
              );
            }
          }
        });
      }

      cleanupPromises.push(
        createNotification({
          notificationId: generateNotificationId("social"),
          recipientId: userUid,
          isRead: false,
          recipientEmail: authorEmail,
          category: "social",
          actionType: "POST_DELETION",
          title: "Posts Removed",
          message: `Your post has been successfully deleted from your feed.`,
          entityId: postId,
          entityType: "post",
          payload: {
            username: authorName,
            postId: postId,
          },
        }).catch((err) =>
          console.error(
            "Non-blocking post deletion log emission failure:",
            err,
          ),
        ),
      );

      await Promise.all(cleanupPromises).catch((err) =>
        console.error(
          "Background cleanup pipeline failure in deletePost:",
          err,
        ),
      );
    });
  } catch (error) {
    console.error(
      "Global crash layer hit in deletePostController:",
      error.message,
    );
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    const statusCode = error.message.includes("not found") ? 404 : 500;
    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 404
          ? error.message
          : "Internal application routing anomaly.",
    });
  }
};
export const toggleCommentLike = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleCommentLikeController";
  const action = "toggleCommentLike";
  const { postId, commentId } = req.params;
  const userId = req.user?.id || req.user?.uid;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized user identifier" });
  }

  try {
    const commentRef = Comments.doc(commentId);
    const result = await db.runTransaction(async (transaction) => {
      const commentDoc = await transaction.get(commentRef);
      if (!commentDoc.exists) throw new Error("Comment not found");
      const commentData = commentDoc.data();
      if (postId && commentData.postId !== postId) throw new Error("Comment not found");
      // Older comments stored `likes: 0`; treat anything but an array as none.
      const likes = Array.isArray(commentData.likes) ? commentData.likes : [];
      const wasLiked = likes.includes(userId);
      const updatedLikes = wasLiked ? likes.filter((id) => id !== userId) : [...likes, userId];
      transaction.update(commentRef, { likes: updatedLikes, updatedAt: new Date() });
      return { commentData, wasLiked, updatedLikes };
    });

    const { commentData, wasLiked, updatedLikes } = result;
    res.status(200).json({
      success: true,
      isLiked: !wasLiked,
      likes: updatedLikes,
      likesCount: updatedLikes.length,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(async () => {
      const commentAuthorId = commentData.userId;
      if (wasLiked || !commentAuthorId || commentAuthorId === userId) return;
      try {
        const ownerQuery = await User.where("uid", "==", commentAuthorId).limit(1).get();
        const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;
        if (owner) {
          await createNotification({
            notificationId: generateNotificationId("social"),
            recipientId: commentAuthorId,
            isRead: false,
            recipientEmail: owner.email,
            category: "social",
            actionType: "COMMENT_LIKED",
            title: "New Like",
            message: `${req.user?.firstname || "Someone"} liked your comment.`,
            payload: { commentId, postId: commentData.postId, userId },
            sendPush: true,
            saveToDb: true,
          });
        }
      } catch (err) {
        console.error("Background notification failure in toggleCommentLike:", err);
      }
    });
  } catch (err) {
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "error", err.message);
    });
    const notFound = err.message === "Comment not found";
    return res
      .status(notFound ? 404 : 500)
      .json({ success: false, message: notFound ? err.message : "Could not update like." });
  }
};
export const fetchPostComments = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchPostCommentsController";
  const action = "fetchPostComments";
  try {
    const { postId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const parentId = req.query.parentId ? String(req.query.parentId) : null;
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    const postDoc = await findPostDoc(postId);
    const post = postDoc ? { id: postDoc.id, ...postDoc.data() } : null;
    if (!post || !canViewPost(post, req.user)) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Single-field query (no composite index needed); pages are cut in memory
    // with a keyset cursor so new comments never shift or repeat a page.
    const snap = await Comments.where("postId", "==", post.postId || postId).get();
    const all = snap.docs.map((doc) => {
      const data = doc.data();
      const created = data.createdAt || data.timestamp;
      const ms = created?.toMillis
        ? created.toMillis()
        : created?._seconds
          ? created._seconds * 1000
          : new Date(created || 0).getTime() || 0;
      return { id: data.id || doc.id, data, ms };
    });

    const replyCounts = new Map();
    const repliesByParent = new Map();
    all.forEach((c) => {
      const p = c.data.parentId || null;
      if (!p) return;
      replyCounts.set(p, (replyCounts.get(p) || 0) + 1);
      if (!repliesByParent.has(p)) repliesByParent.set(p, []);
      repliesByParent.get(p).push(c);
    });

    const isRootPage = !parentId;
    // Top-level comments: newest first. Replies: oldest first (read as a thread).
    const pool = all
      .filter((c) => (c.data.parentId || null) === parentId)
      .sort((a, b) =>
        isRootPage
          ? b.ms - a.ms || (b.id < a.id ? -1 : 1)
          : a.ms - b.ms || (a.id < b.id ? -1 : 1),
      );
    let startIndex = 0;
    if (cursor) {
      const [cms, cid] = cursor.split("_");
      const cursorMs = Number(cms);
      const idx = pool.findIndex((c) =>
        isRootPage
          ? c.ms < cursorMs || (c.ms === cursorMs && c.id < cid)
          : c.ms > cursorMs || (c.ms === cursorMs && c.id > cid),
      );
      startIndex = idx === -1 ? pool.length : idx;
    }
    const page = pool.slice(startIndex, startIndex + limit);
    const last = page[page.length - 1];
    const hasMore = startIndex + limit < pool.length;

    // Preview the first two replies under each top-level comment.
    const previews = isRootPage
      ? page.flatMap((c) =>
          (repliesByParent.get(c.id) || [])
            .sort((a, b) => a.ms - b.ms)
            .slice(0, 2),
        )
      : [];
    const authorMap = await loadUsersByUid(
      [...page, ...previews].map((c) => c.data.userId),
    );
    const shape = (c) => ({
      ...normalizeComment(c.id, c.data, authorMap),
      replyCount: replyCounts.get(c.id) || 0,
    });

    res.status(200).json({
      success: true,
      comments: page.map((c) => ({
        ...shape(c),
        replies: isRootPage
          ? (repliesByParent.get(c.id) || [])
              .sort((a, b) => a.ms - b.ms)
              .slice(0, 2)
              .map(shape)
          : [],
      })),
      nextCursor: hasMore && last ? `${last.ms}_${last.id}` : null,
      total: all.length,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (err) {
    console.error("Fetch comments error:", err.message);
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "error", err.message);
    });
    return res.status(500).json({ success: false, message: "Could not load comments." });
  }
};
export const searchGifs = async (req, res) => {
  const key = process.env.GIPHY_API_KEY;
  if (!key) {
    return res.status(200).json({ success: true, enabled: false, results: [] });
  }
  try {
    const kind = req.query.type === "stickers" ? "stickers" : "gifs";
    const q = String(req.query.q || "").trim().slice(0, 50);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 24, 1), 50);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const params = new URLSearchParams({
      api_key: key,
      limit: String(limit),
      offset: String(offset),
      rating: "pg-13",
      ...(q ? { q } : {}),
    });
    const endpoint = `https://api.giphy.com/v1/${kind}/${q ? "search" : "trending"}?${params}`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`GIPHY responded ${response.status}`);
    const body = await response.json();
    const results = (body.data || [])
      .map((item) => {
        const full = item.images?.fixed_width || item.images?.original;
        const small =
          item.images?.fixed_width_small || item.images?.fixed_width_downsampled || full;
        return full?.url
          ? {
              id: item.id,
              url: full.url,
              previewUrl: small?.url || full.url,
              width: Number(full.width) || null,
              height: Number(full.height) || null,
              title: item.title || "",
            }
          : null;
      })
      .filter(Boolean);
    const total = body.pagination?.total_count ?? 0;
    res.status(200).json({
      success: true,
      enabled: true,
      results,
      nextOffset: offset + results.length < total ? offset + results.length : null,
    });
  } catch (err) {
    console.error("GIF search error:", err.message);
    res.status(502).json({ success: false, enabled: true, results: [], message: "GIF search is unavailable right now." });
  }
};
