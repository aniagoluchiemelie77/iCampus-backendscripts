import express from "express";
import {
  personaVerifyConfirmation,
  handleFlutterwaveWebhook,
  handlePostmarkInboundSupportTickets,
  handleQstashInboundEmailJobs,
} from "../controllers/webhookControllers.js";

const router = express.Router();

router.post("/flw-webhook", handleFlutterwaveWebhook);
router.post("/persona/webhook", personaVerifyConfirmation);
router.post("/postmark/webhook", handlePostmarkInboundSupportTickets);
router.post("/qstash/webhook/send-notifications", handleQstashInboundEmailJobs);
export default router;

