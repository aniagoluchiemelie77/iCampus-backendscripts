import { Product, User } from "../tableDeclarations.js";
import { client as redis } from "../workers/reditFile.js";

export const fetchAllProducts = async (req, res) => {
  const CACHE_KEY = "catalog:all_products";
  try {
    const cachedProducts = await redis.get(CACHE_KEY);

    if (cachedProducts) {
      return res.status(200).json({
        success: true,
        products: JSON.parse(cachedProducts),
        source: "cache",
      });
    }
    const products = await Product.find({})
      .select(
        "title isAvailable priceInPoints mediaUrls productId courseDetails category description ratings fileDetails type sellerId physicalDetails",
      )
      .lean();
    await redis.set(CACHE_KEY, JSON.stringify(products), {
      EX: 18000,
    });

    res.status(200).json({
      success: true,
      products,
      source: "database",
    });
  } catch (error) {
    console.error("Cache/DB Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
export const clearUserCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const updatedUser = await User.findOneAndUpdate(
      { uid: userId },
      { $set: { cart: [] } },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      status: true,
      message: "Cart cleared successfully",
      cart: updatedUser.cart,
    });
  } catch (error) {
    console.error("Clear Cart Error:", error);
    res.status(500).json({
      status: false,
      message: "An error occurred while clearing the cart",
    });
  }
};
export const bulkAddToCart = async (req, res) => {
  const { items } = req.body;
  const userId = req.user.id;
  const user = await User.findOne({ uid: userId });
  const newCart = [...user.cart];
  items.forEach((newItem) => {
    if (!newCart.some((item) => item.productId === newItem.productId)) {
      newCart.push(newItem);
    }
  });
  user.cart = newCart;
  await user.save();
  res
    .status(200)
    .json({
      status: true,
      cart: user.cart,
      message: "Successfully moved all favorites to cart.",
    });
};
export const clearFavorites = async (req, res) => {
  const userId = req.user.id;
  await User.findOneAndUpdate({ uid: userId }, { $set: { favorites: [] } });
  res.status(200).json({ status: true });
};
