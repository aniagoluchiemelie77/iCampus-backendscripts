import express from "express";
import { protect } from "../middleware/auth.js";
import {
  fetchAllUserConversations,
  fetchPal2PalConversation,
} from "../controllers/fetchActions.js";
import {
  editMessage,
  deleteMessage,
  markAllMessagesAsRead,
} from "../controllers/chatController.js";

const router = express.Router();

router.get("/fetchMessage/:recipientId", protect, fetchPal2PalConversation);
router.get("/conversations/:uid", protect, fetchAllUserConversations);
router.post("/mark-all-read/:uid", protect, markAllMessagesAsRead);
router.patch("/:messageId/update", protect, editMessage);
router.delete("/:messageId/delete", protect, deleteMessage);

export default router;