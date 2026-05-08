import express from "express";
import mongoose from "mongoose";
import { protect } from "../middleware/auth.js";
import { User } from "../tableDeclarations.js";

export default function (Product) {
  const router = express.Router();
  router.get("/products", async (req, res) => {
    const { q, category, cursor, limit = 10 } = req.query;
    try {
      let query = { isAvailable: true };
      if (category && category !== "all" && category !== "popular") {
        query.category = category;
      }
      if (q) {
        query.$or = [
          { title: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } },
        ];
      }
      if (cursor) {
        query._id = { $lt: cursor }; // Assuming descending order by ID
      }
      let sort = { createdAt: -1 };
      if (category === "popular") {
        sort = { favCount: -1, ratingsAverage: -1 };
      }
      const products = await Product.find(query)
        .sort(sort)
        .limit(Number(limit));
      const nextCursor =
        products.length === Number(limit)
          ? products[products.length - 1]._id
          : null;
      res.json({ products, nextCursor });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
  router.patch("/cart/toggle", protect, async (req, res) => {
    const { productId, action } = req.body;
    const userId = req.user.id;
    const user = await User.findOne({ uid: userId });
    if (!user) return res.status(404).json({ message: "User not found" });
    try {
      let updateQuery;
      if (action === "add") {
        updateQuery = { $addToSet: { cart: productId } };
      } else if (action === "remove") {
        updateQuery = { $pull: { cart: productId } };
      } else {
        return res.status(400).json({ message: "Invalid action" });
      }

      const updatedUser = await User.findOneAndUpdate(
        { uid: userId },
        updateQuery,
        { new: true },
      ).select("cart");

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.status(200).json({
        success: true,
        cart: updatedUser.cart,
        message: `Product ${action === "add" ? "added to" : "removed from"} cart`,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  router.patch("/favorites/toggle", protect, async (req, res) => {
    const { productId } = req.body;
    const userId = req.user.id;
    try {
      const user = await User.findOne({ uid: userId });
      if (!user) return res.status(404).json({ message: "User not found" });
      const isFavorited = user.favorites.includes(productId);

      const updateQuery = isFavorited
        ? { $pull: { favorites: productId } }
        : { $addToSet: { favorites: productId } };

      const updatedUser = await User.findOneAndUpdate(
        { uid: userId },
        updateQuery,
        { new: true },
      ).select("favorites");

      res.status(200).json({
        success: true,
        favorites: updatedUser.favorites,
        message: isFavorited ? "Removed from favorites" : "Added to favorites",
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
}


