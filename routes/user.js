import express from "express";
import bcrypt from "bcrypt";
import axiosRetry from "axios-retry";
//import crypto from "crypto";
import axios from "axios";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import { authenticate, loginLimiter, addUserRecord } from "../index.js";
import {
  UniversitiesAndColleges,
  Notification,
  Product,
  Course,
  TransactionMiddleState,
  Deals,
  EmailVerification,
  OperationalInstitutions,
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
//import { PDFDocument } from "pdf-lib";
//import sharp from "sharp";

// Temporary in-memory store
const verificationCodes = {};
export const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.TRANSPORTER_AUTH_USER,
    pass: process.env.TRANSPORTER_AUTH_PASS,
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
function generateUniqueDealId(length = 10) {
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

  router.post("/register", async (req, res) => {
    console.log("Incoming payload:", req.body);
    const {
      usertype,
      matriculation_number,
      staff_id,
      department,
      password,
      email,
    } = req.body;
    try {
      // Check if user already exists
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
          message: "User already exists.",
        });
      }
      console.log("🧪 Attempting insert...");
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      // Create user
      const newUser = new User({
        ...req.body,
        password: hashedPassword,
        isVerified: true,
        // Email already verified before this step
      });
      await newUser.save();
      // Generate JWT token
      const token = jwt.sign(
        {
          id: newUser._id,
          email: newUser.email,
          uid: newUser.uid,
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "10h",
        },
      );
      console.log("JWT token generated:", token);
      // Response to frontend
      return res.status(201).json({
        message: "User created successfully",
        email: newUser.email,
        verified: true,
        token,
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
        { expiresIn: "10h" },
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
      const institution = await OperationalInstitutions.findOne({
        schoolName: { $regex: schoolName, $options: "i" },
      });
      if (!institution) {
        console.log("Not found...");
        return res.status(404).json({
          message: "iCampus not yet operational in specified institution",
        });
      }
      console.log("Completed...");
      res.status(200).json({
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
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      // Generate a secure 6‑digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      // Set expiry time (1 hour)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      // Save or update existing verification entry
      await EmailVerification.findOneAndUpdate(
        { email },
        { code, expiresAt },
        { upsert: true, new: true },
      );
      // Send email
      await transporter.sendMail({
        from: '"iCampus" <admin@uniquetechcontentwriter.com>',
        to: email,
        subject: "Verify Your Account",
        html: ` 
            <h1>Welcome to iCampus!</h1> 
            <p>Enter the 6‑digit code below to verify your email account:</p> 
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 20px 0; ">
              ${code} 
            </div> 
            <p>This code will expire in 60 minutes.</p> 
          `,
      });
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
      // MONGODB SEARCH INSTEAD
      // -------------------------------

      const institutions = await UniversitiesAndColleges.find({
        country: { $regex: country, $options: "i" },
      }).sort({ name: 1 });

      res.json({
        count: institutions.length,
        institutions,
      });
    } catch (error) {
      console.error("Institutions fetch error:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/verifyEmailCode", async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email && !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }
      const record = await EmailVerification.findOne({ email });
      if (!record) {
        return res
          .status(404)
          .json({ message: "No verification request found" });
      }
      if (record.code !== code) {
        return res.status(400).json({ message: "Invalid verification code" });
      }
      if (record.expiresAt < new Date()) {
        return res
          .status(400)
          .json({ message: "Verification code has expired" });
      }
      // Optional: delete record after successful verification
      //await EmailVerification.deleteOne({ email });
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
            (entry) => entry.id === notification.purchaseId,
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

  return router;
}
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js
