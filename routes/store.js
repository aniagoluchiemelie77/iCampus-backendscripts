import express from "express";
import { protect } from "../middleware/auth.js";
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
  saveProductController,
  deleteProductController,
  togglefavoriteActionController,
  toggleCartActionController,
  fetchStoreProducts,
} from "../controllers/storeControllers.js";
import { upload } from "../middleware/auth.js";

export default function () {
  const router = express.Router();

  router.get("/get-store-products", fetchStoreProducts);
  router.patch("/cart/toggle", protect, toggleCartActionController);
  router.patch("/favorites/toggle", protect, togglefavoriteActionController);
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
  router.delete(
    "/products/delete/:productId",
    protect,
    deleteProductController,
  );
  router.post(
    "/products/create",
    protect,
    upload.single("digitalAsset"),
    saveProductController,
  );
  router.put(
    "/products/edit/:productId",
    protect,
    upload.single("digitalAsset"),
    saveProductController,
  );
  return router;
}
