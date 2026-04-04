import "../workers/reditFile.js";
import express from "express";
import bcrypt from "bcrypt";
import axiosRetry from "axios-retry";
import crypto from "crypto";
import { getChannel } from "../rabbitmq.js";
import axios from "axios";
import jwt from "jsonwebtoken";
import { createNotification } from "../services/notificationService.js";
import {
  authenticate,
  loginLimiter,
  addUserRecord,
  emailLimiter,
} from "../middleware/auth.js";
import { client } from "../workers/reditFile.js";
import {
  UniversitiesAndColleges,
  Notification,
  Product,
  Course,
  TransactionMiddleState,
  Deals,
  EmailVerification,
  OperationalInstitutions,
  Exceptions,
  Lectures,
} from "../tableDeclarations.js";
import multer from "multer";
import Tesseract from "tesseract.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
axiosRetry(axios, { retries: 3 });
//import { fromPath } from "pdf2pic";
import mammoth from "mammoth";
import fs from "fs";
import { generateNotificationId } from "../utils/idGenerator.js";
//import { PDFDocument } from "pdf-lib";
//import sharp from "sharp";

// Temporary in-memory store
const verificationCodes = {};

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
function generateUniqueDealId(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
const generateTokens = async (user) => {
  const accessToken = jwt.sign(
    { id: user._id, email: user.email, uid: user.uid },
    process.env.JWT_SECRET,
    { expiresIn: "30m" }, // Short-lived
  );

  const refreshToken = jwt.sign(
    { id: user._id },
    process.env.REFRESH_TOKEN_SECRET, // Separate secret!
    { expiresIn: "30d" }, // Long-lived
  );

  // Save refresh token to DB
  user.refreshTokens.push(refreshToken);
  if (user.refreshTokens.length > 5) {
    user.refreshTokens.shift();
  }
  await user.save();
  return { accessToken, refreshToken };
};

const upload = multer({ dest: "uploads/" });
export default function (User) {
  const router = express.Router();

  router.post("/register", async (req, res) => {
    console.log("Incoming payload:", req.body);

    const { usertype, matriculation_number, staff_id, department, password } =
      req.body;

    try {
      const existingUser = await User.findOne({
        usertype,
        ...(usertype === "student" && { matriculation_number, department }),
        ...(usertype === "lecturer" && { staff_id, department }),
      }).lean();

      if (existingUser) {
        return res.status(409).json({ message: "User already exists." });
      }

      // 🔐 Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // ⚡ Create user
      const newUser = new User({
        ...req.body,
        password: hashedPassword,
        isVerified: true, // email already verified
      });

      await newUser.save();

      // 🔐 Generate JWT
      const { accessToken, refreshToken } = await generateTokens(newUser);

      return res.status(201).json({
        message: "User created successfully",
        email: newUser.email,
        verified: true,
        accessToken,
        refreshToken,
      });
    } catch (error) {
      console.error("❌ Insert failed:", error);

      if (error.code === 11000) {
        return res.status(409).json({
          message: "Duplicate entry: User already exists.",
        });
      }

      return res.status(500).json({
        message: error.message || "Failed to save user",
      });
    }
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { identifier, password, ipAddress, location } = req.body;

    try {
      const user = await User.findOne({ $or: [{ email: identifier }] });
      if (!user) return res.status(404).json({ error: "User not found" });

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(401).json({ error: "Invalid password" });

      const { accessToken, refreshToken } = await generateTokens(user);

      // --- SECURITY CHECK: NEW IP ---
      if (!user.ipAddress.includes(ipAddress)) {
        user.ipAddress.push(ipAddress);
        if (user.isFirstLogin) user.isFirstLogin = false;
        await user.save();
        await createNotification({
          notificationId: generateNotificationId(),
          recipientId: user.uid,
          recipientEmail: user.email,
          category: "auth",
          actionType: "NEW_LOGIN",
          title: "Security Alert: New Login",
          message: `A login was detected from ${ipAddress} in ${location || "an unknown location"}.`,
          payload: {
            userName: user.firstName || "User",
            ipAddress: ipAddress,
            location: location || "Unknown",
          },
          sendEmailFlag: true,
          sendEmail: true,
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        });
      } else if (user.isFirstLogin) {
        user.isFirstLogin = false;
        await user.save();
      }

      const { password: _, ...safeUser } = user.toObject();
      res.status(200).json({
        message: "Login successful",
        user: safeUser,
        accessToken,
        refreshToken,
      });
    } catch (error) {
      res.status(500).json({ error: error.message || "Login error" });
    }
  });
  router.post("/refresh-token", async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(401).json({ message: "Refresh Token Required" });

    try {
      const user = await User.findOne({ refreshTokens: refreshToken });
      if (!user)
        return res.status(403).json({ message: "Invalid Refresh Token" });

      jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET,
        (err, decoded) => {
          if (err) return res.status(403).json({ message: "Token Expired" });

          const newAccessToken = jwt.sign(
            { id: user._id, email: user.email, uid: user.uid },
            process.env.JWT_SECRET,
            { expiresIn: "15m" },
          );

          res.json({ accessToken: newAccessToken });
        },
      );
    } catch (e) {
      res.status(500).json({ message: "Server Error" });
    }
  });
  router.patch("/:uid", async (req, res) => {
    try {
      const updatedUser = await User.findOneAndUpdate(
        { uid: req.params.uid },
        { $set: req.body },
        { new: true },
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
  router.post("/institutions/validate", async (req, res) => {
    try {
      const { schoolName } = req.body;

      if (!schoolName) {
        return res.status(400).json({ message: "School name required" });
      }

      // ✅ Normalize input to avoid regex (faster + index-friendly)
      const normalized = schoolName.trim().toLowerCase();

      // ⚠️ Ensure your DB stores normalizedSchoolName for fast lookup
      const institution = await OperationalInstitutions.findOne({
        schoolName: normalized,
      }).lean(); // ✅ .lean() for faster read

      if (!institution) {
        return res.status(404).json({
          message: "iCampus not yet operational in specified institution",
        });
      }

      return res.status(200).json({
        message: "Institution verified",
        schoolName: institution.schoolName,
        schoolCode: institution.schoolCode,
        verified: true,
      });
    } catch (error) {
      console.error("Institution validation error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/verifyEmail", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email is required" });

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedCode = crypto.createHash("sha256").update(code).digest("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

      await EmailVerification.findOneAndUpdate(
        { email },
        { code: hashedCode, expiresAt },
        { upsert: true, new: true },
      );

      // 🐇 RabbitMQ: Send structured notification job
      const channel = getChannel();
      await channel.assertQueue("emailQueue");

      const notificationJob = {
        notificationId: generateNotificationId(),
        recipientEmail: email,
        category: "security",
        actionType: "EMAIL_VERIFICATION",
        title: "Verify your Email",
        message: `Your verification code is ${code}. It expires in 15 minutes.`,
        payload: { code },
        sendEmail: true,
        sendPush: false, // User likely isn't logged in yet
        saveToDb: false, // Don't save transient OTPs to permanent DB
      };

      channel.sendToQueue(
        "emailQueue",
        Buffer.from(JSON.stringify(notificationJob)),
      );

      return res.status(200).json({
        message: "Verification code sent",
        email,
        codeSent: true,
      });
    } catch (error) {
      console.error("Email verification error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/institutions", async (req, res) => {
    try {
      const { country } = req.query;

      if (!country) {
        return res.status(400).json({
          message: "Country is required",
        });
      }
      const normalizedCountry = country.trim();
      // ✅ Build a cache key based on the country
      const cacheKey = `institutions: ${normalizedCountry}`;
      // 1️⃣ Try to read from Redis cache first
      console.log("PING before GET:", await client.ping());

      try {
        const start = Date.now();
        const cached = await client.get(cacheKey);
        const end = Date.now();

        console.log("Redis GET completed in", end - start, "ms");
        console.log("Redis GET result type:", typeof cached);
        console.log("Redis GET raw value length:", cached?.length || 0);

        if (cached) {
          const data = JSON.parse(cached);
          return res.json({ cached: true, ...data });
        }
      } catch (err) {
        console.error("Redis GET error:", err);
      }

      // -------------------------------
      // GOOGLE PLACES API (COMMENTED OUT)
      // -------------------------------
      /*
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    console.log("Pre fetch");
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=universities+in+${encodeURIComponent(country)}&key=${apiKey}`;
    const response = await axios.get(url);
    console.log("Google raw response:", response.data);
    console.log("Post fetch");

    const institutions = response.data.results.map((item) => ({
      name: item.name,
      address: item.formatted_address,
      place_id: item.place_id,
      rating: item.rating,
      types: item.types,
    }));
    */

      // -------------------------------
      // MONGODB SEARCH (OPTIMIZED)
      // -------------------------------
      const institutions = await UniversitiesAndColleges.find({
        country: normalizedCountry, // ✅ exact match, no regex
      })
        .sort({ name: 1 })
        .lean();
      const responsePayload = {
        count: institutions.length,
        institutions,
      };
      await client.setEx(
        cacheKey,
        3600, // TTL in seconds
        JSON.stringify(responsePayload),
      );
      return res.json(responsePayload);
    } catch (error) {
      console.error("Institutions fetch error:", error.message);
      return res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/verifyEmailCode", emailLimiter, async (req, res) => {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      const record = await EmailVerification.findOne({ email }).lean();

      if (!record) {
        return res
          .status(404)
          .json({ message: "No verification request found" });
      }

      // 🔐 Hash incoming code to compare with stored hash
      const hashedCode = crypto.createHash("sha256").update(code).digest("hex");

      if (record.code !== hashedCode) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      if (record.expiresAt < new Date()) {
        return res
          .status(400)
          .json({ message: "Verification code has expired" });
      }

      return res.status(200).json({
        message: "Email verified successfully",
        verified: true,
      });
    } catch (error) {
      console.error("verifyEmailCode error:", error);
      return res.status(500).json({ message: "Server error" });
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
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const code = generateCode();

      // Store code in your temporary object/Redis
      verificationCodes[email] = {
        code,
        expiresAt: Date.now() + 12 * 60 * 60 * 1000, // 12 hours
      };

      // --- UNIFIED NOTIFICATION ---
      await createNotification({
        notificationId: generateNotificationId(),
        recipientId: user.uid,
        recipientEmail: email,
        category: "security",
        actionType: "PASSWORD_RESET_CODE",
        title: "Password Reset Code",
        message: `Your 6-digit verification code is ${code}. It expires in 12 hours.`,
        payload: {
          code: code,
          userName: user.firstName || "User",
        },
        sendEmail: true, // Critical for password reset
        sendPush: true, // Helpful if they are on their phone
        sendSocket: true,
        saveToDb: false, // Usually, we don't save sensitive codes to the notification DB
      });

      res.status(201).json({
        message: "Verification code sent, check your email",
      });
    } catch (error) {
      console.error("Forgot Password Error:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
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

    // 1. Validation Logic
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

      // 2. Update Password
      const hashedPassword = await bcrypt.hash(password, 10);
      user.password = hashedPassword;

      // Optional security: Clear refresh tokens to force re-login on all devices
      user.refreshTokens = [];
      await user.save();

      // 3. Trigger Omnichannel Notification
      const now = new Date();
      const formattedTime = `${now.toLocaleDateString()} at ${now.toLocaleTimeString()}`;

      await createNotification({
        notificationId: generateNotificationId(),
        recipientId: user.uid,
        recipientEmail: user.email,
        category: "auth",
        actionType: "PASSWORD_CHANGED",
        title: "Password Changed",
        message: `Your password was successfully updated on ${formattedTime}.`,
        payload: {
          userName: user.firstName || "User",
          time: formattedTime,
        },
        sendEmailFlag: true,
        sendEmail: true,
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      });
      // 4. Cleanup
      delete verificationCodes[email];

      res.status(200).json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  router.get("/notifications", async (req, res) => {
    try {
      // 1. Destructure based on what the Frontend is actually sending
      const {
        userId,
        limit = "50",
        offset = "0",
        unread,
        category,
      } = req.query;

      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
      }

      const filter = {
        $or: [{ recipientId: userId }, { isPublic: true }],
      };

      // 3. Match Frontend: url += '&unread=true'
      if (unread === "true") {
        filter.isRead = false;
      }

      // 4. Match Frontend: url += '&category=finance'
      if (category) {
        filter.category = category;
      }

      const notifications = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(Math.max(parseInt(offset), 0))
        .limit(Math.max(parseInt(limit), 1));

      res.status(200).json({ notifications });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  // GET a single notification by ID
  router.get("/notifications/:id", async (req, res) => {
    try {
      const { id } = req.params;

      // 1. Search using both ID types for maximum compatibility
      const notification = await Notification.findOne({
        $or: [{ notificationId: id }],
      });

      // 2. Error handling if not found
      if (!notification) {
        return res.status(404).json({
          message: "Notification not found",
          notification: null,
        });
      }

      // 3. Optional: Automatically mark as read when viewed in detail
      if (!notification.isRead) {
        notification.isRead = true;
        await notification.save();
      }

      // 4. Return the data in the structure your frontend expects (data.notification)
      res.status(200).json({
        notification,
      });
    } catch (error) {
      console.error("Error fetching single notification:", error);
      res
        .status(500)
        .json({ message: "Server error fetching notification details" });
    }
  });
  // router.js
  router.patch("/notifications/mark-all-read/:userId", async (req, res) => {
    try {
      const { userId } = req.params;

      // Update all notifications where recipientId matches and isRead is false
      const result = await Notification.updateMany(
        {
          $or: [{ recipientId: userId }],
          isRead: false,
        },
        { $set: { isRead: true } },
      );

      res.status(200).json({
        message: "All notifications marked as read",
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error("Error marking all as read:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  router.patch("/notifications/:id/read", async (req, res) => {
    try {
      const { id } = req.params;
      const notification = await Notification.findOneAndUpdate(
        {
          $or: [{ notificationId: id }],
        },
        { isRead: true },
        { new: true },
      );

      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }

      res
        .status(200)
        .json({ message: "Notification marked as read", notification });
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
        { new: true },
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
  //
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
                  `${filePath}[0] → ${outputFile}`,
                );
                gm(`${filePath}[0]`)
                  .in("-density", "300")
                  .resize(2000, 2000)
                  .write(outputFile, (err) => {
                    if (err) {
                      console.error(
                        "ImageMagick conversion failed:",
                        err.message,
                      );
                      return reject(
                        new Error("PDF conversion failed — PNG not created"),
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
          extractedText.match(firstSemTotalRegex)?.[1] || "0",
        );
        const sessionUnits = parseInt(
          extractedText.match(sessionTotalRegex)?.[1] || "0",
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
          sessionUnits,
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
    },
  );

  router.post(
    "/transactions/complete/:transactionId",
    authenticate,
    async (req, res) => {
      try {
        const { transactionId } = req.params;
        const { uid } = req.body;

        const transaction = await TransactionMiddleState.findOne({
          transactionId,
          sellerId: uid,
        });

        if (!transaction) {
          return res
            .status(404)
            .json({ message: "Transaction not found for this seller" });
        }

        const now = new Date();
        const createdAt = new Date(transaction.createdAt);
        const hoursDiff = (now - createdAt) / (1000 * 60 * 60);

        if (hoursDiff > 96) {
          transaction.status = "rejected";
          await transaction.save();
          return res
            .status(400)
            .json({ message: "Transaction expired after 96 hours" });
        }

        const seller = await User.findOne({ uid });
        const buyer = await User.findOne({ uid: transaction.buyerId });
        if (!seller)
          return res.status(404).json({ message: "Seller not found" });
        if (!buyer) return res.status(404).json({ message: "Buyer not found" });

        const transactionsTotalPriceInPoints = transaction.priceInPoints;
        seller.pointsBalance += transactionsTotalPriceInPoints;
        await seller.save();

        transaction.status = "completed";
        await transaction.save();

        const productIds = transaction.productIdArrays;
        const products = await Product.find({ productId: { $in: productIds } });

        const productTitles = products.map((p) => p.title).join(", ");
        const dealItems = products.map((p) => ({
          productId: p.productId,
          productTitle: p.title,
          priceInPoints: p.priceInPoints,
        }));

        // Create Deal
        const dealId = generateUniqueDealId();
        await Deals.create({
          dealId,
          sellerId: transaction.sellerId,
          buyerId: transaction.buyerId,
          totalPriceInPoints: transactionsTotalPriceInPoints,
          dealStatus: "completed",
          items: dealItems,
          dealDate: new Date(),
        });

        // Push dealId to both users
        await User.updateOne(
          { uid: transaction.sellerId },
          { $push: { deals: dealId } },
        );
        await User.updateOne(
          { uid: transaction.buyerId },
          { $push: { deals: dealId } },
        );

        // Notify Seller
        const sellerMessage = `Purchase of your products: ${productTitles} has been successfully completed. A total of ${transactionsTotalPriceInPoints} points has been added to your balance.`;
        await Notification.create({
          userId: uid,
          notificationId: generateNotificationId(),
          title: "Successful Purchase Payment",
          message: sellerMessage,
          isPublic: false,
          isRead: false,
          createdAt: new Date(),
          type: "transactions",
          status: "success",
        });

        // Notify Buyer
        const buyerMessage = `Thanks for your purchase! We'd love your feedback on these products: ${productTitles}. Tap below to rate your experience.`;
        await Notification.create({
          userId: buyer.uid,
          notificationId: generateNotificationId(),
          title: "Rate Your Purchase",
          message: buyerMessage,
          isPublic: false,
          isRead: false,
          createdAt: new Date(),
          type: "rate",
        });

        //Delete the transaction mid state
        await TransactionMiddleState.deleteOne({ transactionId });
        await addUserRecord(
          uid,
          "transaction",
          "completed",
          `Transaction ${transactionId} completed. Products: ${productTitles}. Points received: ${transactionsTotalPriceInPoints}`,
        );
        await addUserRecord(
          buyer.uid,
          "transaction",
          "completed",
          `Transaction ${transactionId} completed. Products: ${productTitles} worth ${transactionsTotalPriceInPoints} points.`,
        );
        res.status(200).json({
          message: "Transaction completed and points transferred",
          productIdArrays: productIds,
          transactionsTotalPriceInPoints,
        });
      } catch (error) {
        console.error("Error completing transaction:", error);
        res.status(500).json({ message: "Server error" });
      }
    },
  );
  router.get("/exceptions/course/:courseId", authenticate, async (req, res) => {
    try {
      const { courseId } = req.params;
      const exceptions = await Exceptions.find({ courseId }).sort({ date: -1 });

      res.status(200).json(exceptions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch course exceptions" });
    }
  });
  router.get("/categories", async (req, res) => {
    try {
      const uniqueCategories = await Course.distinct("niche", {
        isPublished: true,
      });

      // 2. Filter out any null or empty strings and sort alphabetically
      const filteredCategories = uniqueCategories
        .filter((cat) => !!cat)
        .sort((a, b) => a.localeCompare(b));

      res.status(200).json(filteredCategories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Server error fetching niches" });
    }
  });
  router.post("/verify-payment", async (req, res) => {
    const { transaction_id, courseId, userId } = req.body;

    try {
      // 1. Call Flutterwave to verify the transaction
      const response = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_CLIENT_SECRET}`,
          },
        },
      );

      const { status, amount, currency, customer } = response.data.data;

      // 2. Check if payment is successful and matches your expected amount
      if (status === "successful") {
        // 3. Update the User's enrolledCourses in MongoDB
        await User.findOneAndUpdate(
          { uid: userId },
          { $addToSet: { coursesEnrolled: courseId } },
        );

        res.status(200).json({ message: "Course unlocked successfully!" });
      } else {
        res.status(400).json({ message: "Payment verification failed" });
      }
    } catch (error) {
      res
        .status(500)
        .json({ message: "Internal server error during verification" });
    }
  });
  router.get("/courses/:courseId", authenticate, async (req, res) => {
    try {
      const { courseId } = req.params;
      const course = await Course.findOne({ courseId: courseId })
        .populate(
          "lecturerIds studentsEnrolled",
          "firstname lastname profilePic",
        )
        .exec();

      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      res.status(200).json(course);
    } catch (error) {
      console.error("Fetch Course Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  router.get(
    "/courses/:courseId/assignments",
    authenticate,
    async (req, res) => {
      try {
        const course = await Course.findOne(
          { courseId: req.params.courseId },
          "assignments",
        );
        if (!course)
          return res.status(404).json({ message: "Course not found" });

        res.status(200).json(course.assignments);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    },
  );
  router.get("/exceptions", authenticate, async (req, res) => {
    try {
      const { courseId } = req.query;
      const userId = req.user.uid;
      const userRole = req.user.usertype;

      if (!courseId) {
        return res.status(400).json({ message: "courseId is required" });
      }
      let query = { courseId };
      if (userRole === "student") {
        query.studentId = userId;
      } else if (userRole === "lecturer") {
        const course = await Course.findOne({
          courseId: courseId,
          lecturerIds: userId,
        });

        if (!course) {
          return res.status(403).json({
            success: false,
            message: "Access denied. You do not teach this course.",
          });
        }
      } else {
        return res.status(403).json({ message: "Unauthorized user type" });
      }
      const exceptions = await Exceptions.find(query)
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({
        success: true,
        count: exceptions.length,
        exceptions,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  // GET /api/lectures/:lectureId
  router.get("/courses/lectures/:lectureId", async (req, res) => {
    try {
      const { lectureId } = req.params;
      const lecture = await Lectures.findOne({ id: lectureId });
      if (!lecture) {
        return res.status(404).json({ error: "Lectures session not found" });
      }
      const now = new Date();
      const startTime = new Date(lecture.startTime);

      if (lecture.status === "scheduled" && now >= startTime) {
        lecture.status = "ongoing";
        await lecture.save();
      }

      res.json(lecture);
    } catch (err) {
      console.error("Fetch lecture error:", err);
      res
        .status(500)
        .json({ error: "Server error while fetching lecture details" });
    }
  });

  return router;
}
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js

//On powershell as admin: Start-Service RabbitMQ
