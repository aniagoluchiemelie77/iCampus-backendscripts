import express from "express";
import { protect } from "../middleware/auth.js";
import {
  createTicket,
} from "../controllers/ticketingController.js";

export default function () {
  const router = express.Router();
  
  router.post("/create-ticket", protect, createTicket);
}
