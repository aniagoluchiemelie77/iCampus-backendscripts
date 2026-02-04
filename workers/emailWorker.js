import amqp from "amqplib";
import {transporter} from "../index.js"; // your nodemailer config

export async function startWorker() {
  const connection = await amqp.connect("amqp://localhost:5672");
  const channel = await connection.createChannel();
  await channel.assertQueue("emailQueue");
  console.log("📨 Email worker started...");
  channel.consume("emailQueue", async (msg) => {
    if (!msg) return;
    /** @type {{ email: string, code: string }} */
    const { email, code } = JSON.parse(msg.content.toString());
    try {
      await transporter.sendMail({
        from: '"iCampus" <admin@uniquetechcontentwriter.com>',
        to: email,
        subject: "Verify Your Account",
        html: ` <h1>Welcome to iCampus!</h1> 
              <p>Your verification code:</p> 
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px;"> ${code} </div> 
              <p>This code expires in 15 minutes.</p> `,
      });
      console.log("📧 Email sent to:", email);
      channel.ack(msg);
    } catch (error) {
      console.error("Email sending failed:", error); // Do NOT ack — message stays in queue
    }
  });
}

