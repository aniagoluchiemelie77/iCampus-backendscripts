import express from "express";

export default function (Posts, User) {
  const router = express.Router();

  router.get("/", async (req, res) => {
  try {
    const posts = await Posts.aggregate([
      {
        // 1. Join with the User table to check subscription status
        $lookup: {
          from: User, // the name of your user collection in MongoDB
          localField: "userId.uid",
          foreignField: "uid",
          as: "authorDetails"
        }
      },
      { $unwind: "$authorDetails" },
      {
        // 2. Calculate a temporary 'rankingScore'
        $addFields: {
          rankingScore: {
            $add: [
              // Give 1000 points if the user is a subscriber
              { $cond: [{ $eq: ["$authorDetails.isSubscriber", true] }, 1000, 0] },
              // Add points based on impressions/engagement (optional)
              { $multiply: ["$impressions", 0.1] },
              // Subtract points as the post gets older (decay)
              // This ensures old subscriber posts eventually drop below new regular posts
              { $divide: [{ $toLong: "$createdAt" }, 1000000000] } 
            ]
          }
        }
      },
      { $sort: { rankingScore: -1 } }, // Highest score first
      { $limit: 50 }, // Keep it fast
      {
        $project: {
          rankingScore: 0,
          "authorDetails.password": 0 // Don't leak sensitive data
        }
      }
    ]);
    res.json(posts);
  } catch (err) {
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
    const postUpdate = isLiked ? { $pull: { likes: userId } } : { $push: { likes: userId } };
    const userUpdate = isLiked ? { $pull: { likes: postId } } : { $push: { likes: postId } };

    // Update Post and User in parallel
    const [updatedPost] = await Promise.all([
      Posts.findOneAndUpdate({ postId }, postUpdate, { new: true }),
      User.updateOne({ uid: userId }, userUpdate) // Adjust 'uid' to your User ID field
    ]);

    const io = req.app.get("socketio");
    if (io) io.emit("post_updated", updatedPost);

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
    const post = await Posts.findOne({ postId });
    if (!post) return res.status(404).send("Post not found");

    const isBookmarked = (post.bookmarks ?? []).includes(userId);

    const postUpdate = isBookmarked ? { $pull: { bookmarks: userId } } : { $push: { bookmarks: userId } };
    const userUpdate = isBookmarked ? { $pull: { bookmarks: postId } } : { $push: { bookmarks: postId } };

    await Promise.all([
      Posts.updateOne({ postId }, postUpdate),
      User.updateOne({ uid: userId }, userUpdate)
    ]);

    res.sendStatus(200);
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
      { new: true } // Crucial: returns the post AFTER the increment
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
      impressions: updatedPost.impressions 
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
      createdAt: new Date().toISOString()
    };

    // 1. Update and Populate
    const updatedPost = await Posts.findOneAndUpdate(
      { postId },
      { 
        $push: { comments: newCommentData },
        $inc: { commentsCount: 1 } 
      },
      { new: true }
    ).populate("comments.userId", "firstname lastname profilePic username");

    if (!updatedPost) return res.status(404).json({ error: "Post not found" });

    // 2. Extract the actual populated comment from the updated array
    const populatedComment = updatedPost.comments.find(
      (c) => c.commentId === tempCommentId
    );

    // 3. Emit the POPULATED comment via Socket
    const io = req.app.get("socketio");
    if (io) {
      io.emit("new_comment", { 
        postId, 
        comment: populatedComment // Now contains user name/pic object
      });
      
      // Optional: Also emit the updated count
      io.emit("post_stats_updated", {
        postId,
        commentsCount: updatedPost.commentsCount
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
      const comment = post.comments.find(c => c.commentId === commentId);
      
      const isLiked = comment.likes.includes(userId);
      const operator = isLiked ? "$pull" : "$push";

      // Use positional operator to update specific comment in array
      await Posts.updateOne(
        { postId, "comments.commentId": commentId },
        { [operator]: { "comments.$.likes": userId } }
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
      // Create new post record marked as repost
      const repost = new Posts({
        postId: Math.random().toString(36).slice(2, 11),
        userId,
        content,
        originalPostId,
        isRepost: true,
        createdAt: new Date().toISOString()
      });

      await repost.save();
      
      // Increment original post's repost count
      await Posts.updateOne({ postId: originalPostId }, { $inc: { repostsCount: 1 } });

      const populatedRepost = await repost.populate("userId", "firstname lastname profilePic");
      res.status(201).json(populatedRepost);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}