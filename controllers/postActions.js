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
import { getPriorityReposter } from "../utils/reposterPriorityChecker.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { setImmediate } from "timers";
import { calculateRankingScore } from "../utils/postRanker.js";
let visionClient = null;
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
  const { commentId } = req.params;
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
    return res.status(401).json({ error: "Unauthorized user identifier" });
  }

  if (!commentId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing commentId parameter",
      );
    });
    return res.status(400).json({ error: "Missing commentId parameter" });
  }

  try {
    const commentRef = Comments.doc(commentId);

    const result = await db.runTransaction(async (transaction) => {
      const commentDoc = await transaction.get(commentRef);
      if (!commentDoc.exists) {
        throw new Error("Comment not found");
      }

      const commentData = commentDoc.data();
      const likes = commentData.likes || [];

      const isLiked = likes.includes(userId);
      const updatedLikes = isLiked
        ? likes.filter((id) => id !== userId)
        : [...likes, userId];

      transaction.update(commentRef, {
        likes: updatedLikes,
        updatedAt: new Date(),
      });

      return {
        commentData,
        isLiked,
        updatedLikes,
      };
    });

    const { commentData, isLiked, updatedLikes } = result;
    const commentAuthorId = commentData.userId;
    const nowLiked = !isLiked;

    res.status(200).json({
      isLiked: nowLiked,
      likesCount: updatedLikes.length,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(async () => {
      if (nowLiked && commentAuthorId && commentAuthorId !== userId) {
        try {
          const [likerQuery, ownerQuery] = await Promise.all([
            User.where("uid", "==", userId).limit(1).get(),
            User.where("uid", "==", commentAuthorId).limit(1).get(),
          ]);

          const liker = !likerQuery.empty ? likerQuery.docs[0].data() : null;
          const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;

          if (liker && owner) {
            await createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: commentAuthorId,
              recipientEmail: owner.email,
              category: "social",
              actionType: "COMMENT_LIKED",
              title: "New Like",
              message: `${liker.firstname || "Someone"} liked your comment.`,
              payload: { commentId, postId: commentData.postId, userId },
              sendPush: true,
              saveToDb: true,
            });
          }
        } catch (err) {
          console.error(
            "Background notification failure in toggleCommentLike:",
            err,
          );
        }
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
    const statusCode = err.message === "Comment not found" ? 404 : 500;
    if (statusCode === 404) {
      return res.status(404).send("Comment not found");
    }
    return res.status(500).send(err.message);
  }
};

//Tested and trusted using jest
export const fetchPostUsingPostId = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchPostUsingPostIdController";
  const action = "fetchPostUsingPostId";
  const userId = req.user?.id || req.user?.uid;

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
      return res.status(400).json({ error: "Missing postId parameter" });
    }

    let postQuery = await Posts.where("postId", "==", postId).limit(1).get();
    let isRepost = false;
    let repostData = null;

    if (postQuery.empty) {
      const repostQuery = await PostReposters.where("postId", "==", postId)
        .limit(1)
        .get();
      if (!repostQuery.empty) {
        isRepost = true;
        repostData = repostQuery.docs[0].data();
        postQuery = await Posts.where("postId", "==", repostData.postId)
          .limit(1)
          .get();
      }
    }

    if (postQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Post not found",
        );
      });
      return res.status(404).json({ error: "Post not found" });
    }

    const postDoc = postQuery.docs[0];
    const post = postDoc.data();

    if (post.status === "hidden") {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Post not found",
        );
      });
      return res.status(404).json({ error: "Post not found" });
    }

    const authorId = post.originalAuthor || post.userId?.uid || post.userId;
    const targetPostId = isRepost ? repostData.postId : postId;
    const [userQuery, commentsSnapshot, repostersSnapshot] = await Promise.all([
      authorId
        ? User.where("uid", "==", authorId).limit(1).get()
        : Promise.resolve(null),
      Comments.where("postId", "==", targetPostId).get(),
      PostReposters.where("postId", "==", targetPostId).get(),
    ]);

    let authorDetails = null;
    if (userQuery && !userQuery.empty) {
      const uData = userQuery.docs[0].data();
      authorDetails = {
        firstname: uData.firstname || null,
        lastname: uData.lastname || null,
        username: uData.username || null,
        tier: uData.tier || null,
        organizationName: uData.organizationName || null,
      };
    }
    const commentUserIds = [
      ...new Set(
        commentsSnapshot.docs.map((doc) => doc.data().userId).filter(Boolean),
      ),
    ];
    let commentUsersMap = new Map();

    if (commentUserIds.length > 0) {
      const commentUsersPromises = commentUserIds.map(async (cUserId) => {
        const uSnap = await Users.where("uid", "==", cUserId).limit(1).get();
        if (!uSnap.empty) {
          const cuData = uSnap.docs[0].data();
          return {
            uid: cuData.uid,
            firstname: cuData.firstname,
            lastname: cuData.lastname,
            username: cuData.username,
            profilePic: cuData.profilePic,
          };
        }
        return null;
      });

      const resolvedCommentUsers = await Promise.all(commentUsersPromises);
      resolvedCommentUsers.forEach((cu) => {
        if (cu) commentUsersMap.set(cu.uid, cu);
      });
    }

    const comments = commentsSnapshot.docs.map((doc) => {
      const commentData = doc.data();
      const commentUser = commentUsersMap.get(commentData.userId) || null;
      return {
        ...commentData,
        userId: commentUser || commentData.userId,
      };
    });

    const repostersDetails = repostersSnapshot.docs.map((doc) => doc.data());

    const featuredReposter =
      typeof getPriorityReposter === "function"
        ? await getPriorityReposter(repostersDetails, userId)
        : null;
    res.status(200).json({
      ...post,
      ...(isRepost ? repostData : {}),
      isRepost,
      authorDetails,
      comments,
      repostersDetails,
      featuredReposter,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (err) {
    console.error("Fetch single post error:", err.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      );
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
        if (user.uid && !notifiedUids.has(user.uid)) {
          notifiedUids.add(user.uid);
          notificationPromises.push(
            createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: user.uid,
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
          notificationPromises.push(
            createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: followerUser.uid,
              recipientEmail: followerUser.email,
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
      data: newPostData,
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

  try {
    const result = await db.runTransaction(async (transaction) => {
      const postQuery = await Posts.where("postId", "==", postId)
        .limit(1)
        .get();
      if (postQuery.empty) {
        throw new Error("Post not found");
      }

      const postDoc = postQuery.docs[0];
      const post = postDoc.data();
      const likes = post.likes || [];

      const isLiked = likes.includes(userId);
      const updatedLikes = isLiked
        ? likes.filter((id) => id !== userId)
        : [...likes, userId];
      const likesCount = updatedLikes.length;
      const impressionsScore = (post.impressions || 0) * 0.1;
      const engagementScore = likesCount * 2;

      const createdAtTime = post.createdAt?.toMillis
        ? post.createdAt.toMillis()
        : new Date(post.createdAt || Date.now()).getTime();
      const timeScore = createdAtTime / 1000000000;

      const newRankingScore = impressionsScore + engagementScore + timeScore;
      transaction.update(postDoc.ref, {
        likes: updatedLikes,
        rankingScore: newRankingScore,
        updatedAt: new Date(),
      });

      const userQuery = await User.where("uid", "==", userId).limit(1).get();
      if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        const userLikes = userData.likes || [];

        const updatedUserLikes = isLiked
          ? userLikes.filter((id) => id !== postId)
          : [...userLikes, postId];

        transaction.update(userDoc.ref, {
          likes: updatedUserLikes,
          updatedAt: new Date(),
        });
      }

      const repostersSnapshot = await PostReposters.where(
        "postId",
        "==",
        postId,
      ).get();
      const repostersCount = repostersSnapshot.size;

      const commentsSnapshot = await Comments.where(
        "postId",
        "==",
        postId,
      ).get();
      const commentsCount = commentsSnapshot.size;

      return {
        post: {
          id: postDoc.id,
          ...post,
          likes: updatedLikes,
          rankingScore: newRankingScore,
          commentsCount,
        },
        isLiked,
        repostersCount,
        commentsCount,
      };
    });

    const updatedPost = result.post;
    const isLiked = result.isLiked;
    const repostersCount = result.repostersCount;
    const commentsCount = result.commentsCount;
    const message = isLiked ? "You unliked a post." : "You liked a post.";

    res.json({ updatedPost, message });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    // Background tasks (notifications and socket emission remain untouched)
    setImmediate(async () => {
      try {
        const postOwnerId = updatedPost.originalAuthor || updatedPost.userId;
        if (!isLiked && postOwnerId && postOwnerId !== userId) {
          const [likerQuery, ownerQuery] = await Promise.all([
            User.where("uid", "==", userId).limit(1).get(),
            User.where("uid", "==", postOwnerId).limit(1).get(),
          ]);

          const liker = !likerQuery.empty ? likerQuery.docs[0].data() : null;
          const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;

          if (liker && owner) {
            await createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: postOwnerId,
              recipientEmail: owner.email,
              category: "social",
              actionType: "POST_LIKED",
              title: "New Like",
              message: `${liker.firstname || "Someone"} liked your post.`,
              payload: { postId: updatedPost.postId, userId },
              sendPush: true,
              saveToDb: true,
            });
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
          "Background notification/socket pipeline error in toggleLike:",
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
    return res.status(500).json({ message: err.message });
  }
};
export const toggleBookmark = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleBookmarkController";
  const action = "toggleBookmark";
  const { postId } = req.params;
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

  try {
    const result = await db.runTransaction(async (transaction) => {
      const postQuery = await Posts.where("postId", "==", postId)
        .limit(1)
        .get();
      if (postQuery.empty) {
        throw new Error("Post not found");
      }

      const postDoc = postQuery.docs[0];
      const post = postDoc.data();
      const bookmarks = post.bookmarks || [];

      const isBookmarked = bookmarks.includes(userId);
      const updatedBookmarks = isBookmarked
        ? bookmarks.filter((id) => id !== userId)
        : [...bookmarks, userId];

      const bookmarksCount = updatedBookmarks.length;
      const likesCount = (post.likes || []).length;

      const impressionsScore = (post.impressions || 0) * 0.1;
      const engagementScore = likesCount * 2 + bookmarksCount * 3;

      const createdAtTime = post.createdAt?.toMillis
        ? post.createdAt.toMillis()
        : new Date(post.createdAt || Date.now()).getTime();
      const timeScore = createdAtTime / 1000000000;

      const newRankingScore = impressionsScore + engagementScore + timeScore;
      transaction.update(postDoc.ref, {
        bookmarks: updatedBookmarks,
        rankingScore: newRankingScore,
        updatedAt: new Date(),
      });

      const userQuery = await User.where("uid", "==", userId).limit(1).get();
      if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        const userBookmarks = userData.bookmarks || [];

        const updatedUserBookmarks = isBookmarked
          ? userBookmarks.filter((id) => id !== postId)
          : [...userBookmarks, postId];

        transaction.update(userDoc.ref, {
          bookmarks: updatedUserBookmarks,
          updatedAt: new Date(),
        });
      }

      const repostersSnapshot = await PostReposters.where(
        "postId",
        "==",
        postId,
      ).get();
      const repostersCount = repostersSnapshot.size;

      const commentsSnapshot = await Comments.where(
        "postId",
        "==",
        postId,
      ).get();
      const commentsCount = commentsSnapshot.size;

      return {
        post: {
          id: postDoc.id,
          ...post,
          bookmarks: updatedBookmarks,
          rankingScore: newRankingScore,
          commentsCount,
        },
        isBookmarked,
        repostersCount,
        commentsCount,
      };
    });

    const updatedPost = result.post;
    const isBookmarked = result.isBookmarked;
    const repostersCount = result.repostersCount;
    const commentsCount = result.commentsCount;

    res.status(200).json({
      isBookmarked: !isBookmarked,
      count: updatedPost.bookmarks.length,
      message: isBookmarked
        ? "You removed a post from your bookmarks"
        : "You bookmarked a post",
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(() => {
      try {
        const io = req.app.get("socketio");
        if (io && updatedPost) {
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
          "Background socket emission error in toggleBookmark:",
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
    return res.status(statusCode).json({ message: err.message });
  }
};
export const addComment = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "addCommentController";
  const action = "addComment";
  const { postId } = req.params;
  const { comment, text, parentId } = req.body;
  const commentText = comment || text;
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

  if (!commentText) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing comment text",
      );
    });
    return res.status(400).json({ error: "Comment text is required." });
  }

  try {
    const commentId = Math.random().toString(36).slice(2, 11);
    const createdAt = new Date();

    const result = await db.runTransaction(async (transaction) => {
      const [postQuery, commentsCountSnapshot] = await Promise.all([
        Posts.where("postId", "==", postId).limit(1).get(),
        Comments.where("postId", "==", postId)
          .where("parentId", "==", null)
          .get(),
      ]);

      if (postQuery.empty) {
        throw new Error("Post not found");
      }

      const postDoc = postQuery.docs[0];
      const postData = postDoc.data();

      const currentCommentsCount = commentsCountSnapshot.size;
      const newCommentsCount = currentCommentsCount + 1;

      const likesCount = (postData.likes || []).length;
      const bookmarksCount = (postData.bookmarks || []).length;

      const impressionsScore = (postData.impressions || 0) * 0.1;
      const engagementScore =
        likesCount * 2 + bookmarksCount * 3 + newCommentsCount * 4;

      const createdAtTime = postData.createdAt?.toMillis
        ? postData.createdAt.toMillis()
        : new Date(postData.createdAt || Date.now()).getTime();
      const timeScore = createdAtTime / 1000000000;

      const newRankingScore = impressionsScore + engagementScore + timeScore;
      const userQuery = await User.where("uid", "==", userId).limit(1).get();
      const commenter = !userQuery.empty ? userQuery.docs[0].data() : null;

      const newCommentData = {
        id: commentId,
        postId,
        userId,
        username: commenter?.username || commenter?.firstname || "Anonymous",
        profilePic:
          Array.isArray(commenter?.profilePic) &&
          commenter.profilePic.length > 0
            ? commenter.profilePic[commenter.profilePic.length - 1]
            : "",
        text: commentText,
        parentId: parentId || null,
        timestamp: createdAt,
        likes: 0,
      };

      const commentDocRef = Comments.doc(commentId);
      transaction.set(commentDocRef, newCommentData);

      transaction.update(postDoc.ref, {
        commentsCount: newCommentsCount,
        rankingScore: newRankingScore,
        updatedAt: createdAt,
      });

      const repostersSnapshot = await PostReposters.where(
        "postId",
        "==",
        postId,
      ).get();
      const repostersCount = repostersSnapshot.size;

      return {
        postData: {
          ...postData,
          commentsCount: newCommentsCount,
          rankingScore: newRankingScore,
        },
        newCommentData,
        commenter,
        repostersCount,
      };
    });

    const { postData, newCommentData, commenter, repostersCount } = result;

    const populatedComment = {
      ...newCommentData,
      userId: commenter
        ? {
            uid: commenter.uid || userId,
            firstname: commenter.firstname,
            lastname: commenter.lastname,
            profilePic: commenter.profilePic,
            username: commenter.username,
          }
        : { uid: userId },
    };

    res.status(200).json(populatedComment);

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(async () => {
      try {
        const io = req.app.get("socketio");
        if (io) {
          io.emit("new_comment", {
            postId,
            comment: populatedComment,
          });
          io.emit("post_stats_updated", {
            postId: postData.postId,
            stats:
              typeof getPostStats === "function"
                ? getPostStats(postData, repostersCount, postData.commentsCount)
                : postData,
          });
        }

        const postAuthorId = postData.originalAuthor || postData.userId;
        if (postAuthorId && postAuthorId !== userId) {
          const ownerQuery = await db
            .collection("users")
            .where("uid", "==", postAuthorId)
            .limit(1)
            .get();
          const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;

          await createNotification({
            notificationId: generateNotificationId("social"),
            recipientId: postAuthorId,
            recipientEmail: owner?.email,
            category: "social",
            actionType: "POST_COMMENTED",
            title: "New Comment",
            message: `${commenter?.firstname || "Someone"} commented on your post: "${commentText.substring(0, 30)}..."`,
            payload: { postId, commentId },
            sendPush: true,
            saveToDb: true,
          });
        }
      } catch (err) {
        console.error(
          "Background notification/socket pipeline error in addComment:",
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
    return res.status(statusCode).json({ error: err.message });
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
        message: "You undid a repost action",
        repostsCount: updatedOriginal.repostsCount || 0,
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
        message: "Posts repost action completed successfully.",
        repostsCount: updatedOriginal.repostsCount || 0,
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
  const { postId, optionId } = req.body;
  const userId = req.body.userId || req.user?.id || req.user?.uid;

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
    return res.status(401).json({ error: "Unauthorized user identifier" });
  }

  if (!postId || !optionId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required postId or optionId",
      );
    });
    return res
      .status(400)
      .json({ error: "Missing required postId or optionId" });
  }

  try {
    const result = await db.runTransaction(async (transaction) => {
      const postQuery = await Posts.where("postId", "==", postId)
        .limit(1)
        .get();
      if (postQuery.empty) {
        throw new Error("Poll not found");
      }

      const postDoc = postQuery.docs[0];
      const post = postDoc.data();

      if (!post.poll || !Array.isArray(post.poll.options)) {
        throw new Error("Poll not found");
      }
      if (post.poll.expiresAt && new Date() > new Date(post.poll.expiresAt)) {
        throw new Error("Poll has expired");
      }
      const hasVoted = post.poll.options.some(
        (opt) => Array.isArray(opt.votes) && opt.votes.includes(userId),
      );

      if (hasVoted) {
        throw new Error("Already voted");
      }
      const optionIndex = post.poll.options.findIndex(
        (opt) => opt.optionId === optionId,
      );
      if (optionIndex === -1) {
        throw new Error("Poll option not found");
      }
      const updatedOptions = post.poll.options.map((opt, index) => {
        if (index === optionIndex) {
          return {
            ...opt,
            votes: [...(opt.votes || []), userId],
          };
        }
        return opt;
      });

      const newTotalVotes = (post.poll.totalVotes || 0) + 1;

      const updatedPoll = {
        ...post.poll,
        options: updatedOptions,
        totalVotes: newTotalVotes,
      };

      // --- CALCULATE NEW RANKING SCORE ---
      const likesCount = (post.likes || []).length;
      const bookmarksCount = (post.bookmarks || []).length;

      const impressionsScore = (post.impressions || 0) * 0.1;
      const engagementScore =
        likesCount * 2 + bookmarksCount * 3 + newTotalVotes * 3; // Poll votes factor in!

      const createdAtTime = post.createdAt?.toMillis
        ? post.createdAt.toMillis()
        : new Date(post.createdAt || Date.now()).getTime();
      const timeScore = createdAtTime / 1000000000;

      const newRankingScore = impressionsScore + engagementScore + timeScore;
      // -----------------------------------

      transaction.update(postDoc.ref, {
        poll: updatedPoll,
        rankingScore: newRankingScore, // <--- Updated score saved atomically!
        updatedAt: new Date(),
      });

      const [repostersSnapshot, commentsSnapshot] = await Promise.all([
        PostReposters.where("postId", "==", postId).get(),
        Comments.where("postId", "==", postId).get(),
      ]);

      return {
        post: {
          id: postDoc.id,
          ...post,
          poll: updatedPoll,
          rankingScore: newRankingScore,
        },
        repostersCount: repostersSnapshot.size,
        commentsCount: commentsSnapshot.size,
      };
    });

    const updatedPost = result.post;
    const repostersCount = result.repostersCount;
    const commentsCount = result.commentsCount;

    res.status(200).json(updatedPost);

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    setImmediate(async () => {
      try {
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

        const postOwnerId = updatedPost.originalAuthor || updatedPost.userId;
        if (
          updatedPost.poll.totalVotes % 10 === 0 &&
          postOwnerId &&
          postOwnerId !== userId
        ) {
          const ownerQuery = await User.where("uid", "==", postOwnerId)
            .limit(1)
            .get();
          const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;

          await createNotification({
            notificationId: generateNotificationId("social"),
            recipientId: postOwnerId,
            recipientEmail: owner?.email,
            category: "social",
            actionType: "POLL_MILESTONE",
            title: "Poll Update",
            message: `${updatedPost.poll.totalVotes} people have now voted in your poll!`,
            payload: { postId: updatedPost.postId },
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    const clientErrors = [
      "Poll not found",
      "Poll has expired",
      "Already voted",
      "Poll option not found",
    ];
    const statusCode = clientErrors.includes(error.message)
      ? error.message === "Poll not found" ||
        error.message === "Poll option not found"
        ? 404
        : 400
      : 500;
    return res.status(statusCode).json({ error: error.message });
  }
};