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
import {
  createPost,
  updatePost,
  deletePost,
  toggleLike,
  toggleBookmark,
  addComment,
  fetchPostUsingPostId,
  pollVote,
  incrementImpressions,
} from "../controllers/postActions.js";

export default function (Posts, User) {
  const router = express.Router();
  router.get("/fetchPosts", protect, async (req, res) => {
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
            from: "users",
            localField: "originalPostId",
            foreignField: "postId",
            as: "originalPostData",
          },
        },
        { $unwind: "$authorDetails" },
        {
          $addFields: {
            rankingScore: {
              $add: [
                // 1. Subscription Base Boost (Fixed 1000 pts)
                {
                  $cond: [
                    { $eq: ["$authorDetails.isSubscriber", true] },
                    1000,
                    0,
                  ],
                },

                // 2. Impression Boost with Tier Multipliers
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

                // 3. Recency (Time)
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
  router.post("/:postId/like", protect, toggleLike);
  router.patch("/:postId/bookmark", protect, toggleBookmark);
  router.patch("/:postId/impression", protect, incrementImpressions);
  router.post("/:postId/comment", protect, addComment);
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
  router.post("/repost", protect, async (req, res) => {
    const { originalPostId, isRepost } = req.body;
    const userId = req.user.id;
    try {
      const existingRepost = await Post.findOne({
        "userId.uid": userId,
        originalPostId: originalPostId,
        isRepost,
      });
      const io = req.app.get("socketio");

      if (existingRepost) {
        await Post.deleteOne({ postId: existingRepost.postId });

        const updatedOriginal = await Post.findOneAndUpdate(
          { postId: originalPostId },
          { $inc: { repostsCount: -1 } },
          { new: true },
        );

        if (io && updatedOriginal) {
          io.emit("post_stats_updated", {
            postId: originalPostId,
            stats: { repostsCount: updatedOriginal.repostsCount },
          });
        }

        return res.status(200).json({
          message: "You undid a repost action",
          repostsCount: updatedOriginal.repostsCount,
        });
      } else {
        const author = await User.findOne({ uid: userId })
          .select(
            "firstname lastname profilePic tier organizationName username",
          )
          .lean();
        const originalPost = await Post.findOne({ postId: originalPostId });
        if (!author || !originalPost)
          return res
            .status(404)
            .json({ message: "Original post details not found." });

        const repost = new Post({
          postId: generatePostId(),
          userId: {
            uid: userId,
            firstname: author.firstname,
            lastname: author.lastname,
            profilePic: author.profilePic,
            tier: author.tier,
            organizationName: author.organizationName,
            username: author.username,
          },
          originalAuthor: originalPost.userId,
          originalPostId,
          isRepost,
          ...originalPost.toObject(),
        });

        await repost.save();

        const updatedOriginal = await Post.findOneAndUpdate(
          { postId: originalPostId },
          { $inc: { repostsCount: 1 } },
          { new: true },
        );

        if (io) {
          io.emit("new_post", repost);
          io.emit("post_stats_updated", {
            postId: originalPostId,
            stats: { repostsCount: updatedOriginal.repostsCount },
          });
        }
        // --- NOTIFICATION LOGIC ---
        let notifiedUids = new Set();
        // 4. Notify the Original Post Author
        if (updatedOriginal && updatedOriginal.userId.uid !== userId) {
          notifiedUids.add(updatedOriginal.userId.uid);
          createNotification({
            notificationId: generateNotificationId("social"),
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
              notificationId: generateNotificationId("social"),
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

        return res.status(201).json({
          message: "Post repost action completed successfully.",
          repostsCount: updatedOriginal.repostsCount,
        });
      }
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
  router.post("/create", protect, createPost);
  router.put("/:postId/update", protect, updatePost);
  router.patch("/vote", protect, pollVote);
  router.get("/:postId", protect, fetchPostUsingPostId);
  router.delete("/:postId/delete", protect, deletePost);
  return router;
}