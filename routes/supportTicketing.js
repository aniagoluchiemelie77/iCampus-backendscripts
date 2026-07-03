import express from "express";
import { protect, verifyAdmin } from "../middleware/auth.js";
import {
  createTicket,
  adminUpdateTicketStatus,
} from "../controllers/ticketingController.js";
import { fetchActiveTickets } from "../controllers/fetchActions.js";

export default function () {
  const router = express.Router();

  router.post("/create-ticket", protect, createTicket);
  router.patch(
    "/:ticketRefId/status",
    protect,
    verifyAdmin,
    adminUpdateTicketStatus,
  );
  router.get("/fetch-all", protect, verifyAdmin, fetchActiveTickets);
}
