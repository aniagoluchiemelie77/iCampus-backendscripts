import express from "express";
import { protect } from "../middleware/auth.js";
import { markAllMessagesAsRead } from "../controllers/userActionsController.js";
import {
  fetchAllUserConversations,
  fetchPal2PalConversation,
} from "../controllers/fetchActions.js";

export default function () {
  const router = express.Router();
  router.get("/fetchMessage/:recipientId", protect, fetchPal2PalConversation);
  router.get("/conversations/:uid", protect, fetchAllUserConversations);
  router.post("/mark-all-read/:uid", protect, markAllMessagesAsRead);
  return router;
}