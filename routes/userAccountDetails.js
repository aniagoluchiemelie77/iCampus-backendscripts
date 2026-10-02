import express from "express";
import { protect, idempotencyMiddleware } from "../middleware/auth.js";
import { verifySubscriptionFlwPayment } from "../controllers/paymentController.js";
import { getTransactionById } from "../controllers/fetchActions.js";

const router = express.Router();
router.post(
  "/subscriptionPayments/verify",
  protect,
  idempotencyMiddleware,
  verifySubscriptionFlwPayment,
);
router.get(
  "/transactions/fetch-transaction/:transactionId",
  protect,
  getTransactionById,
);

export default router;