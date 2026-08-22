import { Router } from "express";
import { protect, idempotencyMiddleware } from "../middleware/auth.js";
import { handleDeepgramTokenGeneration } from "../controllers/liveClassControllers.js";

const router = Router();

router.get(
  "/deepgram-token",
  protect,
  idempotencyMiddleware,
  handleDeepgramTokenGeneration,
);

export default router;