import express from "express";
import { protect, verifyAdmin } from "../middleware/auth.js";
import {
  createTicket,
  adminUpdateTicketStatus,
} from "../controllers/ticketingController.js";
import { fetchActiveTickets } from "../controllers/fetchActions.js";
import { idempotencyMiddleware } from "../middleware/auth.js";

const router = express.Router();

router.post("/create-ticket", protect, idempotencyMiddleware, createTicket);
router.patch(
  "/:ticketRefId/status",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  adminUpdateTicketStatus,
);
router.get("/fetch-all", protect, verifyAdmin, fetchActiveTickets);

export default router;