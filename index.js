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
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    const studentVerifyModule = await import(
      pathToFileURL(path.join(__dirname, "routes/verify/students.js")).href
    );
    const reviewsModule = await import(
      pathToFileURL(path.join(__dirname, "routes/reviews.js")).href
    );
    const ticketingModule = await import(
      pathToFileURL(path.join(__dirname, "routes/supportTicketing.js")).href
    );
    const webhooksModule = await import(
      pathToFileURL(path.join(__dirname, "routes/webhooks.js")).href
    );
    const appAuthModule = await import(
      pathToFileURL(path.join(__dirname, "routes/appAuth.js")).href
    );
    const messageModule = await import(
      pathToFileURL(path.join(__dirname, "routes/messages.js")).href
    );
    const adminModule = await import(
      pathToFileURL(path.join(__dirname, "routes/admin.js")).href
    );
    const userAccountDetailsModule = await import(
      pathToFileURL(path.join(__dirname, "routes/userAccountDetails.js")).href
    );
    const studentClassModule = await import(
      pathToFileURL(path.join(__dirname, "routes/class/students.js")).href
    );
    const lecturerClassModule = await import(
      pathToFileURL(path.join(__dirname, "routes/class/lecturers.js")).href
    );
    const storeModule = await import(
      pathToFileURL(path.join(__dirname, "routes/store.js")).href
    );
    const postModule = await import(
      pathToFileURL(path.join(__dirname, "routes/posts.js")).href
    );
    const userVerifyModule = await import(
      pathToFileURL(path.join(__dirname, "routes/verify/users.js")).href
    );
    const lecturerVerifyModule = await import(
      pathToFileURL(path.join(__dirname, "routes/verify/lecturers.js")).href
    );
    const routePath = path.join(__dirname, "routes/user.js");
    const userModule = await import(pathToFileURL(routePath).href);

    const userRoutes = userModule.default;
    const lecturerVerifyRoutes = lecturerVerifyModule.default;
    const userVerifyRoutes = userVerifyModule.default;
    const postRoutes = postModule.default;
    const studentVerifyRoutes = studentVerifyModule.default;
    const reviewsRoutes = reviewsModule.default;
    const ticketingRoutes = ticketingModule.default;
    const webhooksRoutes = webhooksModule.default;
    const appAuthRoutes = appAuthModule.default;
    const messageRoutes = messageModule.default;
    const adminRoutes = adminModule.default;
    const userAccountDetailsRoute = userAccountDetailsModule.default;
    const studentClassDetails = studentClassModule.default;
    const lecturerClassDetails = lecturerClassModule.default;
    const storeRoutes = storeModule.default;

    app.use("/users", userRoutes);
    app.use("/reviews", reviewsRoutes);
    app.use("/webhooks", webhooksRoutes);
    app.use("/admins", adminRoutes);
    app.use("/v1/auth", appAuthRoutes);
    app.use("/users/messages", messageRoutes);
    app.use("/support/tickets", ticketingRoutes);
    app.use("/user", userAccountDetailsRoute);
    app.use("/users/student/class", studentClassDetails);
    app.use("/users/lecturers/class", lecturerClassDetails);
    app.use("/posts", postRoutes);
    app.use("/store", storeRoutes);
    app.use("/verifyStudent", studentVerifyRoutes);
    app.use("/verifyInstructor", lecturerVerifyRoutes);
    app.use("/verifyUser", userVerifyRoutes);

    console.log("✅ MongoDB connected");
    httpServer.listen(5000, "0.0.0.0", () => {
      console.log("🚀 Backend & Socket.io running on port 5000");
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });

export const transporter = nodemailer.createTransport({
  host: "smtp.postmarkapp.com",
  port: 2525,
  auth: {
    user: process.env.TRANSPORTER_AUTH_USER,
    pass: process.env.TRANSPORTER_AUTH_PASS,
  },
});
