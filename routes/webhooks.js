import crypto from "crypto";
import express from "express";
import {
  handleFlutterwaveWebhook
} from "../controllers/paymentController.js";

export default function (User) {
    const router = express.Router();
    router.post("/flw-webhook", handleFlutterwaveWebhook);
    router.post('/persona/webhook', async (req, res) => {
        const personaSignature = req.headers['persona-signature'];
        const WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET; 
        const hash = crypto
            .createHmac('sha256', WEBHOOK_SECRET)
            .update(JSON.stringify(req.body))
            .digest('hex');
        if (hash !== personaSignature) {
            return res.status(401).send('Invalid signature');
        }
        const { data } = req.body;
        const eventType = data.attributes.name; 
        const payload = data.relationships.object.data;
        if (eventType === 'inquiry.completed') {
            const inquiryId = payload.id;
            const referenceId = data.attributes.payload.data.attributes['reference-id'];
            if (referenceId) {
                // 3. Update your Database
                const updatedUser = await User.findOneAndUpdate(
                    { uid: referenceId }, 
                    { 
                        isVerified: true,
                        personaInquiryId: inquiryId 
                    },
                    { new: true } 
                );
                if (updatedUser) {
                    console.log(`User with uid: ${referenceId} is now verified.`);
                } else {
                    console.warn(`Webhook received for uid: ${referenceId}, but no user found.`);
                }
            }
        }
        // Always return 200 to Persona immediately
        res.status(200).send('Webhook processed');
    });
}