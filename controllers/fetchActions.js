import {
  UserDownloads,
  Product,
  Follow,
  User,
  Posts,
  Transactions,
  ITag,
} from "../tableDeclarations.js";
import { client } from "../workers/reditFile.js";

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

    // 4. Calculate total pages
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
