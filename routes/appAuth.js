import { Router } from "express";
import { protect, idempotencyMiddleware } from "../middleware/auth.js";
import { handleDeepgramTokenGeneration } from "../controllers/liveClassControllers.js";
import { simulateExternalSchoolApi } from "../controllers/webhookControllers.js";

const router = Router();

router.get(
  "/deepgram-token",
  protect,
  idempotencyMiddleware,
  handleDeepgramTokenGeneration,
);
router.get(
  "/mock-school/verify",
  idempotencyMiddleware,
  simulateExternalSchoolApi,
);

export default router;