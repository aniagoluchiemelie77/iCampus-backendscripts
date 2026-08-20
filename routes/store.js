import express from "express";
import { protect, idempotencyMiddleware } from "../middleware/auth.js";
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
  markOrderAsDroppedOff,
} from "../controllers/storeControllers.js";

const router = express.Router();

router.get("/get-store-products", idempotencyMiddleware, fetchStoreProducts);
router.patch(
  "/cart/toggle",
  protect,
  idempotencyMiddleware,
  toggleCartActionController,
);
router.patch(
  "/favorites/toggle",
  protect,
  idempotencyMiddleware,
  togglefavoriteActionController,
);
router.get("/fetch-all-products", protect, fetchAllProducts);
router.delete(
  "/cart/delete-all",
  protect,
  idempotencyMiddleware,
  clearUserCart,
);
router.delete(
  "/favorites/delete-all",
  protect,
  idempotencyMiddleware,
  clearFavorites,
);
router.post(
  "/favorites-to-cart/bulk-add",
  protect,
  idempotencyMiddleware,
  bulkAddToCart,
);
router.post(
  "/initialize-checkout",
  protect,
  idempotencyMiddleware,
  initializeCheckout,
);
router.post(
  "/orders/complete-delivery",
  protect,
  idempotencyMiddleware,
  completeOrderDelivery,
);
router.get("/orders/pending", protect, getPendingOrders);
router.post("/orders/cancel", protect, idempotencyMiddleware, cancelOrder);
router.patch(
  "/product/toggle-impressions",
  protect,
  idempotencyMiddleware,
  logProductImpression,
);
router.get("/sales/history", protect, getSellerSalesHistory);
router.get("/payouts/fetch-history", protect, getPayoutHistory);
router.post(
  "/payouts/request-payout",
  protect,
  idempotencyMiddleware,
  requestPayout,
);
router.get("/drop-off-stations/fetch", protect, getDropOffStations);
router.delete(
  "/products/delete/:productId",
  protect,
  idempotencyMiddleware,
  deleteProductController,
);
router.post(
  "/products/create",
  protect,
  idempotencyMiddleware,
  saveProductController,
);
router.put(
  "/products/edit/:productId",
  protect,
  idempotencyMiddleware,
  saveProductController,
);
router.patch(
  "/orders/mark-as-dropped-off",
  protect,
  idempotencyMiddleware,
  markOrderAsDroppedOff,
);

export default router;
