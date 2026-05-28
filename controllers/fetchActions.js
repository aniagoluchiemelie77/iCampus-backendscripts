import {
  UserDownloads,
  Product,
  Follow,
  User,
  Posts,
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
