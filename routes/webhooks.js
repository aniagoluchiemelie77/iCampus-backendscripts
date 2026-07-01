import express from "express";
import {
  personaVerifyConfirmation,
  handleFlutterwaveWebhook,
  handlePostmarkInboundSupportTickets,
} from "../controllers/webhookControllers.js";

export default function () {
  const router = express.Router();
  router.post("/flw-webhook", handleFlutterwaveWebhook);
  router.post("/persona/webhook", personaVerifyConfirmation);
  router.post("/postmark/webhook", handlePostmarkInboundSupportTickets);
}
