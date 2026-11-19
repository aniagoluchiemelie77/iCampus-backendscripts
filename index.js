import express from "express";
import { createServer } from "http";
import cors from "cors";
import dotenv from "dotenv";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";
import { monitorSubscriptions } from "./cron/subscriptionsCron.js";
import { init as initSocket } from "./controllers/socket.js";
import { flagSuspiciousAccounts } from "./cron/flagSuspiciousAccountsCron.js";
import {
  updateLecturerInfo,
  updateStudentInfo,
} from "./cron/checkForAlumnisCron.js";
import { lectureReminderCron } from "./cron/lectureReminderCron.js";
import { assessmentReminderCron } from "./cron/assessmentReminderCron.js";
import { socialMediaSnapshotCron } from "./cron/socialMediaCron.js";
import {
  corsOrigin,
  errorHandler,
  requestLogger,
  requireEdgeOrigin,
  securityHeaders,
  warnIfCorsOpen,
} from "./middleware/security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();

// Behind Cloudflare + the platform load balancer. Rate limits key on the
// client IP, so this must match the real number of proxy hops.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable("x-powered-by");
warnIfCorsOpen();

const httpServer = createServer(app);
const io = initSocket(httpServer);

//Cron jobs
flagSuspiciousAccounts();
updateStudentInfo();
updateLecturerInfo();
lectureReminderCron();
assessmentReminderCron();
socialMediaSnapshotCron();
monitorSubscriptions();

// Unauthenticated liveness probe for Render / App Engine health checks.
app.get("/healthz", (req, res) => res.json({ ok: true }));

app.use(requireEdgeOrigin);
app.use(securityHeaders());
app.use(cors({ origin: corsOrigin }));
app.use(requestLogger);

app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    // Face-verification selfies are sent as base64 and exceed the 100kb default.
    const limit = req.path.endsWith("/verify-student") ? "10mb" : "100kb";
    express.json({ limit })(req, res, next);
  } else {
    next();
  }
});

const startServer = async () => {
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
    const secureProxyModule = await import(
      pathToFileURL(path.join(__dirname, "routes/secureProxy.js")).href
    );

    app.use("/users", userModule.default);
    app.use("/reviews", reviewsModule.default);
    app.use("/webhooks", webhooksModule.default);
    app.use("/admins", adminModule.default);
    app.use("/v1/auth", appAuthModule.default);
    app.use("/support/tickets", ticketingModule.default);
    app.use("/user", userAccountDetailsModule.default);
    app.use("/users/student/class", studentClassModule.default);
    app.use("/users/lecturers/class", lecturerClassModule.default);
    app.use("/posts", postModule.default);
    app.use("/store", storeModule.default);
    app.use("/verifyStudent", studentVerifyModule.default);
    app.use("/verifyInstructor", lecturerVerifyModule.default);
    app.use("/verifyUser", userVerifyModule.default);
    app.use("/v1/secure", secureProxyModule.default);

    console.log("✅ All routes successfully loaded");

    app.use(errorHandler);

    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Backend & Socket.io running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Error loading routes:", error);
    process.exit(1);
  }
};

startServer();