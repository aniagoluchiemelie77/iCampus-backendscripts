import amqp from "amqplib";
let channel = null;

export async function initEmailQueue() {
  const connection = await amqp.connect("amqp://localhost:5672");
  channel = await connection.createChannel();
  await channel.assertQueue("emailQueue");
}
/**
 * @param {import('../types/emailJob').EmailJob} job
 */
export async function sendEmailJob(job) {
  if (!channel) {
    throw new Error("Email queue not initialized");
  }

  channel.sendToQueue("emailQueue", Buffer.from(JSON.stringify(job)));
}
