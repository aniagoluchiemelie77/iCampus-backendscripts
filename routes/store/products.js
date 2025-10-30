import express from "express";
import mongoose from "mongoose";
import { authenticate } from "../../index.js";
import { userSchema } from "../../index.js";
import { productSchema } from "../../index.js";

export default function (Category) {
  const router = express.Router();

  // Safe model declarations
  const Product =
    mongoose.models.Product ||
    mongoose.model("Product", productSchema, "store-products");
  const User =
    mongoose.models.User || mongoose.model("User", userSchema, "users");

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
      const { schoolName, category, limit = "10", offset = "0" } = req.query;

      if (!schoolName || typeof schoolName !== "string") {
        return res
          .status(400)
          .json({ message: "Missing or invalid schoolName in query" });
      }

      const parsedLimit = Math.max(parseInt(limit), 1);
      const parsedOffset = Math.max(parseInt(offset), 0);

      // Base filter includes schoolName and isAvailable
      const filter = {
        schoolName,
        isAvailable: true,
      };

      if (category && category !== "all") {
        filter.category = new RegExp(`^${category}$`, "i");
      }

      let products, total;

      if (category === "all") {
        products = await Product.aggregate([
          { $match: { schoolName, isAvailable: true } },
          { $sample: { size: parsedLimit } },
        ]);
        total = await Product.countDocuments({ schoolName, isAvailable: true });
      } else if (category === "popular") {
        products = await Product.find({ schoolName, isAvailable: true })
          .sort({ favCount: -1 }) // highest favorites first
          .skip(parsedOffset)
          .limit(parsedLimit);

        total = await Product.countDocuments({ schoolName, isAvailable: true });
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
      const products = await Product.find({ productId: { $in: cartIds } });
      res.status(200).json(products);
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

  // Increment quantity or add item to cart
  router.post("/cart/increment", authenticate, async (req, res) => {
    const { productId } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      user.cart.push(productId); // ✅ Add another instance of the product
      await user.save();

      res.status(200).json({ message: "Product added to cart" });
    } catch (error) {
      console.error("Increment error:", error);
      res.status(500).json({ error: "Failed to add product to cart" });
    }
  });

  // Decrement quantity or remove if zero
  router.post("/cart/decrement", authenticate, async (req, res) => {
    console.log("BODY:", req.body);
    const { productId } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const index = user.cart.indexOf(productId);
      if (index !== -1) {
        user.cart.splice(index, 1); // ✅ Remove one instance
        await user.save();
        return res.status(200).json({ message: "Product removed from cart" });
      }

      res.status(404).json({ error: "Product not in cart" });
    } catch (error) {
      console.error("Decrement error:", error);
      res.status(500).json({ error: "Failed to remove product from cart" });
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

  return router;
}


