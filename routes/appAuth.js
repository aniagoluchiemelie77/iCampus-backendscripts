import { Router } from "express";
import { protect, idempotencyMiddleware } from "../middleware/auth.js";
import {
  handleAgoraTokenGeneration,
  handleDeepgramTokenGeneration,
} from "../controllers/liveClassControllers.js";
import { simulateExternalSchoolApi } from "../controllers/webhookControllers.js";

const router = Router();

router.get(
  "/deepgram-token",
  protect,
  idempotencyMiddleware,
  handleDeepgramTokenGeneration,
);
// Not idempotency-wrapped: a cached response would hand back an old token.
router.get("/agora-token", protect, handleAgoraTokenGeneration);
router.get(
  "/mock-school/verify",
  idempotencyMiddleware,
  simulateExternalSchoolApi,
);

export default router;