import {
  UserDownloads,
  Product
} from "../tableDeclarations.js";

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