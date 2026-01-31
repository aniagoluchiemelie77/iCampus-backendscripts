import amqp from "amqplib";

let channel;

async function connectQueue() {
  try {
    const connection = await amqp.connect("amqp://localhost"); 
    channel = await connection.createChannel();
    console.log("🐇 Connected to RabbitMQ");
  } catch (error) {
    console.error("RabbitMQ connection error:", error);
  }
}

function getChannel() {
  return channel;
}

module.exports = { connectQueue, getChannel };
