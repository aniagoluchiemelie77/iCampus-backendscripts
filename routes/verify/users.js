import express from "express";
import { protect } from "../../middleware/auth.js";
import { createPersonaVerifyInquiry } from "../../controllers/userActionsController.js";

export default function () {
  const router = express.Router();

  router.post("/persona/create-inquiry", protect, createPersonaVerifyInquiry);
  return router;
}
