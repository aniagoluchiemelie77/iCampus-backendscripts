import express from "express";

export default function (Message) {
  const router = express.Router();
  //Messages
  router.get("/fetchMessage/:userId/:recipientId", async (req, res) => {
    const { userId, recipientId } = req.params;
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
  });
  //Messages List
  router.get("/conversations/:uid", async (req, res) => {
    try {
      const { uid } = req.params;
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
            from: "users", // ensure this matches your collection name
            localField: "id",
            foreignField: "uid",
            as: "otherUser",
          },
        },
        { $unwind: "$otherUser" },
        // 6. Shape the output
        {
          $project: {
            id: 0,
            otherUser: {
              uid: 1,
              firstname: 1,
              lastname: 1,
              profilePic: 1,
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
  });
  //Mark as read
  router.post("/mark-all-read/:uid", async (req, res) => {
    try {
      await Message.updateMany(
        { recipientId: req.params.uid, status: { $ne: "seen" } },
        { $set: { status: "seen" } },
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  return router;
}