import {
  UserDownloads,
  Product
} from "../tableDeclarations.js";

export const getDownloads = async (req, res) => {
  const userId = req.user.id;
  const userLibrary = await UserDownloads.findOne({ userId });
  if (!userLibrary) return res.status(200).json({ data: [] });
  const productIds = userLibrary.ownedProducts.map(p => p.productId);
  const products = await Product.find({ productId: { $in: productIds } });
  res.status(200).json({ success: true, data: products });
};