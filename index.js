import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();
console.log("✅ storeRoutes loaded");
const app = express();
app.use(cors());
app.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PUT") {
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
export const userSchema = new mongoose.Schema({
  uid: String,
  profilePic: String,
  usertype: String,
  isFirstLogin: Boolean,
  firstname: String,
  lastname: String,
  schoolName: String,
  email: String,
  ipAddress: [String],
  deviceType: [String],
  accessToken: String,
  password: String,
  department: String,
  pointsBalance: Number,
  hasSubscribed: Boolean,
  isCourseRep: Boolean,
  createdAt: Date,
  country: String,
  current_level: String,
  phone_number: String,
  matriculation_number: String,
  staff_id: String,
  cart: [{ type: String }],
  favorites: [{ type: String }],
  isVerified: {
    type: Boolean,
    default: false,
  },
  verificationToken: {
    type: String,
    default: null,
  },
});
userSchema.index(
  { matriculation_number: 1, department: 1 },
  { unique: true, partialFilterExpression: { usertype: "student" } }
);

userSchema.index(
  { staff_id: 1, department: 1 },
  { unique: true, partialFilterExpression: { usertype: "lecturer" } }
);

const verifyStudentSchema = new mongoose.Schema({
  firstname: String,
  lastname: String,
  department: String,
  current_level: String,
  phone_number: String,
  matriculation_number: String,
  school_name: String,
});
const storeCategoriesSchema = new mongoose.Schema({
  id: Number,
  categoryName: String,
  schoolName: String,
});
export const productSchema = new mongoose.Schema({
  id: Number,
  productId: { type: String, required: true },
  category: { type: String, required: true },
  schoolName: { type: String, required: true },
  sellerId: { type: String, required: true },
  title: { type: String, required: true },
  mediaUrls: [{ type: String }], // ✅ array of strings
  colors: [{ type: String }], // ✅ array of product colors
  sizes: [{ type: String }], // ✅ array of product sizes
  type: { type: String, enum: ["product", "File"], required: true },
  priceInPoints: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  isAvailable: { type: Boolean, default: true },
  favCount: { type: Number, default: 0 },
  ratings: [{ type: Number }], // ✅ array of numbers
  description: { type: String },
  lockedWithPassword: { type: Boolean, default: false },
  password: { type: String }, // optional, only if locked
  isFile: { type: Boolean, default: false },
  fileUrl: { type: String },
  fileSizeInMB: { type: Number },
  downloadCount: { type: Number, default: 0 },
});
export const notificationSchema = new mongoose.Schema({
  id: Number,
  notificationId: { type: String },
  userId: { type: String },
  title: { type: String },
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  isPublic: { type: Boolean, default: false },
  relatedSchoolName: { type: String },
  department: { type: String },
  level: { type: String },
  relatedCommunityId: { type: String },
  createdAt: { type: Date, default: Date.now },
  relatedEventId: { type: String },
  relatedPollId: { type: String },
  relatedClassSessionId: { type: String },
});

const verifyLecturerSchema = new mongoose.Schema({
  firstname: String,
  lastname: String,
  department: String,
  phone_number: String,
  school_name: String,
  staff_id: String,
});
const Student = mongoose.model("Student", verifyStudentSchema, "students");
const Lecturer = mongoose.model("Lecturer", verifyLecturerSchema, "lecturers");
const ProductCategory = mongoose.model(
  "Category",
  storeCategoriesSchema,
  "store-categories"
);

const Product = mongoose.model("Product", productSchema, "store-products");

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    const User = mongoose.model("User", userSchema); // ✅ Register model after connection
    const userRoutes = (await import("./routes/user.js")).default(User);
    const productRoutes = (await import("./routes/store/products.js")).default(
      ProductCategory,
      Product
    );
    const eventsRoute = (await import("./routes/userEvents.js")).default;
    const studentVerifyRoutes = (
      await import("./routes/verify/students.js")
    ).default(Student);
    const lecturerVerifyRoutes = (
      await import("./routes/verify/lecturers.js")
    ).default(Lecturer);
    app.use("/users", userRoutes);
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

mongoose.connection.on("connected", () => {
  console.log("🧠 Mongoose connection is fully established");
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

//MongoDB connection: mongod --dbpath "D:\MongoDB\data"
