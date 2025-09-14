import express from "express";
import cors from "cors";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());
const MONGO_URI = "mongodb://127.0.0.1:27017/iCampus";
const userSchema = new mongoose.Schema({
  uid: String,
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
  createdAt: Date,
  country: String,
});
mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    const User = mongoose.model("User", userSchema); // ✅ Register model after connection
    const userRoutes = (await import("./routes/user.js")).default(User);
    app.use("/users", userRoutes);
    app.get("/test", (req, res) => {
      res.send("✅ Backend is reachable");
    });

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
