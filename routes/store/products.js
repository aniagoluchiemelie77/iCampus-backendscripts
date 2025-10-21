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
      const filter = { schoolName };

      if (category && category !== "all") {
        filter.category = new RegExp(`^${category}$`, "i");
      }

      let products, total;

      if (category === "all") {
        products = await Product.aggregate([
          { $match: { schoolName } },
          { $sample: { size: parsedLimit } },
        ]);
        total = await Product.countDocuments({ schoolName });
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
  router.post("/:productId/favorite", authenticate, async (req, res) => {
    const { productId } = req.params;
    const { increment } = req.body;
    const userId = req.user.id;
    try {
      const user = await User.findById(userId);
      const product = await Product.findById(productId);
      if (!user || !product)
        return res.status(404).json({ error: "User or product not found" });

      const alreadyFavorited = user.favorites.includes(productId);

      if (increment && !alreadyFavorited) {
        user.favorites.push(productId);
        product.favCount += 1;
      } else if (!increment && alreadyFavorited) {
        user.favorites = user.favorites.filter(
          (id) => id.toString() !== productId
        );
        product.favCount = Math.max(0, product.favCount - 1);
      } else {
        return res.status(200).json({ message: "No update needed" });
      }

      await user.save();
      await product.save();

      res.status(200).json({
        message: "Favorite status updated",
        favCount: product.favCount,
      });
    } catch (error) {
      console.error("Error updating favorite status:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /store/:productId/cart {Add Product to Cart}
  router.post("/:productId/cart", authenticate, async (req, res) => {
    const { productId } = req.params;
    const userId = req.user.id;
    console.log(`Id: ${productId}, UserId: ${userId}`);
    try {
      const user = await User.findById(userId);
      const product = await Product.findById(productId);
      if (!user || !product)
        return res.status(404).json({ message: "User or product not found" });
      const cart = Array.isArray(user.cart) ? user.cart : [];
      const alreadyInCart = cart.includes(productId);

      if (!alreadyInCart) {
        console.log(`PreSave`);
        user.cart = [...cart, productId];
        console.log(`Saving...`); // safely update cart
        await user.save();
        console.log(`Saved`);
        return res.status(200).json({ message: "Product added to cart" });
      } else {
        console.log(`Unsuccessful`);
        return res.status(200).json({ message: "Product already in cart" });
      }
    } catch (error) {
      console.error("Cart add error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /store/favorites (Favorite Products Fetch)
  router.get("/favorites", authenticate, async (req, res) => {
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const favoriteIds = user.favorites || [];
      const products = await Product.find({ _id: { $in: favoriteIds } });
      console.log(products);

      res.status(200).json(products);
    } catch (error) {
      console.error("Error fetching user's favorite products:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GTT /store (Cart Items Fetch)
  router.get("/cart", authenticate, async (req, res) => {
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      const cartIds = user.cart || [];
      const products = await Product.find({ productId: { $in: cartIds } }); // or _id
      res.status(200).json(products);
    } catch (error) {
      console.error("Error fetching user's cart:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  router.post("/cart", authenticate, async (req, res) => {
    const userId = req.user.id;
    const { productId } = req.body;

    try {
      await User.findByIdAndUpdate(userId, {
        $addToSet: { cart: productId }, // avoids duplicates
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

  // Remove item from cart
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





  return router;
}


