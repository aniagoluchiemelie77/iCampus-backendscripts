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
router.post("/repost", protect, idempotencyMiddleware, repost);
router.post("/create", protect, idempotencyMiddleware, createPost);
router.get("/search", protect, searchPosts);
router.patch(
  "/:postId/bookmark",
  protect,
  idempotencyMiddleware,
  toggleBookmark,
);
router.patch(
  "/:postId/impression",
  protect,
  idempotencyMiddleware,
  incrementImpressions,
);
router.post("/:postId/comment", protect, idempotencyMiddleware, addComment);
router.post(
  "/:postId/comments/:commentId/like",
  protect,
  idempotencyMiddleware,
  toggleCommentLike,
);
router.put("/:postId/update", protect, idempotencyMiddleware, updatePost);
router.patch("/:postId/vote", protect, idempotencyMiddleware, pollVote);
router.get("/:postId", protect, fetchPostUsingPostId);
router.delete("/:postId/delete", protect, idempotencyMiddleware, deletePost);
router.post("/:postId/like", protect, idempotencyMiddleware, toggleLike);

export default router;
