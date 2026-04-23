import express from "express";
import { client } from "../workers/reditFile.js";
import { createNotification } from "../services/notificationService.js";
import { Follow } from "../tableDeclarations.js";
import {
  generateNotificationId,
  generatePostId,
} from "../utils/idGenerator.js";
import { extractMentions } from "../utils/postMentionsRegex.js";
import { protect } from "../middleware/auth.js";

export default function (Posts, User) {
  const router = express.Router();

  //1. Fetch posts (Preference for subscribers)
  router.get("/", async (req, res) => {
    const limit = parseInt(req.query.limit) || 15;
    const cursorScore = req.query.cursor ? parseFloat(req.query.cursor) : null;
    const isInitialLoad = !cursorScore;

    try {
      // 1. Redis Caching Layer (Only for the very first page)
      if (isInitialLoad) {
        const cached = await client.get("hot_posts");
        if (cached) return res.json(JSON.parse(cached));
      }

      // 2. The Aggregation Pipeline
      const pipeline = [
        {
          $lookup: {
            from: "users", // ensure this matches your User collection name
            localField: "userId.uid",
            foreignField: "uid",
            as: "authorDetails",
          },
        },
        { $unwind: "$authorDetails" },
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
                { $multiply: ["$impressions", 0.1] },
                { $divide: [{ $toLong: "$createdAt" }, 1000000000] },
              ],
            },
          },
        },
      ];

      // 3. Apply Cursor Filtering (if not the first page)
      if (cursorScore) {
        pipeline.push({ $match: { rankingScore: { $lt: cursorScore } } });
      }

      // 4. Sort and Limit
      pipeline.push(
        { $sort: { rankingScore: -1 } },
        { $limit: limit },
        {
          $project: {
            "authorDetails.password": 0,
            // Add any other fields you want to exclude
          },
        },
      );

      const posts = await Posts.aggregate(pipeline);

      // 5. Calculate the Next Cursor
      const nextCursor =
        posts.length === limit ? posts[posts.length - 1].rankingScore : null;
      const responseData = { posts, nextCursor };

      // 6. Update Redis Cache (Only for the first page load)
      if (isInitialLoad) {
        await client.setEx("hot_posts", 300, JSON.stringify(responseData));
      }

      res.json(responseData);
    } catch (err) {
      console.error("Feed error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. TOGGLE LIKE
  router.post("/:postId/like", async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body; // Expecting the MongoDB _id or unique uid string

    try {
      const post = await Posts.findOne({ postId });
      if (!post) return res.status(404).send("Post not found");

      const isLiked = post.likes.includes(userId);

      // If liked: remove from both. If not liked: add to both.
      const postUpdate = isLiked
        ? { $pull: { likes: userId } }
        : { $push: { likes: userId } };
      const userUpdate = isLiked
        ? { $pull: { likes: postId } }
        : { $push: { likes: postId } };

      // Update Post and User in parallel
      const [updatedPost] = await Promise.all([
        Posts.findOneAndUpdate({ postId }, postUpdate, { new: true }),
        User.updateOne({ uid: userId }, userUpdate), // Adjust 'uid' to your User ID field
      ]);
      if (!isLiked && post.userId.uid !== userId) {
        const liker = await User.findOne({ uid: userId }).select(
          "firstname lastname",
        );
        createNotification({
          notificationId: generateNotificationId(),
          recipientId: post.userId.uid,
          category: "social",
          actionType: "POST_LIKED",
          title: "New Like",
          message: `${liker.firstname} liked your post.`,
          payload: { postId: post._id, userId },
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
            likes: updatedPost.likes, // Array of UIDs
            bookmarks: updatedPost.bookmarks, // Array of UIDs
            impressions: updatedPost.impressions,
            repostsCount: updatedPost.repostsCount,
            commentsCount: updatedPost.commentsCount,
          },
        });
      }

      res.json(updatedPost);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. TOGGLE BOOKMARK (Updates both Post and User)
  router.patch("/:postId/bookmark", async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    try {
      // 1. First, check if the post exists
      const post = await Posts.findOne({ postId });
      if (!post) return res.status(404).send("Post not found");

      const isBookmarked = (post.bookmarks ?? []).includes(userId);

      // 2. Define the update logic
      const postUpdate = isBookmarked
        ? { $pull: { bookmarks: userId } }
        : { $push: { bookmarks: userId } };

      const userUpdate = isBookmarked
        ? { $pull: { bookmarks: postId } }
        : { $push: { bookmarks: postId } };

      // 3. Execute updates. Use findOneAndUpdate for the Post to get the NEW data.
      const [updatedPost] = await Promise.all([
        Posts.findOneAndUpdate({ postId }, postUpdate, { new: true }),
        User.updateOne({ uid: userId }, userUpdate),
      ]);

      // 4. Socket Emission using the REAL updated data
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
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. INCREMENT IMPRESSION
  // 4. INCREMENT IMPRESSION
  router.patch("/:postId/impression", async (req, res) => {
    try {
      const { postId } = req.params;

      // 1. Update and get the NEW version of the post
      const updatedPost = await Posts.findOneAndUpdate(
        { postId: postId },
        { $inc: { impressions: 1 } },
        { new: true }, // Crucial: returns the post AFTER the increment
      );

      if (!updatedPost) {
        return res.status(404).send("Post not found");
      }

      // 2. Grab the socket instance
      const io = req.app.get("socketio");

      // 3. Emit the update
      // We send a targeted object so the frontend knows exactly what changed
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
  });

  // 5. ADD COMMENT
  router.post("/:postId/comment", async (req, res) => {
    const { postId } = req.params;
    const { userId, comment, parentId } = req.body;
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

      // 1. Update and Populate
      const updatedPost = await Posts.findOneAndUpdate(
        { postId },
        {
          $push: { comments: newCommentData },
          $inc: { commentsCount: 1 },
        },
        { new: true },
      ).populate("comments.userId", "firstname lastname profilePic username");

      if (!updatedPost)
        return res.status(404).json({ error: "Post not found" });

      // 2. Extract the actual populated comment from the updated array
      const populatedComment = updatedPost.comments.find(
        (c) => c.commentId === tempCommentId,
      );
      const commenter = await User.findOne({ uid: userId }).select(
        "firstname lastname",
      );
      const postAuthorId = updatedPost.userId.uid;

      // 3. Emit the POPULATED comment via Socket
      const io = req.app.get("socketio");
      if (io) {
        io.emit("new_comment", {
          postId,
          comment: populatedComment, // Now contains user name/pic object
        });

        // Optional: Also emit the updated count
        io.emit("post_stats_updated", {
          postId,
          commentsCount: updatedPost.commentsCount,
        });
      }
      if (postAuthorId !== userId) {
        createNotification({
          notificationId: generateNotificationId(),
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
  });

  // 6. TOGGLE COMMENT LIKE
  router.patch("/:postId/comments/:commentId/like", async (req, res) => {
    const { postId, commentId } = req.params;
    const { userId } = req.body;
    try {
      const post = await Posts.findOne({ postId });
      const comment = post.comments.find((c) => c.commentId === commentId);

      const isLiked = comment.likes.includes(userId);
      const operator = isLiked ? "$pull" : "$push";

      // Use positional operator to update specific comment in array
      await Posts.updateOne(
        { postId, "comments.commentId": commentId },
        { [operator]: { "comments.$.likes": userId } },
      );

      res.sendStatus(200);
    } catch (err) {
      res.status(500).send(err.message);
    }
  });

  // 7. REPOST with Notifications to Original Author and Followers (Handle Mentions in Repost Content)
  router.post("/repost", async (req, res) => {
    const { userId, originalPostId, content } = req.body;

    try {
      // 1. Fetch Author details to satisfy denormalized Schema
      const author = await User.findOne({ uid: userId })
        .select("firstname lastname username profilePic")
        .lean();

      if (!author) return res.status(404).json({ message: "User not found" });

      const authorName = `${author.firstname} ${author.lastname}`;

      // 2. Create and Save the repost matching PostSchema
      const repost = new Posts({
        postId: generatePostId(),
        userId: {
          uid: userId,
          firstname: author.firstname,
          lastname: author.lastname,
          profilePic: author.profilePic,
        },
        content,
        originalPostId,
        isRepost: true,
        createdAt: new Date(),
      });
      await repost.save();

      // 3. Increment original post's count AND get the original author's UID
      const updatedOriginal = await Posts.findOneAndUpdate(
        { postId: originalPostId },
        { $inc: { repostsCount: 1 } },
        { new: true },
      );

      // --- SOCKET EMISSIONS ---
      const io = req.app.get("socketio");
      if (io) {
        io.emit("new_post", repost);
        if (updatedOriginal) {
          io.emit("post_stats_updated", {
            postId: originalPostId,
            stats: {
              repostsCount: updatedOriginal.repostsCount,
              likes: updatedOriginal.likes,
              bookmarks: updatedOriginal.bookmarks,
            },
          });
        }
      }
      // --- NOTIFICATION LOGIC ---
      let notifiedUids = new Set();
      // 4. Notify the Original Post Author
      if (updatedOriginal && updatedOriginal.userId.uid !== userId) {
        notifiedUids.add(updatedOriginal.userId.uid);
        createNotification({
          notificationId: generateNotificationId(),
          recipientId: updatedOriginal.userId.uid,
          category: "social",
          actionType: "POST_REPOSTED",
          title: "Post Reposted",
          message: `${authorName} shared your post.`,
          payload: { postId: repost.postId, originalPostId },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        });
      }

      // 5. Notify Followers
      const followers = await Follow.find({ followingId: userId }).select(
        "followerId",
      );

      followers.forEach((follow) => {
        if (
          !notifiedUids.has(follow.followerId) &&
          follow.followerId !== userId
        ) {
          createNotification({
            notificationId: generateNotificationId(),
            recipientId: follow.followerId,
            category: "social",
            actionType: "NEW_POST",
            title: `New Repost from ${authorName}`,
            message: `${authorName} shared a post.`,
            payload: { postId: repost.postId, authorId: userId },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        }
      });

      res.status(201).json(repost);
    } catch (err) {
      console.error("Repost Error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  // 8. CREATE POST (with Mention and Follower Notifications)
  router.post("/create", async (req, res) => {
    try {
      const { userId, content, media, poll, isSubscriptionContent } = req.body;
      let processedMedia = media;
      if (media?.mediaType === "video" && Array.isArray(media.url)) {
        processedMedia.url = [media.url[0]];
      }
      const author = await User.findOne({ uid: userId }).select(
        "firstname lastname username profilePic",
      );
      if (!author) {
        return res.status(404).json({ message: "Author not found" });
      }
      const authorName = `${author.firstname} ${author.lastname}`;
      const newPost = new Posts({
        postId: generatePostId(),
        userId: {
          uid: userId,
          firstname: author.firstname,
          lastname: author.lastname,
          profilePic: author.profilePic,
        },
        content,
        isSubscriptionContent: isSubscriptionContent || false,
        media: processedMedia,
        poll: poll
          ? {
              options: poll.options.map((opt, index) => ({
                optionId: `opt_${Date.now()}_${index}`,
                text: opt.text,
                votes: [],
              })),
              totalVotes: 0,
              expiresAt:
                poll.expiresAt ||
                new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days
            }
          : null,
      });
      await newPost.save();
      // 3. Handle Mentions (@username)
      const mentionedUsernames = extractMentions(content);
      let notifiedUids = new Set();
      if (mentionedUsernames.length > 0) {
        const mentionedUsers = await User.find({
          username: { $in: mentionedUsernames },
        }).select("uid");

        mentionedUsers.forEach((user) => {
          notifiedUids.add(user.uid);
          createNotification({
            notificationId: generateNotificationId(),
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
      // 4. Notify Followers
      const followers = await Follow.find({ followingId: userId }).select(
        "followerId",
      );

      followers.forEach((follow) => {
        if (
          !notifiedUids.has(follow.followerId) &&
          follow.followerId !== userId
        ) {
          createNotification({
            notificationId: generateNotificationId(),
            recipientId: follow.followerId,
            category: "social",
            actionType: "NEW_POST",
            title: `New Post from ${authorName}`,
            message: `${authorName} just shared a new update.`,
            payload: { postId: newPost._id, authorId: userId },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        }
      });

      res.status(201).json({
        message: "Post created successfully",
        data: newPost,
      });
    } catch (error) {
      console.error("Create Post Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  //9. --- VOTE IN POLL ---
  router.patch("/vote", async (req, res) => {
    const { postId, optionId, userId } = req.body; // Expecting userId string

    try {
      // 1. Find the post and check if user already voted
      const post = await Posts.findOne({ postId });
      if (!post || !post.poll)
        return res.status(404).json({ error: "Poll not found" });

      // Check expiration
      if (post.poll.expiresAt && new Date() > new Date(post.poll.expiresAt)) {
        return res.status(400).json({ error: "Poll has expired" });
      }

      const hasVoted = post.poll.options.some((opt) =>
        opt.votes.includes(userId),
      );
      if (hasVoted) return res.status(400).json({ error: "Already voted" });

      // 2. Atomic Update: Find post, find the option with optionId, push user to votes, increment total
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
          notificationId: generateNotificationId(),
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
  });

  //10. fetch posts using postId
  router.get("/:postId", protect, async (req, res) => {
    try {
      const { postId } = req.params;
      const post = await Posts.aggregate([
        { $match: { postId: postId } }, // Find the specific post
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
            "authorDetails.password": 0,
            "authorDetails.email": 0, // Privacy
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
  });

  return router;
}