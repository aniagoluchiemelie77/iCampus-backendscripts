import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import {
  User,
  ProductCategory,
  Product,
  Student,
  Lecturer,
  Event,
  UserRecords,
} from "./tableDeclarations.js";
import { connectQueue } from "./rabbitmq.js";
import { client } from "./workers/reditFile.js";

dotenv.config();

const app = express();
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
    app.use("/store", productRoutes);
    app.use("/verifyStudent", studentVerifyRoutes);
    app.use("/verifyLecturer", lecturerVerifyRoutes);
    app.listen(5000, "0.0.0.0", () => {
      console.log("Backend running on port 5000");
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });

export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token missing" });
  }
  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};
export const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 15 minutes
  max: 5, // limits each IP to 5 login attempts per windowMs
  message: {
    error: "Too many login attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
export const removeOutOfStockProducts = async () => {
  try {
    const result = await Product.deleteMany({ inStock: { $eq: 0 } });
    console.log(`Deleted ${result.deletedCount} out-of-stock products.`);
  } catch (error) {
    console.error("Error deleting out-of-stock products:", error);
  }
};
export const addUserRecord = async (userId, type, status, message) => {
  const now = new Date();
  const refDate = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const refTime = now.toTimeString().split(" ")[0]; // HH:MM:SS

  await UserRecords.updateOne(
    { userId },
    {
      $push: {
        records: {
          type,
          status,
          message,
          refDate,
          refTime,
        },
      },
    },
    { upsert: true },
  );
};
export const emailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: {
    error: "Too many requests, try again later.",
  },
});
export const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.TRANSPORTER_AUTH_USER,
    pass: process.env.TRANSPORTER_AUTH_PASS,
  },
});
//MongoDB connection: mongod --dbpath "D:\MongoDB\data"
