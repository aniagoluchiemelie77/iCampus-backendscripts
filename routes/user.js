import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import crypto from "crypto";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import { authenticate, loginLimiter } from "../index.js";
import {
  notificationSchema,
  courseSchema,
  transactionMiddleState,
} from "../index.js";
import multer from "multer";
import Tesseract from "tesseract.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import { fromPath } from "pdf2pic";
import mammoth from "mammoth";
import fs from "fs";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

// Temporary in-memory store
const verificationCodes = {};
const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: "ef11ae5dba1a82",
    pass: "e37a56bc265a6b",
  },
});
const now = new Date();

const formattedTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "numeric",
  hour12: true,
}).format(now);

const getOrdinalSuffix = (day) => {
  if (day > 3 && day < 21) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
};
const day = now.getDate();
const month = now.toLocaleString("default", { month: "short" }); // e.g., "Jan"
const year = now.getFullYear();

const formattedDate = `${day}${getOrdinalSuffix(day)} ${month} ${year}`;

// Utility to generate 6-digit code
const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

function generateNotificationId(length = 7) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
const upload = multer({ dest: "uploads/" });
export default function (User) {
  const router = express.Router();
  const Notification =
    mongoose.models.Notification ||
    mongoose.model("Notification", notificationSchema, "notifications");
  const Course =
    mongoose.models.Course ||
    mongoose.model("Course", courseSchema, "all-courses");
  const TransactionMiddleState =
    mongoose.models.TransactionMiddleState ||
    mongoose.model(
      "TransactionMiddleState",
      transactionMiddleState,
      "trans-mid-state"
    );

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
  router.post("/login", loginLimiter, async (req, res) => {
    const { identifier, password, ipAddress, location } = req.body;
    try {
      const user = await User.findOne({
        $or: [{ email: identifier }],
      });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid password" });
      }
      const { password: _, ...safeUser } = user.toObject();
      const token = jwt.sign(
        {
          id: user._id,
          email: user.email,
          uid: user.uid,
        },
        process.env.JWT_SECRET,
        { expiresIn: "10h" }
      );
      // Compare IP address
      if (!user.ipAddress.includes(ipAddress)) {
        user.ipAddress.push(ipAddress);
        await user.save();
        const loginMessage = `A login attempt from ${ipAddress} at ${location} on ${formattedTime}, ${formattedDate} was detected. Click here if this wasn't you.`;
        const notificationId = generateNotificationId();
        await Notification.create({
          userId: user.uid || user._id.toString(),
          notificationId: notificationId,
          title: "Successful Login",
          message: loginMessage,
          isPublic: false,
          isRead: false,
          createdAt: new Date(),
        });
      }
      if (user.isFirstLogin) {
        user.isFirstLogin = false;
        await user.save();
      }

      console.log("✅ Login succeeded:", user.uid);
      res.status(200).json({
        message: "Login successful",
        user: safeUser,
        token,
      });
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
  router.post("/forgotPassword", async (req, res) => {
    console.log("step 1");
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      console.log("Substep2");
      return;
    }
    const code = generateCode();
    verificationCodes[email] = {
      code,
      expiresAt: Date.now() + 12 * 60 * 60 * 1000, // expires in 12 hours
    };
    console.log(`Verification code for ${email}: ${code}`);
    await transporter.sendMail({
      from: '"iCampus" <admin@uniquetechcontentwriter.com>',
      to: email,
      subject: "Password Reset Verification Code",
      html: `<h1>Your 6-digit verification code is: ${code}</h1>
             <p>You are required to use the above code within 12 hours of password reset request</p>`,
    });
    res.status(201).json({
      message: "Verification code sent, check your email",
    });
  });
  router.post("/verifyCode", (req, res) => {
    const { email, code } = req.body;
    const record = verificationCodes[email];
    if (!record || record.code !== code || Date.now() > record.expiresAt) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }
    // Mark as verified, don't delete yet
    verificationCodes[email].verified = true;
    res.status(200).json({ message: "Code verified", email: email });
  });
  router.post("/changePassword", async (req, res) => {
    const { email, password, confirmPassword } = req.body;
    const record = verificationCodes[email];
    if (!record || !record.verified) {
      return res
        .status(403)
        .json({ message: "Email not verified for password reset" });
    }
    if (!password || !confirmPassword || password !== confirmPassword) {
      return res
        .status(400)
        .json({ message: "Passwords do not match or are missing" });
    }
    try {
      const user = await User.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });
      const hashedPassword = await bcrypt.hash(password, 10);
      user.password = hashedPassword;
      await user.save();
      delete verificationCodes[email];
      await transporter.sendMail({
        from: '"iCampus" <admin@uniquetechcontentwriter.com>',
        to: email,
        subject: "Successful Password Reset Attempt",
        html: `<h1>Successful Password Reset Attempt</h1>
               <p>Dear User, a successful password reset was carried out by your account on ${formattedDate}, if this is not you, reach out to our email: admin@uniquetechcontentwriter.com immediately.</p>`,
      }); // Clean up after success
      res.status(200).json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  router.get("/notifications", async (req, res) => {
    try {
      const { userId, limit = "50", offset = "0", unread, type } = req.query;

      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ message: "Missing or invalid userId" });
      }

      const parsedLimit = Math.max(parseInt(limit), 1);
      const parsedOffset = Math.max(parseInt(offset), 0);

      // Base filter: notifications for the user or public
      const filter = {
        $or: [{ userId }, { isPublic: true }],
      };

      // Optional: filter unread notifications
      if (unread === "true") {
        filter.isRead = false;
      }

      // Optional: filter by notification type
      if (type && typeof type === "string") {
        filter.type = type;
      }

      const total = await Notification.countDocuments(filter);
      const notifications = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(parsedOffset)
        .limit(parsedLimit);

      res.status(200).json({ notifications, total });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Server error fetching notifications" });
    }
  });
  router.get("/notifications/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const notification = await Notification.findOne({ notificationId: id });

      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }

      let purchaseDetails = null;

      if (notification.type === "transactions") {
        const user = await User.findOne({ uid: notification.userId });

        if (user && Array.isArray(user.purchaseHistory)) {
          purchaseDetails = user.purchaseHistory.find(
            (entry) => entry.id === notification.purchaseId
          );
        }
      }

      res.status(200).json({
        notification,
        ...(purchaseDetails && { purchaseDetails }),
      });
    } catch (error) {
      console.error("Error fetching notification:", error);
      res.status(500).json({ message: "Server error fetching notification" });
    }
  });

  router.get("/notifications/count", async (req, res) => {
    try {
      const { userId, unread, type } = req.query;

      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ message: "Missing or invalid userId" });
      }

      // Base filter: notifications for the user or public
      const filter = {
        $or: [{ userId }, { isPublic: true }],
      };

      // Optional: filter unread notifications
      if (unread === "true") {
        filter.isRead = false;
      }

      // Optional: filter by notification type
      if (type && typeof type === "string") {
        filter.type = type;
      }

      const count = await Notification.countDocuments(filter);

      res.status(200).json({ count });
    } catch (error) {
      console.error("Error fetching notification count:", error);
      res
        .status(500)
        .json({ message: "Server error fetching notification count" });
    }
  });
  router.patch("/notifications/:id/read", async (req, res) => {
    try {
      const { id } = req.params;
      const notification = await Notification.findOne({ notificationId: id });
      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }
      notification.isRead = true;
      await notification.save();

      res.status(200).json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  router.post("/upload-profile-image", authenticate, async (req, res) => {
    try {
      const userId = req.user.id;
      const { imageUrl } = req.body;

      if (!imageUrl) {
        return res.status(400).json({ message: "Image URL is required" });
      }

      // Update user's profilePic in the database
      const user = await User.findByIdAndUpdate(
        userId,
        { $push: { profilePic: imageUrl } }, // or overwrite if single image
        { new: true }
      );

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const ping = `Your profile image was successfully updated on ${formattedDate} at ${formattedTime}.`;
      const notificationId = generateNotificationId();
      await Notification.create({
        userId: user.uid || user._id.toString(),
        notificationId: notificationId,
        title: "Successful Profile Image Update",
        message: ping,
        isPublic: false,
        isRead: false,
        createdAt: new Date(),
      });

      return res
        .status(200)
        .json({ imageUrl, message: "Profile image updated successfully" });
    } catch (error) {
      console.error("Upload error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });
  router.post(
    "/upload-course-form",
    upload.single("file"),
    async (req, res) => {
      try {
        const { userId, staffId } = req.body;
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        console.log("Received API...");

        const user = await User.findOne({ uid: userId });
        if (!user) return res.status(404).json({ error: "User not found" });

        const schoolName = user.schoolName;
        const userMatricNumber = user.matricNumber;
        const fullName = user.fullName || "";

        let extractedText = "";

        if (file.mimetype.startsWith("image/")) {
          const result = await Tesseract.recognize(file.path, "eng");
          extractedText = result.data.text;
          console.log("File is image...");
        } else if (file.mimetype === "application/pdf") {
          const dataBuffer = fs.readFileSync(file.path);
          const pdfResult = await pdfParse(dataBuffer);

          if (pdfResult.text.trim() === "") {
            console.log("PDF has no extractable text — falling back to OCR...");

            const gm = require("gm").subClass({ imageMagick: true });
            const path = require("path");

            try {
              // Ensure temp folder exists
              const outputDir = path.resolve("./temp");
              if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir);
              }

              const filePath = path.resolve(file.path);
              const outputFile = path.join(outputDir, "ocr_page.png");

              // Convert first page of PDF to PNG using ImageMagick
              await new Promise((resolve, reject) => {
                console.log(
                  "Converting PDF with ImageMagick:",
                  `${filePath}[0] → ${outputFile}`
                );
                gm(`${filePath}[0]`)
                  .in("-density", "300")
                  .resize(2000, 2000)
                  .write(outputFile, (err) => {
                    if (err) {
                      console.error(
                        "ImageMagick conversion failed:",
                        err.message
                      );
                      return reject(
                        new Error("PDF conversion failed — PNG not created")
                      );
                    }
                    resolve();
                  });
              });

              if (!fs.existsSync(outputFile)) {
                throw new Error("PDF conversion failed — PNG not created");
              }

              console.log("Temp folder contents:", fs.readdirSync(outputDir));

              const ocrResult = await Tesseract.recognize(outputFile, "eng", {
                logger: (m) => console.log(m.status, m.progress),
              });

              extractedText = ocrResult.data.text;
              console.log("OCR extraction complete.");

              fs.unlinkSync(outputFile);
            } catch (err) {
              console.error("OCR fallback failed:", err.message);
              return res.status(400).json({
                error:
                  "Please ensure your course registration form is submitted.",
              });
            }
          } else {
            extractedText = pdfResult.text;
            console.log("PDF File confirmed...");
          }
        } else if (
          file.mimetype ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          const dataBuffer = fs.readFileSync(file.path);
          const result = await mammoth.extractRawText({ buffer: dataBuffer });
          extractedText = result.value;
          console.log("DOCX file confirmed...");
        } else {
          return res.status(400).json({ error: "Unsupported file type" });
        }

        // Regex parsers
        console.log("Pre file details extraction...");
        console.log("RAW extractedText:\n", extractedText);

        const courseRegex = /([A-Z]{3}\s?\d{3})\s+(.+?)\s+(?:C|E)\s+(\d)/gs;
        const nameRegex = new RegExp(fullName.replace(/\s+/g, "\\s+"), "i");
        const matricRegex = /(COET\/\d{4,5}\/\d{4})/;
        const deptRegex = /(Petroleum Engineering)/i;
        const levelRegex = /(\d{3}L)/;
        const firstSemTotalRegex =
          /Total Course Unit Registered This Semester:\s*(\d+)/;
        const sessionTotalRegex = /Total Course Unit For The Session:\s*(\d+)/;

        const name = extractedText.match(nameRegex)?.[0] || null;
        const matricNumber =
          extractedText.match(matricRegex)?.[1]?.trim() || null;
        const department = extractedText.match(deptRegex)?.[1]?.trim() || null;
        const level = extractedText.match(levelRegex)?.[1]?.trim() || null;
        const firstSemesterUnits = parseInt(
          extractedText.match(firstSemTotalRegex)?.[1] || "0"
        );
        const sessionUnits = parseInt(
          extractedText.match(sessionTotalRegex)?.[1] || "0"
        );

        console.log("File details extraction complete");
        console.log("Extracted matricNumber:", matricNumber);
        console.log("User matricNumber:", userMatricNumber);
        console.log(
          name,
          department,
          level,
          matricNumber,
          firstSemesterUnits,
          sessionUnits
        );

        if (
          !name &&
          !matricNumber &&
          !department &&
          !level &&
          firstSemesterUnits === 0 &&
          sessionUnits === 0
        ) {
          console.log("No recognizable course registration data found.");
          return res.status(400).json({
            error: "Please ensure your course registration form is submitted.",
          });
        }
        if (userMatricNumber !== matricNumber) {
          console.log("Does not match...");
          return res.status(404).json({
            error:
              "Matriculation number mismatch, please make sure the matric number on the submitted document matches the existing matric number",
          });
        }

        // Extract courses
        const courses = [];
        let match;
        while ((match = courseRegex.exec(extractedText)) !== null) {
          courses.push({
            code: match[1],
            title: match[2].trim(),
            unit: parseInt(match[3]),
            semester: extractedText.includes("SECOND SEMESTER")
              ? "Second"
              : "First",
          });
        }
        console.log("Course extraction complete...");

        // Create or update course records
        const createdCourses = [];
        if (!user.coursesEnrolled) user.coursesEnrolled = [];

        for (const course of courses) {
          const courseId = generateNotificationId();
          const existing = await Course.findOne({
            courseCode: course.code,
            level,
            department,
          });

          console.log("Saved course ids: ", courseId);

          if (!existing) {
            const newCourse = new Course({
              courseId,
              courseCode: course.code,
              courseTitle: course.title,
              department,
              level,
              schoolName,
              credits: course.unit,
              semester: course.semester,
              lecturerIds: staffId ? [userId] : [],
              studentsEnrolled: staffId ? [] : [userId],
            });

            await newCourse.save();
            createdCourses.push(newCourse);
            user.coursesEnrolled.push(courseId);
          } else {
            if (staffId && !existing.lecturerIds.includes(userId)) {
              existing.lecturerIds.push(userId);
            } else if (
              !staffId &&
              !existing.studentsEnrolled.includes(userId)
            ) {
              existing.studentsEnrolled.push(userId);
            }
            await existing.save();

            if (!user.coursesEnrolled.includes(existing.courseId)) {
              user.coursesEnrolled.push(existing.courseId);
            }

            createdCourses.push(existing);
          }
        }

        await user.save();
        fs.unlinkSync(file.path);
        console.log("Completed...");
        console.log(createdCourses);

        res.json({
          student: {
            firstSemesterUnits,
            sessionUnits,
          },
          courses: createdCourses,
        });
      } catch (err) {
        console.error("Error extracting course data:", err);
        res.status(500).json({ error: "Failed to process file" });
      }
    }
  );

  router.post("/transactions/complete/:transactionId", async (req, res) => {
    try {
      const { transactionId } = req.params;
      const transaction = await TransactionMiddleState.findOne({
        transactionId,
      });

      if (!transaction || transaction.status !== "pending") {
        return res
          .status(404)
          .json({ message: "Invalid or already completed transaction" });
      }
      const seller = await User.findOne({ uid: transaction.sellerId });
      if (!seller) {
        return res.status(404).json({ message: "Seller not found" });
      }
      // Update seller's points
      seller.pointsBalance += transaction.priceInPoints;
      await seller.save();
      // Delete transaction record
      await TransactionMiddleState.deleteOne({ transactionId });
      res
        .status(200)
        .json({ message: "Transaction completed and points transferred" });
    } catch (error) {
      console.error("Error completing transaction:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  return router;
}
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js
