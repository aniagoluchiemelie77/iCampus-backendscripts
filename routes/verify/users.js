import express from "express";
import { protect } from "../../middleware/auth.js";
import { createPersonaVerifyInquiry } from "../../controllers/userActionsController.js";

const router = express.Router();

router.post("/persona/create-inquiry", protect, createPersonaVerifyInquiry);

export default router;
