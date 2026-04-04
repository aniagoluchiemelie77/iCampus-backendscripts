import express from "express";
import { createServer } from "http";
import "./workers/reditFile.js";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import {
  User,
  ProductCategory,
  Product,
  Student,
  Lecturer,
  Event,
  Posts,
} from "./tableDeclarations.js";
import { connectQueue } from "./rabbitmq.js";
import { client } from "./workers/reditFile.js";
import { initEmailQueue } from "./controllers/emailProducers.js";
import { startWorker } from "./workers/emailWorker.js";
import { init } from "./controllers/socket.js";

dotenv.config();

(async () => {
  await initEmailQueue();
  startWorker();
})();

const app = express();
const httpServer = createServer(app);

// 5. Make 'io' accessible to all routes via req.app.get("socketio")
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

    // Dynamic imports for routes
    const userRoutes = (await import("./routes/user.js")).default(User);
    const userAccountDetailsRoute = (
      await import("./routes/userAccountDetails.js")
    ).default(User);
    const studentClassDetails = (
      await import("./routes/class/students.js")
    ).default(User);
    const lecturerClassDetails = (
      await import("./routes/class/lecturers.js")
    ).default(User);
    const productRoutes = (await import("./routes/store/products.js")).default(
      ProductCategory,
      Product,
    );
    const postRoutes = (await import("./routes/posts.js")).default(Posts, User);
    const eventsRoute = (await import("./routes/userEvents.js")).default(Event);
    const studentVerifyRoutes = (
      await import("./routes/verify/students.js")
    ).default(Student);
    const lecturerVerifyRoutes = (
      await import("./routes/verify/lecturers.js")
    ).default(Lecturer);

    app.use("/users", userRoutes);
    app.use("/user", userAccountDetailsRoute);
    app.use("/users/student/class", studentClassDetails);
    app.use("/users/lecturers/class", lecturerClassDetails);
    app.use("/user/events", eventsRoute);
    app.use("/posts", postRoutes);
    app.use("/store", productRoutes);
    app.use("/verifyStudent", studentVerifyRoutes);
    app.use("/verifyInstructor", lecturerVerifyRoutes);

    // 6. Change app.listen to httpServer.listen
    httpServer.listen(5000, "0.0.0.0", () => {
      console.log("🚀 Backend & Socket.io running on port 5000");
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });
export const removeOutOfStockProducts = async () => {
  try {
    const result = await Product.deleteMany({ inStock: { $eq: 0 } });
    console.log(`Deleted ${result.deletedCount} out-of-stock products.`);
  } catch (error) {
    console.error("Error deleting out-of-stock products:", error);
  }
};

export const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.TRANSPORTER_AUTH_USER,
    pass: process.env.TRANSPORTER_AUTH_PASS,
  },
});
//MongoDB connection: mongod --dbpath "D:\MongoDB\data"
