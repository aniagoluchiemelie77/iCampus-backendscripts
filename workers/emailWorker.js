import { Client } from "@upstash/qstash";

const qstash = new Client({
  token: process.env.QSTASH_TOKEN,
});

export async function queueEmailJob(emailData) {
  try {
    const res = await qstash.publishJSON({
      url: `${process.env.BACKEND_URL}/webhooks/qstash/webhook/send-notifications`,
      body: emailData,
    });
    console.log("Email job queued in QStash:", res.messageId);
  } catch (error) {
    console.error("Failed to queue email with QStash:", error);
    throw error;
  }
}
