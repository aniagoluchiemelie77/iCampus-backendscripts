import amqp from "amqplib";

let channel;

export async function connectQueue() {
  try {
    const connection = await amqp.connect("amqp://localhost");
    channel = await connection.createChannel();
    console.log("🐇 Connected to RabbitMQ");
  } catch (error) {
    console.error("RabbitMQ connection error:", error);
  }
}

export function getChannel() {
  return channel;
}
