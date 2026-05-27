import { UserDownloads, Product, Follow, User } from "../tableDeclarations.js";

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
