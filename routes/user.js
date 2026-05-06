import "../workers/reditFile.js";
import express from "express";
import bcrypt from "bcrypt";
import axiosRetry from "axios-retry";
import crypto from "crypto";
import { getChannel } from "../rabbitmq.js";
import axios from "axios";
import jwt from "jsonwebtoken";
import { createNotification } from "../services/notificationService.js";
import { getFallbackBooks } from "../utils/libraryHelpers.js";
import { generateExpiryDate } from "../utils/dateHelper.js";
import { authLimiter, addUserRecord, protect } from "../middleware/auth.js";
import { client } from "../workers/reditFile.js";
import {
  Posts,
  UserBankOrCardDetails,
  DeletedUser,
  userPrefs,
  UniversitiesAndColleges,
  Notification,
  ITag,
  Product,
  Course,
  TransactionMiddleState,
  Deals,
  EmailVerification,
  OperationalInstitutions,
  Exceptions,
  iTag,
  Lectures,
  Follow,
} from "../tableDeclarations.js";
import geoip from "geoip-lite";
axiosRetry(axios, { retries: 3 });
import {
  generateNotificationId,
  generateUniqueCardNumber,
  generateUserUID,
  generateUniqueDealId,
  generateTokens,
  generateCode,
  generateUniqueReferralCode,
} from "../utils/idGenerator.js";
import * as cheerio from "cheerio";
import {
  verifyGoogleToken,
  verifyGithubToken,
} from "../api/foreignFetchApis.js";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
      itagusername,
      firstname,
      lastname,
      deviceId,
      deviceName,
      providerId,
    } = req.body;
    try {
      const existingUser = await User.findOne({
        usertype,
        ...(usertype === "student" && { matriculation_number, department }),
        ...(usertype === "lecturer" && { staff_id, department }),
      }).lean();

      if (existingUser) {
        return res
          .status(409)
          .json({ message: "User already exists.", success: false });
      }
      const uid = generateUserUID();
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      const geo = geoip.lookup(ip);
      const location = geo ? `${geo.city}, ${geo.country}` : "Unknown Location";

      // 🔐 Hash password
      let hashedPassword = null;
      if (password && password !== "SOCIAL_AUTH") {
        hashedPassword = await bcrypt.hash(password, 10);
      }

      // ⚡ Create user
      const newUser = new User({
        uid,
        ...req.body,
        referralCode: await generateUniqueReferralCode(req.body),
        password: hashedPassword,
        isVerified:
          usertype === "student" || usertype === "lecturer" || providerId
            ? true
            : false,
        providerId: providerId || "",
        sessions: [],
      });
      const iSCardEligible =
        usertype === "student" ||
        usertype === "lecturer" ||
        usertype === "otherUser";
      if (iSCardEligible) {
        const newCardNumber = await generateUniqueCardNumber();
        const expiryDate = await generateExpiryDate();
        const newITag = new iTag({
          userId: uid,
          username: itagusername,
          cardHolderName: `${firstname} ${lastname}`,
          cardNumber: newCardNumber,
          tier: "free",
          expiryDate,
        });
        await newITag.save();
      }
      // 🔐 Generate JWT
      const { accessToken, refreshToken } = await generateTokens(newUser);
      const initialSession = {
        deviceId,
        deviceName,
        ipAddress: ip,
        location,
        refreshToken,
        lastUsed: new Date(),
      };
      newUser.sessions.push(initialSession);
      await newUser.save();
      const { password: _, iCashPin: _, ...safeUser } = newUser.toObject();

      return res.status(201).json({
        message: "User created successfully",
        success: true,
        user: safeUser,
        accessToken,
        refreshToken,
      });
    } catch (error) {
      console.error("❌ Insert failed:", error);

      if (error.code === 11000) {
        return res.status(409).json({
          message: "Duplicate entry: User already exists.",
          success: false,
        });
      }

      return res.status(500).json({
        message: error.message || "Failed to save user",
        success: false,
      });
    }
  });

  router.post("/login", authLimiter, async (req, res) => {
    const {
      identifier,
      password,
      deviceId,
      deviceName,
      socialProvider,
      idToken,
    } = req.body.credentials || req.body;

    try {
      const user = await User.findOne({ email: identifier });
      if (!user) return res.status(404).json({ error: "User not found" });
      if (socialProvider === "google") {
        const isValid = await verifyGoogleToken(idToken, identifier);
        if (!isValid)
          return res.status(401).json({ error: "Invalid Google token" });
      } else if (socialProvider === "github") {
        const isValid = await verifyGithubToken(idToken, identifier);
        if (!isValid)
          return res.status(401).json({ error: "Invalid GitHub token" });
      } else {
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch)
          return res.status(401).json({ error: "Invalid password" });
      }
      const { accessToken, refreshToken } = await generateTokens(user);
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      const geo = geoip.lookup(ip);
      const location = geo ? `${geo.city}, ${geo.country}` : "Unknown Location";

      const sessionData = {
        deviceId,
        deviceName,
        ipAddress: ip,
        location,
        refreshToken,
        lastUsed: new Date(),
      };

      // 4. Update Session List
      const existingSessionIndex = user.sessions.findIndex(
        (s) => s.deviceId === deviceId,
      );

      if (existingSessionIndex > -1) {
        user.sessions[existingSessionIndex] = sessionData;
      } else {
        user.sessions.push(sessionData);
        await createNotification({
          recipientId: user.uid,
          recipientEmail: user.email,
          category: "auth",
          actionType: "NEW_LOGIN",
          title: "Security Alert: New Login",
          message: `A login was detected from ${ip} in ${location}.`,
          sendEmail: true,
          saveToDb: true,
        });
      }
      await user.save();
      const {
        password: _,
        iCashPin: _,
        userAccountDetails: _,
        ...safeUser
      } = user.toObject();
      res.status(200).json({
        message: "Login successful",
        user: safeUser,
        accessToken,
        refreshToken,
      });
    } catch (error) {
      console.error("Login Error:", error);
      res.status(500).json({ error: error.message || "Login error" });
    }
  });
  router.post("/revoke-session", protect, async (req, res) => {
    const userId = req.user.id;
    const { deviceIdToRevoke } = req.body;

    try {
      const user = await User.findOne({ uid: userId });
      if (!user) return res.status(404).json({ error: "User not found" });

      // Filter out the session with the matching deviceId
      const originalLength = user.sessions.length;
      user.sessions = user.sessions.filter(
        (s) => s.deviceId !== deviceIdToRevoke,
      );

      if (user.sessions.length === originalLength) {
        return res.status(404).json({ error: "Session not found" });
      }

      await user.save();
      res.status(200).json({ message: "Device logged out successfully" });
    } catch (error) {
      res.status(500).json({ error: "Could not revoke session" });
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
            { id: user.uid, email: user.email },
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
  //
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
      const cacheKey = `institutions: ${normalizedCountry}`;
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
        country: normalizedCountry,
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

  router.post("/verifyEmailCode", authLimiter, async (req, res) => {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }
      const hashedCode = crypto.createHash("sha256").update(code).digest("hex");

      const record = await EmailVerification.findOneAndDelete({
        email,
        code: hashedCode,
        expiresAt: { $gt: new Date() },
      });

      if (!record) {
        return res
          .status(404)
          .json({ message: "No verification request found", verified: false });
      }

      if (record.code !== hashedCode) {
        return res
          .status(400)
          .json({ message: "Invalid verification code", verified: false });
      }

      if (record.expiresAt < new Date()) {
        return res
          .status(400)
          .json({ message: "Verification code has expired", verified: false });
      }

      return res.status(200).json({
        message: "Email verified successfully",
        verified: true,
        email,
      });
    } catch (error) {
      console.error("verifyEmailCode error:", error);
      return res.status(500).json({ message: "Server error", verified: false });
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
      const existingRecord = await EmailVerification.findOne({ email });
      if (existingRecord) {
        const timeSinceLastSent = Date.now() - (existingRecord.updatedAt || 0);
        if (timeSinceLastSent < 60000) {
          // 60 second cooldown
          return res.status(429).json({
            message: "Please wait before requesting another code.",
          });
        }
      }
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedCode = crypto.createHash("sha256").update(code).digest("hex");
      const durationMs = 60 * 60 * 1000; //1 hr
      const expiresAt = new Date(Date.now() + durationMs);
      const readableExpires = expiresAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      await EmailVerification.findOneAndUpdate(
        { email },
        { code: hashedCode, expiresAt },
        { upsert: true, new: true },
      );
      // --- UNIFIED NOTIFICATION ---
      await createNotification({
        notificationId: generateNotificationId(),
        recipientId: user.uid,
        recipientEmail: email,
        category: "security",
        actionType: "PASSWORD_RESET_CODE",
        title: "Password Reset Code",
        message: `Your 6-digit verification code is ${code}. It expires in ${readableExpires}.`,
        payload: {
          code: code,
          userName: user.firstName || "User",
          expiryTime: readableExpires,
        },
        sendEmail: true, // Critical for password reset
        sendPush: true,
        sendSocket: true,
        saveToDb: false,
      });
      res.status(200).json({
        message: "Verification code sent, check your email",
        email,
      });
    } catch (error) {
      console.error("Forgot Password Error:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
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
  router.post(
    "/transactions/complete/:transactionId",
    protect,
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
  router.get("/exceptions/course/:courseId", protect, async (req, res) => {
    try {
      const { courseId } = req.params;
      const exceptions = await Exceptions.find({ courseId }).sort({ date: -1 });
      res.status(200).json(exceptions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch course exceptions" });
    }
  });
  router.get("/exceptions/lectures/:lectureId", protect, async (req, res) => {
    try {
      const { lectureId } = req.params;
      const exceptions = await Exceptions.find({ lectureId }).sort({
        date: -1,
      });
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
  router.get("/courses/:courseId", protect, async (req, res) => {
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
  //Fetch course details only if user is enrolled
  router.get("/courses/:courseId", protect, async (req, res) => {
    try {
      const { courseId } = req.params;
      const userId = req.user.uid;
      const course = await Course.findOne({
        courseId: courseId,
        studentsEnrolled: userId,
      });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: "Course not found or you are not enrolled in this course.",
        });
      }
      return res.status(200).json({
        success: true,
        data: course,
      });
    } catch (error) {
      console.error(`Error fetching course ${req.params.courseId}:`, error);
      return res.status(500).json({
        success: false,
        message: "Server error while fetching course details.",
        error: error.message,
      });
    }
  });
  router.get("/courses/:courseId/assignments", protect, async (req, res) => {
    try {
      const course = await Course.findOne(
        { courseId: req.params.courseId },
        "assignments",
      );
      if (!course) return res.status(404).json({ message: "Course not found" });

      res.status(200).json(course.assignments);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  router.get("/exceptions", protect, async (req, res) => {
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
  // router.get('/users/:uid', ...)
  router.get("/:uid", async (req, res) => {
    try {
      const { uid } = req.params;
      const user = await User.findOne({ uid: uid })
        .select("uid firstname lastname email profilePic")
        .lean();

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json(user);
    } catch (error) {
      console.error("iCampus DB Error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  // Check if user has an ongoing lecture
  router.get("/lectures/ongoing/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const ongoingLecture = await Lectures.findOne({
        status: "ongoing",
        courseId: {
          $in: await Course.find({ studentsEnrolled: userId }).distinct(
            "courseId",
          ),
        },
      }).populate("courseId"); // Optional: get course details like title

      if (ongoingLecture) {
        return res.status(200).json({
          ongoing: true,
          lecture: ongoingLecture,
        });
      }

      res.status(200).json({ ongoing: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  // GET /api/lectures/:lectureId (Fetch lectures using videoUrl)
  router.get("/lectures/details", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ message: "URL parameter is required" });
      }
      const lecture = await Lectures.findOne({ videoUrl: url });
      if (!lecture) {
        return res.status(404).json({ message: "Lecture not found" });
      }
      res.status(200).json(lecture);
    } catch (error) {
      console.error("Backend Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  router.post("/ai/chat", async (req, res) => {
    const { message, context, history, userId } = req.body;
    const { appMetadata } = context;
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const appRules = `
        Here is your App Knowledge Base:
        - iScore: Academic ranking (Higher = better performance).
        - iCash: Campus P2P wallet. Transfers use @iTags.
        - Enrollment: Users must register courses in the 'Academic' tab.
        - Support: If a bug is reported, tell them to upload a screenshot.
      `;
      let contextString = `You are iAssistant, the official support agent and also academic AI for iCampus.
        If a user asks an app-related question, use ${appRules} knowledge to answer.
        User Status: ${appMetadata.tier} user, ${appMetadata.isVerified ? "Verified" : "Unverified"}.
        Current Context: ${context.type}.
        Role: ${appMetadata.usertype}.\n`;

      if (context.type === "course") {
        contextString += `Course: ${context.data.courseTitle} (${context.data.courseCode}). 
        Dept: ${context.data.department}.`;
      } else if (context.type === "lecture") {
        contextString += `Lecture: ${context.data.topicName}. Type: ${context.data.lectureType}. 
        Location: ${context.data.location}.`;
      }
      if (
        message.toLowerCase().includes("issue") ||
        message.toLowerCase().includes("can't")
      ) {
        contextString += `The user is reporting an issue. Use the User Status to explain why they might be seeing errors (e.g., if they are 'free' tier, they might not have access to certain features).`;
      }
      const chat = model.startChat({
        history: [
          { role: "user", parts: [{ text: contextString + " Understood?" }] },
          {
            role: "model",
            parts: [
              {
                text: "Understood. I am ready to assist with this specific context.",
              },
            ],
          },
          ...history,
        ],
      });
      const result = await chat.sendMessage(message);
      const response = result.response;
      if (userId) {
        await User.findOneAndUpdate(
          { uid: userId, usertype: { $in: ["student", "lecturer"] } },
          { $inc: { "monthlyStats.aiQueries": 1 } },
        );
      }

      res.json({ reply: response.text() });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch AI response" });
    }
  });
  router.get("/me", protect, async (req, res) => {
    try {
      const user = await User.findOne({ uid: req.user.uid });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json({
        success: true,
        user: {
          uid: user.uid,
          isSuspended: user.isSuspended,
        },
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });
  //Library routes
  router.get("/library/search", async (req, res) => {
    const { q, userId } = req.query;
    const searchUrl = `https://1lib.sk/s/${encodeURIComponent(q)}`;
    try {
      if (userId) {
        const today = new Date();
        const user = await User.findOne({ uid: userId });
        const lastAccess = user.monthlyStats.lastLibraryAccess;
        const isNewSession =
          !lastAccess || today - new Date(lastAccess) > 1000 * 60 * 60;
        await User.findOneAndUpdate(
          { uid: userId },
          {
            $inc: {
              "monthlyStats.libraryUsageSessions": isNewSession ? 1 : 0,
              "monthlyStats.booksFound": 1,
            },
            $set: { "monthlyStats.lastLibraryAccess": today },
          },
        );
      }
      const { data } = await axios.get(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        },
      });

      const $ = cheerio.load(data);
      const books = [];

      // 1lib.sk specific selectors
      $(".resItemBox").each((index, element) => {
        const row = $(element);

        // Extracting metadata
        const title = row.find('h3[itemprop="name"] a').text().trim();
        const author = row.find(".authors a").text().trim() || "Unknown Author";
        const thumbnail =
          row.find(".cover").attr("data-src") || row.find(".cover").attr("src");
        const detailsUrl = row.find('h3[itemprop="name"] a').attr("href");

        // Filesize and Extension are usually inside .property_value or property_size
        const extension = row.find(".property_value").first().text().trim();
        const size = row.find(".property_size").text().trim();
        const year = row.find(".property_year").text().trim();

        if (title) {
          books.push({
            id: detailsUrl?.split("/").pop() || Math.random().toString(),
            title,
            author,
            thumbnail: thumbnail?.startsWith("http")
              ? thumbnail
              : `https://1lib.sk${thumbnail}`,
            extension: extension || "PDF",
            size: size || "N/A",
            year: year || "N/A",
            downloadUrl: `https://1lib.sk${detailsUrl}`,
          });
        }
      });

      res.json(books);
    } catch (error) {
      console.error("Scraping Error:", error.message);
      res.status(500).json({ error: "Failed to connect to the library" });
    }
  });

  // GET /library/featured
  router.get("/library/featured", async (req, res) => {
    try {
      const rawDept = req.query.department;
      const department =
        rawDept && rawDept.trim().length > 0 ? rawDept.trim() : null;
      const BASE_URL = "https://1lib.sk";
      let targetUrl = department
        ? `${BASE_URL}/s/${encodeURIComponent(department)}`
        : `${BASE_URL}/popular.php`;

      const { data } = await axios.get(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        },
        timeout: 5000,
      });

      const $ = cheerio.load(data);
      const featuredBooks = [];

      $(".bookDetailsBox, .resItemBox").each((index, element) => {
        if (index >= 12) return;

        const row = $(element);
        const title = row.find('h3[itemprop="name"] a, .title a').text().trim();
        const author =
          row.find(".authors a, .author").first().text().trim() ||
          "Various Authors";

        // Selectors can vary; check both common locations for images
        const thumbnail =
          row.find("img.cover").attr("data-src") ||
          row.find("img.cover").attr("src") ||
          row.find(".bookCover img").attr("src");

        const detailsUrl = row.find('a[href^="/book/"]').attr("href");

        // Metadata extraction
        const extension =
          row.find(".property_value").first().text().trim() || "PDF";
        const size = row.find(".property_size").text().trim() || "N/A";
        const year = row.find(".property_year").text().trim() || "N/A";

        if (title && detailsUrl) {
          featuredBooks.push({
            id: detailsUrl.split("/").pop(),
            title,
            author,
            thumbnail: thumbnail?.startsWith("http")
              ? thumbnail
              : `${BASE_URL}${thumbnail}`,
            extension: extension.toUpperCase(),
            size,
            year,
            downloadUrl: `${BASE_URL}${detailsUrl}`,
          });
        }
      });

      if (featuredBooks.length === 0) {
        return res.json(getFallbackBooks());
      }

      res.json(featuredBooks);
    } catch (error) {
      console.error("Featured Scrape Error:", error.message);
      res.json(getFallbackBooks());
    }
  });
  // GET /leaderboard
  router.get("/fetchLeaderBoards", async (req, res) => {
    try {
      // 1. Top 10 Students
      const topStudents = await User.find({ usertype: "student" })
        .sort({ currentIScore: -1 })
        .limit(10)
        .select(
          "uid firstname lastname currentIScore email previousIScore profilePic department schoolName",
        );

      // 2. Top 10 Instructors (Lecturers + OtherUsers with high reviews)
      const topInstructors = await User.find({
        usertype: { $in: ["lecturer", "otherUser"] },
      })
        .sort({ currentIScore: -1, "monthlyStats.avgReview": -1 })
        .limit(10)
        .select(
          "uid firstname lastname currentIScore email profilePic jobTitle previousIScore",
        );

      // 3. Top 10 Institutions
      const topInstitutions = await OperationalInstitutions.find()
        .sort({ currentiScoreAvg: -1 })
        .limit(10);

      res.status(200).json({
        success: true,
        data: {
          students: topStudents,
          instructors: topInstructors,
          institutions: topInstitutions,
        },
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  // Ranking screen search / User detail fetch
  router.get("/search", protect, async (req, res) => {
    const { q, uid, viewerRole, viewerTier } = req.query;
    try {
      let users;

      if (uid) {
        const user = await User.findOne({ uid });
        users = user ? [user] : [];
      } else if (q) {
        users = await User.find({
          $or: [
            { firstname: { $regex: q, $options: "i" } },
            { lastname: { $regex: q, $options: "i" } },
            { username: { $regex: q, $options: "i" } },
          ],
        }).limit(20);
      } else {
        return res
          .status(400)
          .json({ success: false, message: "Query or UID required" });
      }

      const safeResults = users.map((u) => {
        const isPro = viewerTier === "pro" || viewerTier === "premium";
        const isEnterprise = viewerRole === "enterprise";

        return {
          uid: u.uid,
          firstname: u.firstname,
          username: u.username,
          lastname: u.lastname,
          profilePic: u.profilePic,
          usertype: u.usertype,
          tier: u.tier,
          isVerified: u.isVerified,
          organizationName: u.organizationName || "",
          displayScore:
            isEnterprise || isPro ? Math.round(u.currentIScore) : "Locked",
        };
      });

      res.json({ success: true, data: uid ? safeResults[0] : safeResults });
    } catch (error) {
      res.status(500).json({ message: error.message, success: false });
    }
  });
  //Profile screen search
  router.get("/profile/search:identifier", protect, async (req, res) => {
    try {
      const { identifier } = req.params;
      const { viewerUid, viewerTier, viewerRole, viewerFirstname } = req.query;

      // 1. Fetch the Target User
      const targetUser = await User.findOne({
        $or: [
          { uid: identifier },
          { username: identifier },
          { firstname: identifier },
          { lastname: identifier },
        ],
      })
        .select("-password -refreshTokens -iCashPin")
        .lean();
      if (!targetUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      const viewer = await User.findOne({ uid: viewerUid })
        .select("blockedUsers")
        .lean();

      const isBlockedByViewer = (viewer?.blockedUsers || []).includes(
        targetUser.uid,
      );
      const isViewerBlockedByTarget = (targetUser.blockedUsers || []).includes(
        viewerUid,
      );
      if (isBlockedByViewer || isViewerBlockedByTarget) {
        return res.status(403).json({
          success: false,
          message:
            "User not found or you have restricted access to this profile.",
          isBlocked: true,
          targetUid: targetUser.uid,
        });
      }
      // 2. Parallel aggregation for all profile sections
      const [
        followersList,
        followingList,
        isFollowing,
        courses,
        userPosts,
        iTagData,
        bookmarkedPosts,
      ] = await Promise.all([
        // Fetch Followers details (populating from User identity)
        Follow.find({ followingId: targetUser.uid })
          .select("followerId")
          .lean(),

        // Fetch Following details
        Follow.find({ followerId: targetUser.uid })
          .select("followingId")
          .lean(),

        // Check if viewer follows target
        Follow.findOne({ followerId: viewerUid, followingId: targetUser.uid }),

        // Fetch Courses (Academic/Professional)
        targetUser.usertype === "lecturer" ||
        targetUser.usertype === "otherUser"
          ? Course.find({ lecturerIds: targetUser.uid })
              .select(
                "courseTitle courseCode thumbnailUrl session semester isActive description rating studentsEnrolled price",
              )
              .lean()
          : null,

        Post.find({
          $or: [{ "userId.uid": uid }, { originalAuthor: uid }],
        })
          .sort({ createdAt: -1 })
          .lean(),
        // Fetch iTag details
        ITag.findOne({ userId: targetUser.uid }).lean(),
        Post.find({ postId: { $in: targetUser.bookmarks || [] } })
          .sort({ createdAt: -1 })
          .lean(),
      ]);

      // 3. Post-Aggregation Processing

      // Format Courses: Calculate enrollment count
      const formattedCourses = courses
        ? courses.map((course) => ({
            ...course,
            enrolledCount: course.studentsEnrolled
              ? course.studentsEnrolled.length
              : 0,
            studentsEnrolled: undefined, // Hide raw ID array
          }))
        : [];

      // Fetch Full Identity for Followers/Following
      // We do this via IDs to ensure we get the latest profile pics/tiers
      const followerIds = followersList.map((f) => f.followerId);
      const followingIds = followingList.map((f) => f.followingId);

      const [followerDetails, followingDetails] = await Promise.all([
        User.find({ uid: { $in: followerIds } })
          .select(
            "firstname lastname username profilePic tier isVerified usertype organizationName",
          )
          .lean(),
        User.find({ uid: { $in: followingIds } })
          .select(
            "firstname lastname username profilePic tier isVerified usertype organizationName",
          )
          .lean(),
      ]);

      // 4. Privacy & Notification Logic
      const isOwner = viewerUid === targetUser.uid;
      const isPremiumViewer = viewerTier === "premium";

      if (!isOwner && !isPremiumViewer) {
        createNotification({
          notificationId: generateNotificationId(),
          recipientId: targetUser.uid,
          category: "social",
          actionType: "PROFILE_VIEW",
          title: "Profile View",
          message: `${viewerFirstname || "Someone"} viewed your profile`,
          payload: { viewerUid, userName: viewerFirstname },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        }).catch((err) => console.error("Notification Error:", err));
      }

      const canSeeScore =
        isOwner || viewerRole === "enterprise" || viewerTier !== "free";
      const profileData = {
        ...targetUser,
        currentIScore: canSeeScore ? targetUser.currentIScore : "Locked",
        followersList: followerDetails,
        followersCount: followerDetails.length,
        followingList: followingDetails,
        followingCount: followingDetails.length,
        isFollowing: !!isFollowing,
        courses: formattedCourses,
        posts: userPosts,
        iTagData: iTagData || null,
        bookmarkedPosts: bookmarkedPosts,
        bookmarksCount: targetUser.bookmarks?.length || 0,
        likesCount: targetUser.likes?.length || 0,
      };
      res.status(200).json({
        success: true,
        data: profileData,
      });
    } catch (error) {
      console.error("Comprehensive Profile Fetch Error:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });
  //Toggle Follow
  router.post("/follow/toggle", async (req, res) => {
    try {
      const { followerId, followingId } = req.body;

      if (!followerId || !followingId) {
        return res.status(400).json({ success: false, message: "Missing IDs" });
      }

      if (followerId === followingId) {
        return res
          .status(400)
          .json({ success: false, message: "You cannot follow yourself" });
      }

      // Check if the follow relationship already exists
      const existingFollow = await Follow.findOne({ followerId, followingId });

      if (existingFollow) {
        // 1. UNFOLLOW LOGIC
        await Follow.deleteOne({ id: existingFollow.id });
        const targetUser = await User.findOne({ uid: followingId })
          .select("firstname")
          .lean();
        return res.status(200).json({
          success: true,
          action: "unfollowed",
          message: `Unfollowed ${targetUser.firstname} successfully`,
        });
      } else {
        // 2. FOLLOW LOGIC
        await Follow.create({ followerId, followingId });

        const followerUser = await User.findOne({ uid: followerId })
          .select("firstname")
          .lean();
        const followerName = followerUser ? followerUser.firstname : "Someone";

        // Trigger a notification for the person being followed
        // We don't 'await' this so the response stays fast
        createNotification({
          notificationId: generateNotificationId(),
          recipientId: followingId,
          category: "social",
          actionType: "NEW_FOLLOWER",
          title: "New Follower",
          message: `${followerName} started following you`,
          payload: { followerId },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        }).catch((err) => console.error("Follow Notification Error:", err));

        return res.status(200).json({
          success: true,
          action: "followed",
          message: `Followed ${followerName} successfully`,
        });
      }
    } catch (error) {
      console.error("Follow Toggle Error:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });
  //iTag Edit
  router.put("/update-itag", protect, async (req, res) => {
    try {
      const { userId, updates } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      // findOneAndUpdate with { new: true } returns the updated document
      const updatedITag = await ITag.findOneAndUpdate(
        { userId: userId },
        { $set: updates },
        { new: true, runValidators: true },
      );
      if (!updatedITag) {
        return res.status(404).json({
          success: false,
          message: "iTag not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "iTag updated successfully",
        data: updatedITag,
      });
    } catch (error) {
      console.error("Update Error:", error);

      // Check for MongoDB duplicate key error (if username is changed to one that exists)
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: "Username already exists",
        });
      }
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });
  router.get("/check-itag/:val", async (req, res) => {
    try {
      const { val } = req.params;
      const iTagData = await ITag.findOne({ username: val });

      if (!iTagData) {
        return res.status(404).json({
          available: true,
          message: "iTag username available",
        });
      }
      return res.status(200).json({
        available: false,
        message: "iTag username already exists",
      });
    } catch (error) {
      console.error("Error fetching iTag:", error);
      return res.status(500).json({
        message: "Server error",
      });
    }
  });
  router.patch("/update-profile", protect, async (req, res) => {
    try {
      const userId = req.user.uid;
      const updates = req.body;
      const allowedUpdates = [
        "bio",
        "skills",
        "username",
        "headline",
        "jobTitle",
        "website",
        "alternateEmails",
        "firstname",
        "lastname",
        "email",
        "profilePic",
        "organizationName",
        "department",
      ];
      const filteredUpdates = Object.keys(updates)
        .filter((key) => allowedUpdates.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        });

      const updatedUser = await User.findOneAndUpdate(
        { uid: userId },
        { $set: filteredUpdates },
        { new: true },
      ).select("-resetPinOTP -iCashPin -password -refreshTokens");

      res.status(200).json({
        success: true,
        data: updatedUser,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Server Error" });
    }
  });
  // Initiate payment charge (Flutterwave)
  router.post("/payments/initiate-charge", async (req, res) => {
    const { paymentType, paymentData } = req.body;
    const SECRET_KEY = process.env.FLUTTERWAVE_CLIENT_SECRET;

    try {
      const flwResponse = await fetch(
        `https://api.flutterwave.com/v3/charges?type=${paymentType}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(paymentData),
        },
      );

      const data = await flwResponse.json();
      res.status(flwResponse.status).json({ success: true, data });
    } catch (err) {
      res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  });
  router.get("/payments/banks/:countryCode", async (req, res) => {
    const { countryCode } = req.params;

    try {
      const flwResponse = await fetch(
        `https://api.flutterwave.com/v3/banks/${countryCode}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          },
        },
      );
      const data = await flwResponse.json();
      res.status(flwResponse.status).json(data);
    } catch (error) {
      res
        .status(500)
        .json({ status: "error", message: "Failed to fetch banks" });
    }
  });
  router.post("/block/toggle", protect, async (req, res) => {
    const { targetUserId } = req.body;
    const userId = req.user.uid;

    try {
      const user = await User.findOne({ uid: userId });
      const isBlocked = (user.blockedUsers || []).includes(targetUserId);

      if (isBlocked) {
        await User.updateOne(
          { uid: userId },
          { $pull: { blockedUsers: targetUserId } },
        );
        res.status(200).json({ action: "unblocked" });
      } else {
        await User.updateOne(
          { uid: userId },
          { $addToSet: { blockedUsers: targetUserId } },
        );
        await Follow.deleteMany({
          $or: [
            { followerId: userId, followingId: targetUserId },
            { followerId: targetUserId, followingId: userId },
          ],
        });
        res.status(200).json({ action: "blocked" });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  router.get("/blocked-list", protect, async (req, res) => {
    try {
      const user = await User.findOne({ uid: req.user.uid });
      const blockedList = await User.find({
        uid: { $in: user.blockedUsers || [] },
      }).select(
        "uid firstname lastname username profilePic tier organizationName",
      );
      res.status(200).json(blockedList);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  //
  // router.patch("/preferences/:userId", protect, async (req, res) => {
  router.patch("/preferences/:userId", protect, async (req, res) => {
    const { userId } = req.params;
    const updateData = req.body;

    try {
      const updatedPrefs = await userPrefs.findOneAndUpdate(
        { userId: userId },
        { $set: updateData },
        { new: true, upsert: true },
      );
      res.status(200).json({
        message: "Preferences updated successfully",
        preferences: updatedPrefs,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Server error updating preferences" });
    }
  });
  //delete user
  router.delete("/account/delete", protect, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const userUid = req.user.id;
      const { reason } = req.body;

      const user = await User.findOne({ uid: userUid });
      if (!user) throw new Error("User not found");
      await DeletedUser.create(
        [
          {
            uid: userUid,
            reason: reason || "N/A",
            accountAgeDays: Math.floor(
              (Date.now() - user.createdAt) / (1000 * 60 * 60 * 24),
            ),
            tierAtDeletion: user.tier,
            finalBalance: user.balance || 0,
          },
        ],
        { session },
      );
      await Promise.all([
        User.findOneAndDelete({ uid: userUid }).session(session),
        userPrefs.findOneAndDelete({ userId: userUid }).session(session),
        UserBankOrCardDetails.deleteMany({ userId: userUid }).session(session),
        ITag.findOneAndDelete({ userId: userUid }).session(session),
        Follow.deleteMany({
          $or: [{ followerId: userUid }, { followingId: userUid }],
        }).session(session),
      ]);
      await Course.updateMany(
        { $or: [{ studentsEnrolled: userUid }, { lecturerIds: userUid }] },
        { $pull: { studentsEnrolled: userUid, lecturerIds: userUid } },
      ).session(session);
      await Posts.updateMany(
        { "userId.uid": userUid },
        {
          $set: {
            "userId.firstname": "Deleted",
            "userId.lastname": "User",
            "userId.uid": null,
            "userId.profilePic": [],
          },
        },
      ).session(session);

      await session.commitTransaction();
      res
        .status(200)
        .json({ status: true, message: "Account deleted successfully." });
    } catch (error) {
      await session.abortTransaction();
      console.error("Cleanup Failed:", error);
      res
        .status(500)
        .json({ status: false, message: "Error during account deletion." });
    } finally {
      session.endSession();
    }
  });
  router.post("/password/verify", protect, async (req, res) => {
    const { password } = req.body;
    try {
      const user = await User.findOne({ uid: req.user.id }).select("+password");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res
          .status(401)
          .json({ success: false, message: "Incorrect current password" });
      }
      res.status(200).json({ success: true, message: "Password verified" });
    } catch (error) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  });
  router.put("/password/update", protect, async (req, res) => {
    const { newPassword } = req.body;
    try {
      const user = await User.findOne({ uid: req.user.id });
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
      await user.save();
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
      res
        .status(200)
        .json({ success: true, message: "Password updated successfully" });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "Could not update password" });
    }
  });

  return router;
}
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js
//ngrok http 5000

//On powershell as admin: Start-Service RabbitMQ
