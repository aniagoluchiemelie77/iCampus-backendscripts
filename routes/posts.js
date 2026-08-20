import express from "express";
import { protect, idempotencyMiddleware } from "../middleware/auth.js";
import {
  createPost,
  updatePost,
  deletePost,
  toggleLike,
  toggleBookmark,
  addComment,
  fetchPostUsingPostId,
  pollVote,
  incrementImpressions,
  repost,
  toggleCommentLike,
} from "../controllers/postActions.js";
import { fetchPosts } from "../controllers/fetchActions.js";
import { searchPosts } from "../controllers/userActionsController.js";

const router = express.Router();

router.get("/fetchPosts", protect, fetchPosts);
router.post("/:postId/like", protect, toggleLike);
router.patch("/:postId/bookmark", protect, toggleBookmark);
router.patch("/:postId/impression", protect, incrementImpressions);
router.post("/:postId/comment", protect, addComment);
router.patch("/:postId/comments/:commentId/like", protect, toggleCommentLike);
router.post("/repost", protect, repost);
router.post("/create", protect, idempotencyMiddleware, createPost);
router.put("/:postId/update", protect, idempotencyMiddleware, updatePost);
router.patch("/vote", protect, pollVote);
router.get("/:postId", protect, fetchPostUsingPostId);
router.delete("/:postId/delete", protect, idempotencyMiddleware, deletePost);
router.get("/search", protect, searchPosts);

export default router;
