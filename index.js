import express from "express";
import { createServer } from "http";
import cors from "cors";
import dotenv from "dotenv";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./config/firebaseAdmin.js";
import { client as redisClient } from "./workers/reditFile.js";
import { init as initSocket } from "./controllers/socket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = initSocket(httpServer);

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

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

(async () => {
  try {
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
    const userModule = await import(
      pathToFileURL(path.join(__dirname, "routes/user.js")).href
    );

    app.use("/users", userModule.default);
    app.use("/reviews", reviewsModule.default);
    app.use("/webhooks", webhooksModule.default);
    app.use("/admins", adminModule.default);
    app.use("/v1/auth", appAuthModule.default);
    app.use("/users/messages", messageModule.default);
    app.use("/support/tickets", ticketingModule.default);
    app.use("/user", userAccountDetailsModule.default);
    app.use("/users/student/class", studentClassModule.default);
    app.use("/users/lecturers/class", lecturerClassModule.default);
    app.use("/posts", postModule.default);
    app.use("/store", storeModule.default);
    app.use("/verifyStudent", studentVerifyModule.default);
    app.use("/verifyInstructor", lecturerVerifyModule.default);
    app.use("/verifyUser", userVerifyModule.default);

    console.log("✅ All routes successfully loaded");
  } catch (error) {
    console.error("❌ Error loading routes:", error);
  }
})();

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend & Socket.io running on port ${PORT}`);
});