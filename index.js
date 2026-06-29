import express from "express";
import { createServer } from "http";
import "./workers/reditFile.js";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { init } from "./controllers/socket.js";
import { connectQueue } from "./rabbitmq.js";
import { client } from "./workers/reditFile.js";
import { initEmailQueue } from "./controllers/emailProducers.js";
import { startWorker } from "./workers/emailWorker.js";
import { init as initSocket } from "./controllers/socket.js";

dotenv.config();

(async () => {
  await initEmailQueue();
  startWorker();
})();

const app = express();
const httpServer = createServer(app);
const io = init(httpServer);
init(httpServer);

app.use(cors());
app.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    express.json()(req, res, next);
  } else {
    next();
  }
});

app.use((req, res, next) => {
  console.log(`🔗 ${req.method} ${req.url}`);
  req.io = io;
  next();
});

const MONGO_URI = "mongodb://127.0.0.1:27017/iCampus";
client.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

connectQueue();

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    const userRoutes = await import("./routes/user.js");
    const reviewsRoutes = await import("./routes/reviews.js");
    const webhooksRoutes = await import("./routes/webhooks.js");
    const appAuthRoutes = await import("./routes/appAuth.js");
    const messageRoutes = await import("./routes/messages.js");
    const adminRoutes = await import("./routes/admin.js");
    const userAccountDetailsRoute =
      await import("./routes/userAccountDetails.js");
    const studentClassDetails = await import("./routes/class/students.js");
    const lecturerClassDetails = await import("./routes/class/lecturers.js");
    const storeRoutes = await import("./routes/store.js");
    const postRoutes = await import("./routes/posts.js");
    const studentVerifyRoutes = await import("./routes/verify/students.js");
    const userVerifyRoutes = await import("./routes/verify/users.js");
    const lecturerVerifyRoutes = await import("./routes/verify/lecturers.js");

    app.use("/users", userRoutes);
    app.use("/reviews", reviewsRoutes);
    app.use("/webhooks", webhooksRoutes);
    app.use("/admins", adminRoutes);
    app.use("/v1/auth", appAuthRoutes);
    app.use("/users/messages", messageRoutes);
    app.use("/user", userAccountDetailsRoute);
    app.use("/users/student/class", studentClassDetails);
    app.use("/users/lecturers/class", lecturerClassDetails);
    app.use("/posts", postRoutes);
    app.use("/store", storeRoutes);
    app.use("/verifyStudent", studentVerifyRoutes);
    app.use("/verifyInstructor", lecturerVerifyRoutes);
    app.use("/verifyUser", userVerifyRoutes);
    // 6. Change app.listen to httpServer.listen
    httpServer.listen(5000, "0.0.0.0", () => {
      console.log("🚀 Backend & Socket.io running on port 5000");
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });

export const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.TRANSPORTER_AUTH_USER,
    pass: process.env.TRANSPORTER_AUTH_PASS,
  },
});
