import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getSavedMethods,
  initializeBuy,
  initializeWithdraw,
  handleP2pTransfers,
  verifySubscriptionFlwPayment,
  generateTransactionHistory,
} from "../controllers/paymentController.js";
import {
  fetchUserTransactionHistory,
  fetchUserTransactionStats,
  fetchItagByUsername,
  getTransactionById,
} from "../controllers/fetchActions.js";
import {
  verifyIcashPin,
  icashPinSetup,
  requestIcashPinReset,
  resetIcashPin,
} from "../controllers/userActionsController.js";

export default function () {
  const router = express.Router();
  router.get("/my-transactions", protect, fetchUserTransactionHistory);
  router.post("/verify-icash-pin", protect, verifyIcashPin);
  router.post("/setup-icash-pin", protect, icashPinSetup);
  router.post("/request-pin-reset", protect, requestIcashPinReset);
  router.post("/reset-icash-pin", protect, resetIcashPin);
  router.get("/payment-methods", protect, getSavedMethods);
  router.get("/transactions/initialize-buy", protect, initializeBuy);
  router.get("/transactions/initialize-withdraw", protect, initializeWithdraw);
  router.get("/iTag/search/:username", protect, fetchItagByUsername);
  router.post("/transactions/p2p-transfer", protect, handleP2pTransfers);
  router.get("/transactions/stats", protect, fetchUserTransactionStats);
  router.post("/transactions/export", protect, generateTransactionHistory);
  router.post(
    "/subscriptionPayments/verify",
    protect,
    verifySubscriptionFlwPayment,
  );
  router.get(
    "/transactions/fetch-transaction/:transactionId",
    protect,
    getTransactionById,
  );
  return router;
}