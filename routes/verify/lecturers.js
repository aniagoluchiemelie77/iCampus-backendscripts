import express from "express";
import { verifyLecturer } from "../../controllers/signinActions.js";
import { idempotencyMiddleware } from "../../middleware/auth.js";

const router = express.Router();

router.post("/verify-lecturer", idempotencyMiddleware, verifyLecturer);

export default router;
