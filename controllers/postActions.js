import express from "express";
import { createNotification } from "../services/notificationService.js";
import { Follow, User, Posts } from "../tableDeclarations.js";
import {
  generateNotificationId,
  generatePostId,
} from "../utils/idGenerator.js";
import { extractMentions } from "../utils/postMentionsRegex.js";
import { storage } from "../config/firebaseAdmin.js";

export const createPost = async (req, res) => {
  try {
    const { content, media, poll, isSubscriptionContent } = req.body;
    const userId = req.user.uid;

    let processedMedia = media;
    if (media?.mediaType === "video" && Array.isArray(media.url)) {
      processedMedia.url = [media.url[0]];
    }

    const author = await User.findOne({ uid: userId }).select(
      "firstname lastname username profilePic",
    );
    if (!author) return res.status(404).json({ message: "Author not found" });
    const authorName = `${author.firstname} ${author.lastname}`;

    const newPost = new Posts({
      postId: generatePostId(),
      originalAuthor: userId,
      content,
      isSubscriptionContent: isSubscriptionContent || false,
      media: processedMedia,
      postType: poll ? "poll" : "media",
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
    });

    await newPost.save();

    const mentionedUsernames = extractMentions(content);
    let notifiedUids = new Set();
    if (mentionedUsernames.length > 0) {
      const mentionedUsers = await User.find({
        username: { $in: mentionedUsernames },
      }).select("uid");
      mentionedUsers.forEach((user) => {
        notifiedUids.add(user.uid);
        createNotification({
          notificationId: generateNotificationId("social"),
          recipientId: user.uid,
          category: "social",
          actionType: "POST_MENTION",
          title: "You were mentioned",
          message: `${authorName} mentioned you in a post.`,
          payload: { postId: newPost._id, authorId: userId },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        });
      });
    }

    // Notify Followers
    const followers = await Follow.find({ followingId: userId }).select(
      "followerId",
    );
    followers.forEach((follow) => {
      if (
        !notifiedUids.has(follow.followerId) &&
        follow.followerId !== userId
      ) {
        createNotification({
          notificationId: generateNotificationId("social"),
          recipientId: follow.followerId,
          category: "social",
          actionType: "NEW_POST",
          title: `New Posts from ${authorName}`,
          message: `${authorName} just shared a new update.`,
          payload: { postId: newPost._id, authorId: userId },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        });
      }
    });

    // iScore updates
    if (req.user.usertype !== "enterprise") {
      await User.updateOne(
        { uid: req.user.uid },
        { $inc: { "monthlyStats.libraryUsageSessions": 1 } },
      );
    }

    res
      .status(201)
      .json({ message: "Posts created successfully", data: newPost });
  } catch (error) {
    console.error("Create Posts Error:", error);
    res.status(500).json({ message: error.message });
  }
};
export const updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, media, poll, isSubscriptionContent } = req.body;
    const userId = req.user.uid;
    const post = await Posts.findOne({ postId, originalAuthor: userId });

    if (!post) {
      return res
        .status(404)
        .json({ message: "Posts not found or unauthorized to edit." });
    }

    let processedMedia = media;
    if (media?.mediaType === "video" && Array.isArray(media.url)) {
      processedMedia.url = [media.url[0]];
    }
    post.content = content;
    post.media = processedMedia;
    post.isSubscriptionContent =
      isSubscriptionContent ?? post.isSubscriptionContent;

    if (poll && post.poll) {
      post.poll.options = poll.options.map((opt, index) => {
        const existingOpt = post.poll.options.find((o) => o.text === opt.text);
        return {
          optionId: existingOpt
            ? existingOpt.optionId
            : `opt_${Date.now()}_${index}`,
          text: opt.text,
          votes: existingOpt ? existingOpt.votes : [],
        };
      });
      post.poll.totalVotes = post.poll.options.reduce(
        (sum, o) => sum + o.votes.length,
        0,
      );
    }

    await post.save();

    const author = await User.findOne({ uid: userId }).select(
      "firstname lastname",
    );
    const authorName = author
      ? `${author.firstname} ${author.lastname}`
      : "Someone";
    const explicitUsernames = extractMentions(content);
    if (explicitUsernames.length > 0) {
      const usersToTag = await User.find({
        username: { $in: explicitUsernames },
      }).select("uid");
      for (const targetUser of usersToTag) {
        if (targetUser.uid === userId) continue;
        createNotification({
          notificationId: generateNotificationId("social"),
          recipientId: targetUser.uid,
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
    }
    createNotification({
      notificationId: generateNotificationId("social"),
      recipientId: userId,
      category: "social",
      actionType: "POST_UPDATED",
      title: "Posts Updated",
      message: "Your post has been successfully updated.",
      payload: { postId: post.postId },
      sendPush: false,
      sendSocket: true,
      saveToDb: true,
    });

    res.status(200).json({ message: "Posts updated successfully", post });
  } catch (error) {
    console.error("Update Posts Error:", error);
    res.status(500).json({ message: error.message });
  }
};
export const deletePost = async (req, res) => {
  try {
    const userUid = req.user.uid;
    const { postId } = req.params;
    if (!postId) {
      return res.status(400).json({
        success: false,
        message: "Missing required post identification parameter.",
      });
    }
    const post = await Posts.findOneAndDelete({
      postId: postId,
      originalAuthor: userUid,
    });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Posts record not found or unauthorized deletion access.",
      });
    }
    if (post.media) {
      const mediaUrls = Array.isArray(post.media) ? post.media : [post.media];

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
    const author = await User.findOne({ uid: userUid }).lean();
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
      sendEmail: false,
      payload: {
        username: authorName,
        postId: postId,
      },
    }).catch((err) =>
      console.error("Non-blocking post deletion log emission failure:", err),
    );
    return res.status(200).json({
      success: true,
      message: "Posts entry successfully unlinked and purged.",
      data: { postId },
    });
  } catch (error) {
    console.error("Global crash layer hit in deletePostController:", error);
    return res.status(500).json({
      success: false,
      message: "Internal application routing anomaly.",
    });
  }
};
export const toggleLike = async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    const post = await Posts.findOne({ postId });
    if (!post) return res.status(404).send("Post not found");
    const isLiked = post.likes.includes(userId);
    const postUpdate = isLiked
      ? { $pull: { likes: userId } }
      : { $push: { likes: userId } };
    const userUpdate = isLiked
      ? { $pull: { likes: postId } }
      : { $push: { likes: postId } };
    const message = isLiked ? "You unliked a post." : "You liked a post.";
    const [updatedPost] = await Promise.all([
      Posts.findOneAndUpdate({ postId }, postUpdate, { new: true }),
      User.updateOne({ uid: userId }, userUpdate),
    ]);
    if (!isLiked && post.userId.uid !== userId) {
      const liker = await User.findOne({ uid: userId }).select(
        "firstname lastname",
      );
      createNotification({
        notificationId: generateNotificationId("social"),
        recipientId: post.userId.uid,
        category: "social",
        actionType: "POST_LIKED",
        title: "New Like",
        message: `${liker.firstname} liked your post.`,
        payload: { postId: post.postId, userId },
        sendPush: true,
        saveToDb: true,
      });
    }

    const io = req.app.get("socketio");
    if (io) io.emit("post_updated", updatedPost);
    if (io) {
      io.emit("post_stats_updated", {
        postId: updatedPost.postId,
        stats: {
          likes: updatedPost.likes,
          bookmarks: updatedPost.bookmarks,
          impressions: updatedPost.impressions,
          repostsCount: updatedPost.repostsCount,
          commentsCount: updatedPost.commentsCount,
        },
      });
    }
    res.json({ updatedPost, message });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const toggleBookmark = async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  try {
    const post = await Posts.findOne({ postId });
    if (!post) return res.status(404).json({ message: "Post not found" });
    const isBookmarked = (post.bookmarks ?? []).includes(userId);
    const postUpdate = isBookmarked
      ? { $pull: { bookmarks: userId } }
      : { $push: { bookmarks: userId } };

    const userUpdate = isBookmarked
      ? { $pull: { bookmarks: postId } }
      : { $push: { bookmarks: postId } };

    const [updatedPost] = await Promise.all([
      Posts.findOneAndUpdate({ postId }, postUpdate, { new: true }),
      User.updateOne({ uid: userId }, userUpdate),
    ]);
    const io = req.app.get("socketio");
    if (io && updatedPost) {
      io.emit("post_stats_updated", {
        postId: updatedPost.postId,
        stats: {
          likes: updatedPost.likes,
          bookmarks: updatedPost.bookmarks,
          impressions: updatedPost.impressions,
          repostsCount: updatedPost.repostsCount,
          commentsCount: updatedPost.commentsCount,
        },
      });
    }

    res.status(200).json({
      isBookmarked: !isBookmarked,
      count: updatedPost.bookmarks.length,
      message: isBookmarked
        ? "You removed a post from your bookmarks"
        : "You bookmarked a post",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const addComment = async (req, res) => {
  const { postId } = req.params;
  const { comment, parentId } = req.body;
  const userId = req.user.id;
  try {
    const tempCommentId = Math.random().toString(36).slice(2, 11);

    const newCommentData = {
      commentId: tempCommentId,
      userId,
      comment,
      parentId: parentId || "",
      likes: [],
      createdAt: new Date().toISOString(),
    };

    const updatedPost = await Posts.findOneAndUpdate(
      { postId },
      {
        $push: { comments: newCommentData },
        $inc: { commentsCount: 1 },
      },
      { new: true },
    ).populate("comments.userId", "firstname lastname profilePic username");

    if (!updatedPost) return res.status(404).json({ error: "Post not found" });

    const populatedComment = updatedPost.comments.find(
      (c) => c.commentId === tempCommentId,
    );
    const commenter = await User.findOne({ uid: userId }).select(
      "firstname lastname",
    );
    const postAuthorId = updatedPost.userId.uid;

    const io = req.app.get("socketio");
    if (io) {
      io.emit("new_comment", {
        postId,
        comment: populatedComment,
      });
      io.emit("post_stats_updated", {
        postId,
        commentsCount: updatedPost.commentsCount,
      });
    }
    if (postAuthorId !== userId) {
      createNotification({
        notificationId: generateNotificationId("social"),
        recipientId: postAuthorId,
        category: "social",
        actionType: "POST_COMMENTED",
        title: "New Comment",
        message: `${commenter.firstname} commented on your post: "${comment.substring(0, 30)}..."`,
        payload: { postId, commentId: tempCommentId },
        sendPush: true,
        saveToDb: true,
      });
    }
    res.status(201).json(populatedComment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
export const fetchPostUsingPostId = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Posts.aggregate([
      { $match: { postId: postId } },
      {
        $lookup: {
          from: "users",
          localField: "userId.uid",
          foreignField: "uid",
          as: "authorDetails",
        },
      },
      { $unwind: "$authorDetails" },
      {
        $project: {
          postId: 1,
          content: 1,
          createdAt: 1,
          userId: 1,
          "authorDetails.firstname": 1,
          "authorDetails.lastname": 1,
          "authorDetails.username": 1,
          "authorDetails.tier": 1,
          "authorDetails.organizationName": 1,
        },
      },
    ]);

    if (!post || post.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json(post[0]);
  } catch (err) {
    console.error("Fetch single post error:", err);
    res.status(500).json({ error: err.message });
  }
};
export const pollVote = async (req, res) => {
  const { postId, optionId, userId } = req.body;
  try {
    const post = await Posts.findOne({ postId });
    if (!post || !post.poll)
      return res.status(404).json({ error: "Poll not found" });

    if (post.poll.expiresAt && new Date() > new Date(post.poll.expiresAt)) {
      return res.status(400).json({ error: "Poll has expired" });
    }

    const hasVoted = post.poll.options.some((opt) =>
      opt.votes.includes(userId),
    );
    if (hasVoted) return res.status(400).json({ error: "Already voted" });
    const updatedPost = await Posts.findOneAndUpdate(
      { postId: postId, "poll.options.optionId": optionId },
      {
        $push: { "poll.options.$.votes": userId },
        $inc: { "poll.totalVotes": 1 },
      },
      { new: true },
    );
    if (
      updatedPost.poll.totalVotes % 10 === 0 &&
      updatedPost.userId.uid !== userId
    ) {
      createNotification({
        notificationId: generateNotificationId("social"),
        recipientId: updatedPost.userId.uid,
        category: "social",
        actionType: "POLL_MILESTONE",
        title: "Poll Update",
        message: `${updatedPost.poll.totalVotes} people have now voted in your poll!`,
        payload: { postId: updatedPost._id },
        sendPush: true,
        saveToDb: true,
      });
    }
    res.status(200).json(updatedPost);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const incrementImpressions = async (req, res) => {
  try {
    const { postId } = req.params;
    const updatedPost = await Posts.findOneAndUpdate(
      { postId: postId },
      { $inc: { impressions: 1 } },
      { new: true },
    );

    if (!updatedPost) {
      return res.status(404).send("Post not found");
    }
    const author = await User.findOne({ uid: updatedPost.userId.uid });
    if (author && author.usertype !== "enterprise") {
      await User.updateOne(
        { uid: author.uid },
        {
          $inc: {
            "monthlyStats.minutesActive": 0.5,
          },
        },
      );
    }
    const io = req.app.get("socketio");
    if (io) {
      io.emit("post_stats_updated", {
        postId: updatedPost.postId,
        impressions: updatedPost.impressions,
      });
    }

    res.status(200).json({
      success: true,
      impressions: updatedPost.impressions,
    });
  } catch (err) {
    console.error("Impression error:", err);
    res.status(500).send(err.message);
  }
};    