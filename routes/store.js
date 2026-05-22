import express from "express";
import mongoose from "mongoose";
import { protect } from "../middleware/auth.js";
import { User } from "../tableDeclarations.js";
import {
  fetchAllProducts,
  getPayoutHistory,
  clearUserCart,
  bulkAddToCart,
  initializeCheckout,
  clearFavorites,
  getPendingOrders,
  cancelOrder,
  getDropOffStations,
  completeOrderDelivery,
  logProductImpression,
  getSellerSalesHistory,
  requestPayout,
} from "../controllers/storeControllers.js";

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
    const {
      productId,
      action,
      selectedSize,
      selectedColor,
      quantity = 1,
    } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findOne({ uid: userId });
      if (!user) return res.status(404).json({ message: "User not found" });

      let updatedUser;

      if (action === "add") {
        const cartItem = {
          productId,
          quantity,
          selectedSize,
          selectedColor,
        };
        updatedUser = await User.findOneAndUpdate(
          { uid: userId },
          { $addToSet: { cart: cartItem } },
          { new: true },
        ).select("cart");
      } else if (action === "remove") {
        updatedUser = await User.findOneAndUpdate(
          { uid: userId },
          { $pull: { cart: { productId: productId } } },
          { new: true },
        ).select("cart");
      } else if (action === "update") {
        updatedUser = await User.findOneAndUpdate(
          { uid: userId, "cart.productId": productId },
          { $set: { "cart.$.quantity": quantity } },
          { new: true },
        ).select("cart");
      }

      res.status(200).json({
        success: true,
        cart: updatedUser.cart,
        message: `Cart updated successfully`,
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
  router.get("/fetch-all-products", protect, fetchAllProducts);
  router.delete("/cart/delete-all", protect, clearUserCart);
  router.delete("/favorites/delete-all", protect, clearFavorites);
  router.post("/favorites-to-cart/bulk-add", protect, bulkAddToCart);
  router.post("/initialize-checkout", protect, initializeCheckout);
  router.post("/orders/complete-delivery", protect, completeOrderDelivery);
  router.get("/orders/pending", protect, getPendingOrders);
  router.post("/orders/cancel", protect, cancelOrder);
  router.patch("/product/toggle-impressions", protect, logProductImpression);
  router.get("/sales/history", protect, getSellerSalesHistory);
  router.get("/payouts/fetch-history", protect, getPayoutHistory);
  router.post("/payouts/request-payout", protect, requestPayout);
  router.get("/drop-off-stations/fetch", protect, getDropOffStations);
  return router;
}


