import express from "express";
import { protect, idempotencyMiddleware } from "../middleware/auth.js";
import {
  getSavedMethods,
  initializeBuy,
  initializeWithdraw,
  handleP2pTransfers,
  verifySubscriptionFlwPayment,
  generateTransactionHistory,
  validatePaymentOTP,
} from "../controllers/paymentController.js";
import {
  fetchUserTransactionHistory,
  fetchItagByUsername,
  getTransactionById,
} from "../controllers/fetchActions.js";
import {
  verifyIcashPin,
  icashPinSetup,
  requestIcashPinReset,
  resetIcashPin,
} from "../controllers/userActionsController.js";

const router = express.Router();
router.post(
  "/transactions/initialize-buy",
  protect,
  idempotencyMiddleware,
  initializeBuy,
);
router.post(
  "/transactions/initialize-withdraw",
  protect,
  idempotencyMiddleware,
  initializeWithdraw,
);
router.post(
  "/transactions/p2p-transfer",
  protect,
  idempotencyMiddleware,
  handleP2pTransfers,
);
router.post(
  "/transactions/export",
  protect,
  idempotencyMiddleware,
  generateTransactionHistory,
);
router.post(
  "/payments/verify-otp",
  protect,
  idempotencyMiddleware,
  validatePaymentOTP,
);
router.post(
  "/subscriptionPayments/verify",
  protect,
  idempotencyMiddleware,
  verifySubscriptionFlwPayment,
);
router.get("/my-transactions", protect, fetchUserTransactionHistory);
router.post(
  "/verify-icash-pin",
  protect,
  idempotencyMiddleware,
  verifyIcashPin,
);
router.post("/setup-icash-pin", protect, idempotencyMiddleware, icashPinSetup);
router.post(
  "/request-pin-reset",
  protect,
  idempotencyMiddleware,
  requestIcashPinReset,
);
router.post("/reset-icash-pin", protect, idempotencyMiddleware, resetIcashPin);
router.get("/payment-methods/:userId", protect, getSavedMethods);
router.get("/iTag/search/:username", protect, fetchItagByUsername);
router.get(
  "/transactions/fetch-transaction/:transactionId",
  protect,
  getTransactionById,
);

export default router;