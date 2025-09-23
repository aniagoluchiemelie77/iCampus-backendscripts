import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import nodemailer from "nodemailer";

export default function (User) {
  const router = express.Router();
  router.post("/register", async (req, res) => {
    console.log("Incoming payload:", req.body);
    const { usertype, matriculation_number, staff_id, department, password } =
      req.body;
    try {
      const existingUser = await User.findOne({
        usertype,
        ...(usertype === "student" && {
          matriculation_number,
          department,
        }),
        ...(usertype === "lecturer" && {
          staff_id,
          department,
        }),
      });
      if (existingUser) {
        return res.status(409).json({
          message: "User already exists with this ID and department.",
        });
      }
      console.log("🧪 Attempting insert...");
      const token = crypto.randomBytes(32).toString("hex");
      console.log(token);
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = new User({
        ...req.body,
        password: hashedPassword,
        verificationToken: token,
        isVerified: false,
      });
      await newUser.save();
      const transporter = nodemailer.createTransport({
        host: "sandbox.smtp.mailtrap.io",
        port: 2525,
        auth: {
          user: "ef11ae5dba1a82",
          pass: "e37a56bc265a6b",
        },
      });
      const verificationLink = `http://localhost:5000/users/verify-email?token=${token}`;
      await transporter.sendMail({
        from: '"iCampus" <admin@uniquetechcontentwriter.com>',
        to: req.body.email,
        subject: "Verify Your Account",
        html: `
               <h2>Welcome to iCampus!</h2>
              <p>Click the link below to verify your account:</p>
              <a href="${verificationLink}">Verify Email</a>
            `,
      });
      res.status(201).json({
        message: "User created successfully, check your email",
        email: req.body.email,
        verified: false,
      });
    } catch (error) {
      console.error("❌ Insert failed:", error);
      if (error.code === 11000) {
        return res.status(409).json({
          message: "Duplicate entry: User already exists.",
        });
      }
      res.status(500).json({
        error: error.message || "Failed to save user",
      });
    }
  });
  router.post("/login", async (req, res) => {
    const { identifier, password } = req.body;

    try {
      // Find user by email or firstname
      const user = await User.findOne({
        $or: [{ email: identifier }],
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Compare password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid password" });
      }

      // Optional: generate token or session
      console.log("✅ Login succeeded:", user._id);
      res.status(200).json({ message: "Login successful", userId: user._id });
    } catch (error) {
      console.error("❌ Login failed:", error);
      res.status(500).json({ error: error.message || "Login error" });
    }
  });
  router.patch("/:uid", async (req, res) => {
    try {
      const updatedUser = await User.findOneAndUpdate(
        { uid: req.params.uid },
        { $set: req.body },
        { new: true }
      );
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ message: "User updated", user: updatedUser });
    } catch (error) {
      console.error("❌ Update failed:", error);
      res.status(500).json({ error: error.message });
    }
  });
  router.get("/verify-email", async (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Missing verification token");
    }
    const user = await User.findOneAndUpdate(
      { verificationToken: token },
      { isVerified: true, verificationToken: null },
      { new: true }
    );
    console.log("✅ User updated:", user);
    if (!user) {
      return res.status(404).send("Invalid or expired token");
    }
    const isMobile =
      req.headers["user-agent"].includes("Android") ||
      req.headers["user-agent"].includes("iPhone");
    if (isMobile) {
      res.redirect("icampus://verify-email?verified=true");
    } else {
      res.status(200).json({
        message: "✅ Account verified",
        verified: true,
      });
    }
  });
  router.get("/status", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).send("Missing email");
    const user = await User.findOne({ email });
    if (!user) return res.status(404).send("User not found");
    res.status(200).json({ isVerified: user.isVerified });
  });

  return router;
}
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js
