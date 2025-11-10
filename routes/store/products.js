import express from "express";
import mongoose from "mongoose";
import {
  authenticate,
  transactionMiddleState,
  userSchema,
  productSchema,
  notificationSchema,
} from "../../index.js";

function generateNotificationId(length = 7) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function (Category) {
  const router = express.Router();

  // Safe model declarations
  const Product =
    mongoose.models.Product ||
    mongoose.model("Product", productSchema, "store-products");
  const User =
    mongoose.models.User || mongoose.model("User", userSchema, "users");
  const Notification =
    mongoose.models.Notification ||
    mongoose.model("Notification", notificationSchema, "notifications");
  const TransactionMiddleState =
    mongoose.models.TransactionMiddleState ||
    mongoose.model(
      "TransactionMiddleState",
      transactionMiddleState,
      "trans-mid-state"
    );

  // GET /store/categories
  router.get("/categories", async (req, res) => {
    try {
      const { schoolName } = req.query;
      if (!schoolName || typeof schoolName !== "string") {
        return res
          .status(400)
          .json({ message: "Missing or invalid schoolName in query" });
      }

      const categories = await Category.find({ schoolName });
      res.status(200).json(categories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Server error fetching categories" });
    }
  });

  // GET /store/products
  router.get("/products", async (req, res) => {
    try {
      const {
        schoolName,
        category,
        limit = "10",
        offset = "0",
        userId,
      } = req.query;

      if (!schoolName || typeof schoolName !== "string") {
        return res
          .status(400)
          .json({ message: "Missing or invalid schoolName in query" });
      }

      if (!userId || typeof userId !== "string") {
        return res
          .status(400)
          .json({ message: "Missing or invalid userId in query" });
      }

      const parsedLimit = Math.max(parseInt(limit), 1);
      const parsedOffset = Math.max(parseInt(offset), 0);

      // Base filter includes schoolName, isAvailable, and excludes user's own products
      const filter = {
        schoolName,
        isAvailable: true,
        sellerId: { $ne: userId },
      };

      if (category && category !== "all") {
        filter.category = new RegExp(`^${category}$`, "i");
      }

      let products, total;

      if (category === "all") {
        products = await Product.aggregate([
          {
            $match: {
              schoolName,
              isAvailable: true,
              sellerId: { $ne: userId },
            },
          },
          { $sample: { size: parsedLimit } },
        ]);
        total = await Product.countDocuments({
          schoolName,
          isAvailable: true,
          sellerId: { $ne: userId },
        });
      } else if (category === "popular") {
        products = await Product.find({
          schoolName,
          isAvailable: true,
          sellerId: { $ne: userId },
        })
          .sort({ favCount: -1 })
          .skip(parsedOffset)
          .limit(parsedLimit);

        total = await Product.countDocuments({
          schoolName,
          isAvailable: true,
          sellerId: { $ne: userId },
        });
      } else {
        total = await Product.countDocuments(filter);
        products = await Product.find(filter)
          .skip(parsedOffset)
          .limit(parsedLimit);
      }
      res.status(200).json({ products, total });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Server error fetching products" });
    }
  });

  // POST /store/:productId/favorite {Toggle favorite}
  router.post("/toggleFavorite", authenticate, async (req, res) => {
    const { productId } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const product = await Product.findOne({ productId });
      if (!product) return res.status(404).json({ error: "Product not found" });

      const isFavorited = user.favorites.includes(productId);

      if (isFavorited) {
        // Unfavorite: remove productId from favorites
        user.favorites = user.favorites.filter(
          (id) => id.toString() !== productId
        );
        product.favCount = Math.max((product.favCount || 1) - 1, 0); // prevent negative count
        console.log("Unfavorite action complete");
      } else {
        // Favorite: add productId to favorites
        user.favorites.push(productId);
        product.favCount = (product.favCount || 0) + 1;
        console.log("Favorite action complete");
      }

      await Promise.all([user.save(), product.save()]);
      console.log(user.favorites);

      res.status(200).json({
        message: isFavorited
          ? "Product removed from favorites"
          : "Product added to favorites",
        favorites: user.favorites,
        favCount: product.favCount,
      });
    } catch (error) {
      console.error("Error updating favorite status:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /store/favorites (Favorite Products Fetch)
  router.get("/favorites", authenticate, async (req, res) => {
    const userId = req.user.id;
    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      const favoriteIds = user.favorites || [];
      const products = await Product.find({ productId: { $in: favoriteIds } });
      res.status(200).json({ products });
    } catch (error) {
      console.error("Error fetching user's cart:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GTT /store (Cart Items Fetch)
  router.get("/cart", authenticate, async (req, res) => {
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      const cartIds = user.cart || [];

      // Count quantities
      const quantityMap = cartIds.reduce((acc, id) => {
        acc[id] = (acc[id] || 0) + 1;
        return acc;
      }, {});

      // Fetch product details
      const products = await Product.find({ productId: { $in: cartIds } });

      // Attach cartQuantity to each product
      const enrichedProducts = products.map((product) => ({
        ...product.toObject(),
        cartQuantity: quantityMap[product.productId] || 1,
      }));
      res.status(200).json(enrichedProducts);
    } catch (error) {
      console.error("Error fetching user's cart:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /store {Add Product to Cart}
  router.post("/cart", authenticate, async (req, res) => {
    const userId = req.user.id;
    const { productId } = req.body;
    console.log(productId);
    try {
      await User.findByIdAndUpdate(userId, {
        $addToSet: { cart: productId },
      });
      res.status(200).json({ message: "Product added to cart" });
    } catch (error) {
      console.error("Error adding to cart:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  //POST store/cart/remove (Remove item from cart)
  router.post("/cart/remove", authenticate, async (req, res) => {
    const { productId } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      user.cart = user.cart.filter((id) => id !== productId); // ✅ Remove all instances
      await user.save();

      res.status(200).json({ message: "Product completely removed from cart" });
    } catch (error) {
      console.error("Remove error:", error);
      res.status(500).json({ error: "Failed to remove product from cart" });
    }
  });

  //POST store/favorites/remove (Remove product from favorites)
  router.post("/favorites/remove", authenticate, async (req, res) => {
    const { productId } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      user.favorites = user.favorites.filter((id) => id !== productId); // ✅ Remove all instances
      await user.save();

      res.status(200).json({ message: "Product removed from favorites" });
    } catch (error) {
      console.error("Remove error:", error);
      res
        .status(500)
        .json({ error: "Failed to remove product from favorites" });
    }
  });

  //POST store/productsByIds (Populating fetch favorites with favorite products)
  router.post("/productsByIds", authenticate, async (req, res) => {
    const { productIds } = req.body;

    try {
      const products = await Product.find({ productId: { $in: productIds } });
      res.status(200).json({ products });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  //GET store/products/:sellerId (fetch product sellers info)
  router.get("/products/:sellerId", async (req, res) => {
    try {
      const { sellerId } = req.params;
      const seller = await User.findOne({ uid: sellerId }); // or _id if you're using MongoDB ObjectId

      if (!seller) {
        return res.status(404).json({ message: "Seller not found" });
      }
      const {
        firstname,
        lastname,
        email,
        profilePic,
        department,
        phone_number,
      } = seller;
      res.status(200).json({
        firstname,
        lastname,
        email,
        profilePic,
        department,
        phone_number,
      });
    } catch (error) {
      console.error("Error fetching seller:", error);
      res.status(500).json({ message: "Server error fetching seller" });
    }
  });

  //GET store/products/otherProductsBySeller
  router.post("/products/otherProductsBySeller", async (req, res) => {
    const { sellerId, excludeProductId } = req.body;
    try {
      if (!sellerId || typeof sellerId !== "string") {
        return res.status(400).json({ message: "Missing or invalid sellerId" });
      }

      const filter = {
        sellerId,
        isAvailable: true,
      };

      if (excludeProductId) {
        filter.productId = { $ne: excludeProductId };
      }
      const products = await Product.find(filter).limit(30);
      res.status(200).json({ products });
    } catch (error) {
      console.error("Error fetching seller products:", error);
      res
        .status(500)
        .json({ message: "Server error fetching seller products" });
    }
  });

  //GET store/search {Fetch Search Query Products}
  router.get("/search", async (req, res) => {
    try {
      const { schoolName, limit = "10", offset = "0", search = "" } = req.query;

      if (!schoolName || typeof schoolName !== "string") {
        return res
          .status(400)
          .json({ message: "Missing or invalid schoolName in query" });
      }

      const parsedLimit = Math.max(parseInt(limit), 1);
      const parsedOffset = Math.max(parseInt(offset), 0);

      const filter = {
        schoolName,
        isAvailable: true,
      };

      if (search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [{ title: regex }, { description: regex }];
      }

      const total = await Product.countDocuments(filter);
      const products = await Product.find(filter)
        .skip(parsedOffset)
        .limit(parsedLimit);
      res.status(200).json({ products, total });
    } catch (error) {
      res.status(500).json({ message: "Server error fetching products" });
    }
  });

  // DELETE /store/cart (Clear All Cart Items)
  router.delete("/cart", authenticate, async (req, res) => {
    const userId = req.user.id;
    try {
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      user.cart = [];

      await user.save();
      res.status(200).json({ message: "Cart cleared successfully" });
    } catch (error) {
      console.error("Error clearing user's cart:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DELETE /store/favorites (Clear all favorites)
  router.delete("/favorites", authenticate, async (req, res) => {
    const userId = req.user.id;
    try {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      user.favorites = [];
      await user.save();
      res.status(200).json({ message: "Cart cleared successfully" });
    } catch (error) {
      console.error("Error clearing user's cart:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /store/checkout (Purchase products and deduct points)
  router.post("/checkout", authenticate, async (req, res) => {
    console.log("Checking out...");
    const {
      userId,
      totalProductsPurchased,
      totalPointsSpent,
      items: purchasedItems,
    } = req.body;
    const purchaseId = new mongoose.Types.ObjectId().toString();
    try {
      const user = await User.findOne({ uid: userId });
      if (!user) return res.status(404).json({ error: "User not found" });

      if (user.pointsBalance < totalPointsSpent) {
        return res.status(400).json({ error: "Insufficient points balance" });
      }

      user.pointsBalance -= totalPointsSpent;

      user.purchaseHistory.push({
        id: purchaseId,
        date: new Date(),
        totalProductsPurchased,
        totalPointsSpent,
        items: purchasedItems.map((item) => ({
          ...item,
          fileUrl: item.fileUrl ?? null,
          selectedQuantity: item.selectedQuantity || "1",
        })),
        status: "pending",
      });

      await user.save();

      let fileUrls = [];
      let transId;

      for (const item of purchasedItems) {
        const quantity = Number(item.selectedQuantity) || 1;
        const totalItemPoints = item.priceInPoints * quantity;
        const product = await Product.findOne({ productId: item.productId });
        if (product) {
          const productIdArray = [item.productId];
          product.inStock = Math.max(0, product.inStock - quantity);
          product.downloadCount = (product.downloadCount || 0) + 1;
          await product.save();
          const seller = await User.findOne({ uid: product.sellerId });
          if (seller) {
            const transactionIdMid = new mongoose.Types.ObjectId().toString();
            transId = transactionIdMid;
            if (item.fileUrl) {
              fileUrls.push(item.fileUrl);
              // Directly credit seller
              seller.pointsBalance += totalItemPoints;
              await seller.save();
            } else {
              await TransactionMiddleState.create({
                transactionId: transactionIdMid,
                sellerId: product.sellerId,
                priceInPoints: totalItemPoints,
                status: "pending",
                productIdArrays: productIdArray,
              });
            }

            // Notify seller
            await Notification.create({
              userId: product.sellerId,
              notificationId: generateNotificationId(),
              title: "Product Purchased",
              message: `Your product "${item.title}" was purchased (${quantity} units).`,
              isPublic: false,
              isRead: false,
              createdAt: new Date(),
              type: "sales",
              transactionIdMid: transactionIdMid,
            });
          }
        }
      }
      await Notification.create({
        userId: userId,
        notificationId: generateNotificationId(),
        title: "Successful Purchase",
        message: `Purchase ID: ${purchaseId}\nPurchase of ${totalProductsPurchased} items at ${totalPointsSpent}pts is successful.`,
        isPublic: false,
        isRead: false,
        createdAt: new Date(),
        type: "transactions",
        purchaseId: purchaseId,
        status: "success",
        transactionIdMid: transId,
        fileUrls: fileUrls,
      });

      res
        .status(200)
        .json({ message: "Checkout recorded and points deducted" });
    } catch (error) {
      console.error("Checkout error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}


