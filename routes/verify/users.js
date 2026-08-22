import express from "express";
import { protect, idempotencyMiddleware } from "../../middleware/auth.js";
import { createPersonaVerifyInquiry } from "../../controllers/userActionsController.js";

const router = express.Router();

router.post(
  "/persona/create-inquiry",
  protect,
  idempotencyMiddleware,
  createPersonaVerifyInquiry,
);

export default router;
