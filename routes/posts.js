import express from "express";
import { client } from "../workers/reditFile.js";

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

  // 7. REPOST
  router.post("/repost", async (req, res) => {
    const { userId, originalPostId, content } = req.body;
    try {
      // 1. Create and Save the repost
      const repost = new Posts({
        postId: Math.random().toString(36).slice(2, 11),
        userId,
        content,
        originalPostId,
        isRepost: true,
        createdAt: new Date().toISOString(),
      });

      await repost.save();

      // 2. Increment original post's count AND get the updated data for the socket
      const updatedOriginal = await Posts.findOneAndUpdate(
        { postId: originalPostId },
        { $inc: { repostsCount: 1 } },
        { new: true },
      );

      // 3. Populate the new repost for the feed
      const populatedRepost = await Posts.findOne({
        postId: repost.postId,
      }).populate("userId", "firstname lastname profilePic username");

      // 4. SOCKET EMISSIONS
      const io = req.app.get("socketio");
      if (io) {
        // Broadcast the NEW post to the top of everyone's feed
        io.emit("new_post", populatedRepost);

        // Broadcast the updated count for the ORIGINAL post
        if (updatedOriginal) {
          io.emit("post_stats_updated", {
            postId: originalPostId,
            stats: {
              repostsCount: updatedOriginal.repostsCount,
              // Including other stats ensures UI consistency
              likes: updatedOriginal.likes,
              bookmarks: updatedOriginal.bookmarks,
              impressions: updatedOriginal.impressions,
            },
          });
        }
      }

      res.status(201).json(populatedRepost);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- CREATE POST ---
  router.post("/create", async (req, res) => {
    try {
      const { userId, content, media, poll, isSubscriptionContent } = req.body;

      // media validation logic (as you wrote before)
      let processedMedia = media;
      if (media?.mediaType === "video" && Array.isArray(media.url)) {
        processedMedia.url = [media.url[0]];
      }

      const newPost = new Posts({
        userId: {
          uid: userId.uid,
          firstname: userId.firstname,
          lastname: userId.lastname,
          profilePic: userId.profilePic || [],
        },
        content,
        media: processedMedia,
        isSubscriptionContent: isSubscriptionContent || false,
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

      const savedPost = await newPost.save();
      res.status(201).json(savedPost);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- VOTE IN POLL ---
  router.patch("/vote", async (req, res) => {
    const { postId, optionId, userId } = req.body; // Expecting userId string

    try {
      // 1. Find the post and check if user already voted
      const post = await Post.findById(postId);
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
        { _id: postId, "poll.options.optionId": optionId },
        {
          $push: { "poll.options.$.votes": userId },
          $inc: { "poll.totalVotes": 1 },
        },
        { new: true },
      );

      res.status(200).json(updatedPost);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}