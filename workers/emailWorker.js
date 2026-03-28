import amqp from "amqplib";
import { createNotification } from "../services/notificationService.js";

export async function startWorker() {
  const connection = await amqp.connect("amqp://localhost:5672");
  const channel = await connection.createChannel();
  await channel.assertQueue("emailQueue");
  console.log("📨 Email worker started...");
  channel.consume("emailQueue", async (msg) => {
    if (!msg) return;
    const job = JSON.parse(msg.content.toString());
    await createNotification(job);
    channel.ack(msg);
  });
}
