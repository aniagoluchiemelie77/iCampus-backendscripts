import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { handleDeepgramTokenGeneration } from "../controllers/liveClassControllers.js";

const router = Router();
router.get("/deepgram-token", protect, handleDeepgramTokenGeneration);

export default router;