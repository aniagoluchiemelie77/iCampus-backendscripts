import express from "express";
import { verifyStudent } from "../../controllers/signinActions.js";
import { idempotencyMiddleware } from "../../middleware/auth.js";

const router = express.Router();

router.post("/verify", idempotencyMiddleware, verifyStudent);

export default router;
