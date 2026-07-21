import { createNotification } from "../services/notification.js";
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

const getPostStats = (post) => ({
  likes: post.likes || [],
  bookmarks: post.bookmarks || [],
  impressions: post.impressions || 0,
  repostsCount: post.repostersDetails.length || 0,
  commentsCount: post.commentsCount || 0,
  totalVotes: post.poll?.totalVotes || 0,
});
export const moderateContent = async (postId, content, media) => {
  if (media?.url && media.url.length > 0) {
    scan(media.url, content)
      .then(async (result) => {
        if (result?.isViolation) {
          const postQuery = await Posts.where("postId", "==", postId)
            .limit(1)
            .get();
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
                reason: result.flaggedCategory,
                confidence: result.confidence,
              },
              senderId: "system",
            },
            false,
          );
        }
      })
      .catch(console.error);
  } else {
    return;
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
    const userId = req.user.id || req.user.uid;

    let processedMedia = media ? { ...media } : null;
    if (
      processedMedia?.mediaType === "video" &&
      Array.isArray(processedMedia.url)
    ) {
      processedMedia.url = [processedMedia.url[0]];
    }
    const authorQuery = await User.where("uid", "==", userId).limit(1).get();
    if (authorQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Author not found",
      );
      return res.status(404).json({ message: "Author not found" });
    }

    const authorDoc = authorQuery.docs[0];
    const author = authorDoc.data();
    const authorName =
      `${author.firstname || ""} ${author.lastname || ""}`.trim();
    const newPostId = generatePostId();
    const resolvedPostType = postType || (poll ? "poll" : "media");

    const newPostData = {
      postId: newPostId,
      originalAuthor: userId,
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
    await postDocRef.set(newPostData);

    moderateContent(newPostId, content, newPostData.media).catch((err) =>
      console.error("Moderation trigger failed:", err),
    );

    const mentionedUsernames = extractMentions(content || "");
    let notifiedUids = new Set();

    if (mentionedUsernames.length > 0) {
      const chunks = [];
      for (let i = 0; i < mentionedUsernames.length; i += 10) {
        chunks.push(mentionedUsernames.slice(i, i + 10));
      }

      for (const chunk of chunks) {
        const mentionedQuery = await User.where("username", "in", chunk).get();
        mentionedQuery.forEach((doc) => {
          const user = doc.data();
          if (user.uid) {
            notifiedUids.add(user.uid);
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
            });
          }
        });
      }
    }
    const followsQuery = await Follow.where("followingId", "==", userId).get();
    followsQuery.forEach((doc) => {
      const follow = doc.data();
      const followerId = follow.followerId;
      if (
        followerId &&
        !notifiedUids.has(followerId) &&
        followerId !== userId
      ) {
        notifiedUids.add(followerId);
        User.where("uid", "==", followerId)
          .limit(1)
          .get()
          .then((followerQuerySnap) => {
            const followerUser = !followerQuerySnap.empty
              ? followerQuerySnap.docs[0].data()
              : null;
            createNotification({
              notificationId: generateNotificationId("social"),
              recipientId: followerId,
              recipientEmail: followerUser?.email,
              category: "social",
              actionType: "NEW_POST",
              title: `New Posts from ${authorName}`,
              message: `${authorName} just shared a new update.`,
              payload: { postId: newPostData.postId, authorId: userId },
              sendPush: true,
              sendSocket: true,
              saveToDb: true,
            }).catch((err) =>
              console.error("Follower notification failure:", err),
            );
          })
          .catch((err) => console.error("Follower lookup failure:", err));
      }
    });

    if (req.user.usertype !== "enterprise") {
      await authorDoc.ref.update({
        "monthlyStats.libraryUsageSessions":
          (author.monthlyStats?.libraryUsageSessions || 0) + 1,
        updatedAt: new Date(),
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");

    res
      .status(201)
      .json({ message: "Posts created successfully", data: newPostData });
  } catch (error) {
    console.error("Create Posts Error:", error.message);
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
    const userId = req.user.id || req.user.uid;
    const postQuery = await Posts.where("postId", "==", postId)
      .where("originalAuthor", "==", userId)
      .limit(1)
      .get();

    if (postQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Posts not found or unauthorized to edit.",
      );
      return res
        .status(404)
        .json({ message: "Posts not found or unauthorized to edit." });
    }

    const postDocRef = postQuery.docs[0].ref;
    const post = postQuery.docs[0].data();

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

    await postDocRef.update(updatePayload);
    const authorQuery = await User.where("uid", "==", userId).limit(1).get();
    const author = !authorQuery.empty ? authorQuery.docs[0].data() : null;
    const authorName = author
      ? `${author.firstname || ""} ${author.lastname || ""}`.trim()
      : "Someone";

    const explicitUsernames = extractMentions(updatedContent || "");
    if (explicitUsernames.length > 0) {
      const chunks = [];
      for (let i = 0; i < explicitUsernames.length; i += 10) {
        chunks.push(explicitUsernames.slice(i, i + 10));
      }

      for (const chunk of chunks) {
        const usersToTagQuery = await User.where("username", "in", chunk).get();
        usersToTagQuery.forEach((doc) => {
          const targetUser = doc.data();
          if (targetUser.uid && targetUser.uid !== userId) {
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
            });
          }
        });
      }
    }

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
    });

    logControllerPerformance(controllerName, action, startTime, "success");

    res.status(200).json({
      message: "Posts updated successfully",
      post: { ...post, ...updatePayload },
    });
  } catch (error) {
    console.error("Update Posts Error:", error.message);
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
export const deletePost = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deletePostController";
  const action = "deletePost";
  try {
    const userUid = req.user.id || req.user.uid;
    const { postId } = req.params;

    if (!postId) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required post identification parameter.",
      );
      return res.status(400).json({
        success: false,
        message: "Missing required post identification parameter.",
      });
    }

    const result = await db.runTransaction(async (transaction) => {
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
    });

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

            bucket
              .file(filePath)
              .delete()
              .catch((err) =>
                console.error(
                  `Firebase file deletion failed for post media path: ${filePath}`,
                  err,
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

    const authorQuery = await User.where("uid", "==", userUid).limit(1).get();
    const author = !authorQuery.empty ? authorQuery.docs[0].data() : null;
    const authorEmail = author ? author.email : req.user.email;
    const authorName = author ? author.firstname : req.user.firstname;

    await createNotification({
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
      console.error("Non-blocking post deletion log emission failure:", err),
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "Posts entry successfully unlinked and purged.",
      data: { postId },
    });
  } catch (error) {
    console.error(
      "Global crash layer hit in deletePostController:",
      error.message,
    );
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
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
export const toggleLike = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleLikeController";
  const action = "toggleLike";
  const { postId } = req.params;
  const userId = req.user.id || req.user.uid;

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

      transaction.update(postDoc.ref, {
        likes: updatedLikes,
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

      return {
        post: { ...post, likes: updatedLikes },
        isLiked,
      };
    });

    const updatedPost = result.post;
    const isLiked = result.isLiked;
    const message = isLiked ? "You unliked a post." : "You liked a post.";

    const postOwnerId = updatedPost.originalAuthor || updatedPost.userId;
    if (!isLiked && postOwnerId && postOwnerId !== userId) {
      User.where("uid", "==", userId)
        .limit(1)
        .get()
        .then(async (likerQuery) => {
          const liker = !likerQuery.empty ? likerQuery.docs[0].data() : null;
          const ownerQuery = await Users.where("uid", "==", postOwnerId)
            .limit(1)
            .get();
          const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;

          if (liker && owner) {
            createNotification({
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
            }).catch((err) =>
              console.error("Notification emission failure:", err),
            );
          }
        })
        .catch((err) => console.error("Liker lookup failure:", err));
    }

    const io = req.app.get("socketio");
    if (io) {
      io.emit("post_stats_updated", {
        postId: updatedPost.postId,
        stats:
          typeof getPostStats === "function"
            ? getPostStats(updatedPost)
            : updatedPost,
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ updatedPost, message });
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    const statusCode = err.message === "Post not found" ? 404 : 500;
    if (statusCode === 404) {
      return res.status(404).send("Post not found");
    }
    res.status(500).json({ message: err.message });
  }
};
export const toggleBookmark = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleBookmarkController";
  const action = "toggleBookmark";
  const { postId } = req.params;
  const userId = req.user.id || req.user.uid;

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

      transaction.update(postDoc.ref, {
        bookmarks: updatedBookmarks,
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

      return {
        post: { ...post, bookmarks: updatedBookmarks },
        isBookmarked,
      };
    });

    const updatedPost = result.post;
    const isBookmarked = result.isBookmarked;

    const io = req.app.get("socketio");
    if (io && updatedPost) {
      io.emit("post_stats_updated", {
        postId: updatedPost.postId,
        stats:
          typeof getPostStats === "function"
            ? getPostStats(updatedPost)
            : updatedPost,
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      isBookmarked: !isBookmarked,
      count: updatedPost.bookmarks.length,
      message: isBookmarked
        ? "You removed a post from your bookmarks"
        : "You bookmarked a post",
    });
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    const statusCode = err.message === "Post not found" ? 404 : 500;
    res.status(statusCode).json({ message: err.message });
  }
};
export const addComment = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "addCommentController";
  const action = "addComment";
  const { postId } = req.params;
  const { comment, parentId } = req.body;
  const userId = req.user.id || req.user.uid;

  try {
    const commentId = Math.random().toString(36).slice(2, 11);
    const createdAt = new Date();

    const result = await db.runTransaction(async (transaction) => {
      const postQuery = await Posts.where("postId", "==", postId)
        .limit(1)
        .get();
      if (postQuery.empty) {
        throw new Error("Post not found");
      }

      const postDoc = postQuery.docs[0];
      const postData = postDoc.data();
      const currentCommentsCount = postData.commentsCount || 0;

      const newCommentData = {
        commentId,
        postId,
        userId,
        comment,
        parentId: parentId || "",
        likes: [],
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      };

      const commentDocRef = Comments.doc(commentId);
      transaction.set(commentDocRef, newCommentData);
      transaction.update(postDoc.ref, {
        commentsCount: currentCommentsCount + 1,
        updatedAt: createdAt,
      });

      return {
        postData,
        newCommentData,
      };
    });

    const { postData, newCommentData } = result;
    const commenterQuery = await User.where("uid", "==", userId).limit(1).get();
    const commenter = !commenterQuery.empty
      ? commenterQuery.docs[0].data()
      : null;

    const populatedComment = {
      ...newCommentData,
      userId: commenter
        ? {
            uid: commenter.uid,
            firstname: commenter.firstname,
            lastname: commenter.lastname,
            profilePic: commenter.profilePic,
            username: commenter.username,
          }
        : { uid: userId },
    };

    const postAuthorId = postData.originalAuthor || postData.userId;

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
            ? getPostStats({
                ...postData,
                commentsCount: (postData.commentsCount || 0) + 1,
              })
            : postData,
      });
    }

    if (postAuthorId && postAuthorId !== userId) {
      const ownerQuery = await User.where("uid", "==", postAuthorId)
        .limit(1)
        .get();
      const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;

      createNotification({
        notificationId: generateNotificationId("social"),
        recipientId: postAuthorId,
        recipientEmail: owner?.email,
        category: "social",
        actionType: "POST_COMMENTED",
        title: "New Comment",
        message: `${commenter?.firstname || "Someone"} commented on your post: "${comment.substring(0, 30)}..."`,
        payload: { postId, commentId },
        sendPush: true,
        saveToDb: true,
      }).catch((err) => console.error("Notification emission failure:", err));
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(201).json(populatedComment);
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    const statusCode = err.message === "Post not found" ? 404 : 500;
    res.status(statusCode).json({ error: err.message });
  }
};
export const pollVote = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "pollVoteController";
  const action = "pollVote";
  const { postId, optionId } = req.body;
  const userId = req.body.userId || req.user?.id || req.user?.uid;

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

      transaction.update(postDoc.ref, {
        poll: updatedPoll,
        updatedAt: new Date(),
      });

      return {
        ...post,
        poll: updatedPoll,
      };
    });

    const updatedPost = result;

    // --- SOCKET EMISSION ---
    const io = req.app.get("socketio");
    if (io) {
      io.emit("post_stats_updated", {
        postId: updatedPost.postId,
        stats:
          typeof getPostStats === "function"
            ? getPostStats(updatedPost)
            : updatedPost,
      });
    }

    // --- NOTIFICATION LOGIC ---
    const postOwnerId = updatedPost.originalAuthor || updatedPost.userId;
    if (
      updatedPost.poll.totalVotes % 10 === 0 &&
      postOwnerId &&
      postOwnerId !== userId
    ) {
      User.where("uid", "==", postOwnerId)
        .limit(1)
        .get()
        .then((ownerQuery) => {
          const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;
          createNotification({
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
          }).catch((err) =>
            console.error("Notification emission failure:", err),
          );
        })
        .catch((err) => console.error("Owner lookup failure:", err));
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json(updatedPost);
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
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
    res.status(statusCode).json({ error: error.message });
  }
};
export const incrementImpressions = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "incrementImpressionsController";
  const action = "incrementImpressions";
  try {
    const { postId } = req.params;

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

      transaction.update(postDoc.ref, {
        impressions: newImpressions,
        updatedAt: new Date(),
      });

      return {
        ...postData,
        impressions: newImpressions,
      };
    });

    const updatedPost = result;

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
            ? getPostStats(updatedPost)
            : updatedPost,
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      impressions: updatedPost.impressions,
    });
  } catch (err) {
    console.error("Impression error:", err.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    const statusCode = err.message === "Post not found" ? 404 : 500;
    if (statusCode === 404) {
      return res.status(404).send("Post not found");
    }
    res.status(500).send(err.message);
  }
};
export const repost = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "repostController";
  const action = "repost";
  const { originalPostId } = req.body;
  const userId = req.user.id || req.user.uid;

  try {
    const io = req.app.get("socketio");
    const postQuery = await Posts.where("postId", "==", originalPostId)
      .limit(1)
      .get();
    if (postQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Original post details not found.",
      );
      return res
        .status(404)
        .json({ message: "Original post details not found." });
    }

    const postDoc = postQuery.docs[0];
    const originalPost = postDoc.data();

    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Original post details not found.",
      );
      return res
        .status(404)
        .json({ message: "Original post details not found." });
    }
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

        transaction.delete(repostDocRef);
        transaction.update(postDoc.ref, {
          repostsCount: Math.max(0, currentCount - 1),
          updatedAt: new Date(),
        });
      });
      const updatedPostSnap = await postDoc.ref.get();
      const updatedOriginal = updatedPostSnap.data();

      if (io && updatedOriginal) {
        io.emit("post_stats_updated", {
          postId: originalPostId,
          stats:
            typeof getPostStats === "function"
              ? getPostStats(updatedOriginal)
              : updatedOriginal,
        });
      }

      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({
        message: "You undid a repost action",
        repostsCount: updatedOriginal.repostsCount || 0,
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
        profilePic: repostAuthor.profilePic || [],
        repostedAt,
      };

      const repostDocRef = PostReposters.doc(repostId);

      await db.runTransaction(async (transaction) => {
        const latestPostSnap = await transaction.get(postDoc.ref);
        const latestPostData = latestPostSnap.data();
        const currentCount = latestPostData.repostsCount || 0;

        transaction.set(repostDocRef, reposterData);
        transaction.update(postDoc.ref, {
          repostsCount: currentCount + 1,
          updatedAt: new Date(),
        });
      });

      const updatedPostSnap = await postDoc.ref.get();
      const updatedOriginal = updatedPostSnap.data();

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
              ? getPostStats(updatedOriginal)
              : updatedOriginal,
        });
      }

      // --- NOTIFICATION LOGIC ---
      let notifiedUids = new Set();
      const reposterName =
        repostAuthor && repostAuthor.usertype === "enterprise"
          ? repostAuthor.organizationName
          : repostAuthor.firstname;

      const postOwnerId = originalPost.originalAuthor || originalPost.userId;
      if (postOwnerId && postOwnerId !== userId) {
        notifiedUids.add(postOwnerId);
        const ownerQuery = await User.where("uid", "==", postOwnerId)
          .limit(1)
          .get();
        const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;

        createNotification({
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
        }).catch((err) => console.error("Notification emission failure:", err));
      }
      const followersQuery = await Follow.where(
        "followingId",
        "==",
        userId,
      ).get();
      followersQuery.forEach(async (doc) => {
        const follow = doc.data();
        const followerId = follow.followerId;
        if (
          followerId &&
          !notifiedUids.has(followerId) &&
          followerId !== userId
        ) {
          notifiedUids.add(followerId);
          Users.where("uid", "==", followerId)
            .limit(1)
            .get()
            .then((followerSnap) => {
              const followerUser = !followerSnap.empty
                ? followerSnap.docs[0].data()
                : null;
              createNotification({
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
              }).catch((err) =>
                console.error("Follower notification failure:", err),
              );
            })
            .catch((err) => console.error("Follower lookup failure:", err));
        }
      });

      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(201).json({
        message: "Posts repost action completed successfully.",
        repostsCount: updatedOriginal.repostsCount || 0,
      });
    }
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    res.status(500).json({ message: err.message });
  }
};
export const toggleCommentLike = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleCommentLikeController";
  const action = "toggleCommentLike";
  const { commentId } = req.params;
  const userId = req.user.id || req.user.uid;

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

    if (!isLiked && commentAuthorId && commentAuthorId !== userId) {
      User.where("uid", "==", userId)
        .limit(1)
        .get()
        .then(async (likerQuery) => {
          const liker = !likerQuery.empty ? likerQuery.docs[0].data() : null;
          const ownerQuery = await Users.where("uid", "==", commentAuthorId)
            .limit(1)
            .get();
          const owner = !ownerQuery.empty ? ownerQuery.docs[0].data() : null;

          if (liker && owner) {
            createNotification({
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
            }).catch((err) =>
              console.error("Notification emission failure:", err),
            );
          }
        })
        .catch((err) => console.error("Liker lookup failure:", err));
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.sendStatus(200);
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    const statusCode = err.message === "Comment not found" ? 404 : 500;
    if (statusCode === 404) {
      return res.status(404).send("Comment not found");
    }
    res.status(500).send(err.message);
  }
};
export const fetchPostUsingPostId = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchPostUsingPostIdController";
  const action = "fetchPostUsingPostId";
  const userId = req.user?.id || req.user?.uid;

  try {
    const { postId } = req.params;
    const postQuery = await Posts.where("postId", "==", postId).limit(1).get();
    if (postQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Post not found",
      );
      return res.status(404).json({ error: "Post not found" });
    }

    const postDoc = postQuery.docs[0];
    const post = postDoc.data();

    if (post.status === "hidden") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Post not found",
      );
      return res.status(404).json({ error: "Post not found" });
    }

    const authorId = post.originalAuthor || post.userId?.uid || post.userId;
    let authorDetails = null;
    if (authorId) {
      const userQuery = await User.where("uid", "==", authorId).limit(1).get();
      if (!userQuery.empty) {
        const uData = userQuery.docs[0].data();
        authorDetails = {
          firstname: uData.firstname || null,
          lastname: uData.lastname || null,
          username: uData.username || null,
          tier: uData.tier || null,
          organizationName: uData.organizationName || null,
        };
      }
    }
    const commentsSnapshot = await Comments.where("postId", "==", postId).get();
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
      postId,
    ).get();
    const repostersDetails = repostersSnapshot.docs.map((doc) => doc.data());

    const featuredReposter =
      typeof getPriorityReposter === "function"
        ? await getPriorityReposter(repostersDetails, userId)
        : null;

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({
      ...post,
      authorDetails,
      comments,
      repostersDetails,
      featuredReposter,
    });
  } catch (err) {
    console.error("Fetch single post error:", err.message);
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
