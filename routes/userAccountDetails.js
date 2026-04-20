import express from "express";
import { authenticate, protect } from "../middleware/auth.js";
import { Transactions, ITag } from "../tableDeclarations.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { icashPinResetTemplate } from "../services/emailTemplates.js";
import { createNotification } from "../services/notification.js";
import { sendEmail } from "../services/emailService.js";
import {
  generateNotificationId,
  generateTransactionId,
} from "../utils/idGenerator.js";
import {
  getSavedMethods,
  handleFlutterwaveWebhook,
  initializeBuy,
  initializeWithdraw,
} from "../controllers/paymentController.js";
import { v4 as uuidv4 } from "uuid";
import mongoose from "mongoose";

export default function (User) {
  const router = express.Router();
  router.get("/my-transactions/:userId", authenticate, async (req, res) => {
    try {
      const { userId } = req.params;
      const list = await Transactions.find({ userId })
        .sort({ createdAt: -1 })
        .limit(20);
      res.status(200).json({
        success: true,
        data: list,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  router.post("/verify-icash-pin", protect, async (req, res) => {
    const { pin } = req.body;
    const user = await User.findOne({ uid: req.user.uid }).select("+iCashPin");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.iCashLockoutUntil && user.iCashLockoutUntil > Date.now()) {
      return res.status(403).json({
        message: `Locked. Try again after ${moment(user.iCashLockoutUntil).format("LT")}`,
      });
    }
    if (user.isSuspended) {
      return res.status(403).json({
        isSuspended: true,
        message: "This account is already suspended.",
      });
    }
    const isMatch = await bcrypt.compare(pin, user.iCashPin);
    if (!isMatch) {
      user.iCashAttempts += 1;
      if (user.iCashAttempts >= 5) {
        user.isSuspended = true;
        user.iCashAttempts = 0;
        await user.save();
        return res.status(403).json({
          isSuspended: true,
          message: "Maximum attempts reached. Account suspended for security.",
        });
      }

      await user.save();
      return res.status(401).json({
        message: "Invalid PIN",
        attemptsRemaining: 5 - user.iCashAttempts,
      });
    }
    user.iCashAttempts = 0;
    user.iCashLockoutUntil = null;
    await user.save();

    res.status(200).json({ success: true });
  });
  router.post("/setup-icash-pin", protect, async (req, res) => {
    const { pin } = req.body;
    const user = await User.findOne({ uid: req.user.uid }).select("+iCashPin");
    if (user.iCashPin) {
      return res.status(400).json({
        message: "PIN already exists. Use the 'Reset PIN' flow to change it.",
      });
    }
    const salt = await bcrypt.genSalt(10);
    user.iCashPin = await bcrypt.hash(pin, salt);
    user.twoFactorEnabled = true;
    await user.save();
    res.status(200).json({ success: true, message: "iCash PIN secured." });
  });
  router.post("/request-pin-reset", protect, async (req, res) => {
    const user = await User.findOne({ uid: req.user.uid });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPinOTP = otp;
    user.resetPinOTPExpires = Date.now() + 10 * 60 * 1000;
    await user.save();
    try {
      const htmlContent = icashPinResetTemplate(user.firstname, otp);
      await sendEmail({
        email: user.email,
        subject: "IMPORTANT: iCash PIN Reset Code",
        message: `Your reset code is ${otp}`,
        html: htmlContent,
      });
      res.status(200).json({ message: "OTP sent to your registered email." });
    } catch (err) {
      user.resetPinOTP = undefined;
      user.resetPinOTPExpires = undefined;
      await user.save();
      res.status(500).json({ message: "Email could not be sent." });
    }
  });
  router.post("/reset-icash-pin", protect, async (req, res) => {
    const { otp, newPin } = req.body;
    const user = await User.findOne({
      uid: req.user.uid,
      resetPinOTP: otp,
      resetPinOTPExpires: { $gt: Date.now() },
    }).select("+iCashPin");

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }
    const salt = await bcrypt.genSalt(10);
    user.iCashPin = await bcrypt.hash(newPin, salt);
    user.resetPinOTP = undefined;
    user.resetPinOTPExpires = undefined;
    user.iCashAttempts = 0;
    await user.save();
    createNotification({
      notificationId: generateNotificationId(),
      recipientEmail: user.email,
      recipientId: user.uid,
      category: "security",
      actionType: "ICASH_PIN_RESET",
      title: "iCash PIN Reset",
      message: `Your iCash PIN has been successfully reset.`,
      payload: {
        userName: user.username || user.firstname,
        date: Date.now(),
      },
      sendEmail: true,
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    });
    res
      .status(200)
      .json({ success: true, message: "PIN updated successfully." });
  });
  router.get("/payment-methods", protect, getSavedMethods);
  router.get("/transactions/initialize-buy", protect, initializeBuy);
  router.get("/transactions/initialize-withdraw", protect, initializeWithdraw);
  router.post("/flw-webhook", handleFlutterwaveWebhook);
  router.get("/my-profile", protect, async (req, res) => {
    try {
      const userId = req.user.id;
      const safeFields = [
        "uid",
        "firstname",
        "lastname",
        "username",
        "email",
        "pointsBalance",
        "profilePic",
        "coursesEnrolled",
        "coursesTeaching",
        "country",
        "department",
        "schoolName",
        "usertype",
        "isFirstLogin",
        "hasSubscribed",
        "twoFactorEnabled",
      ].join(" ");
      const user = await User.findOne({ uid: userId }).select(safeFields);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      console.error("Profile Fetch Error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });
  router.get("/iTag/search/:username", protect, async (req, res) => {
    try {
      const { username } = req.params;
      let isPremium;
      let isUser;
      const iTagData = await ITag.findOne({
        username: { $regex: new RegExp(`^${username}$`, "i") },
      });

      if (!iTagData) {
        return res.status(404).json({ message: "User not found" });
      }
      const maskedNumber = iTagData.cardNumber.replace(/\d(?=\d{4})/g, "*");
      isPremium = iTagData.tier === "premium";
      isUser = iTagData.userId === req.user.id;

      res.status(200).json({
        userId: iTagData.userId,
        username: iTagData.username,
        cardHolderName: iTagData.cardHolderName,
        cardNumber: maskedNumber,
        tier: iTagData.tier,
        designOptions: iTagData.designOptions,
        isPremium,
        isUser,
      });
    } catch (error) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  });
  router.post("/transactions/p2p-transfer", protect, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { recipientId, amount, description, recipientiTagName } = req.body;
      const senderId = req.user.id;
      if (amount <= 0)
        return res.status(400).json({ message: "Invalid amount" });
      if (senderId === recipientId)
        return res.status(400).json({ message: "Cannot send to yourself" });

      const sender = await User.findOne({ uid: senderUid }).session(session);
      const recipient = await User.findOne({
        uid: recipientId,
        itagusername: recipientiTagName,
      }).session(session);

      if (!recipient) throw new Error("Recipient not found");
      if (sender.pointsBalance < amount)
        return res.status(400).json({ message: "Insufficient iCash balance" });

      const transactionRef = `P2P-${uuidv4().substring(0, 8).toUpperCase()}`;

      sender.pointsBalance -= amount;
      recipient.pointsBalance += amount;
      await sender.save({ session });
      await recipient.save({ session });

      // 5. Create Transaction Records (Dual-entry)
      const senderTransactionId = generateTransactionId();
      const senderTx = new Transaction({
        transactionId: senderTransactionId,
        userId: senderId,
        type: "p2p_sent",
        amountICash: amount,
        status: "success",
        payType: "out",
        title: "iCash Sent",
        reference: transactionRef,
        metadata: { recipientId, note: description },
      });
      const receipientTransactionId = generateTransactionId();
      const recipientTx = new Transaction({
        transactionId: receipientTransactionId,
        userId: recipientId,
        type: "p2p_received",
        amountICash: amount,
        status: "success",
        payType: "in",
        title: "iCash Received",
        reference: `${transactionRef}-REC`, // Unique ref for recipient
        metadata: { senderId: senderId, note: description },
      });
      await senderTx.save({ session });
      await recipientTx.save({ session });
      // 6. Commit everything
      await session.commitTransaction();
      session.endSession();

      // --- 7. Notifications (Triggered after successful commit) ---
      // A. Notification for the SENDER (Debit Alert)
      const senderNotificationId = generateNotificationId();
      const receipientNotificationId = generateNotificationId();
      createNotification({
        notificationId: senderNotificationId,
        recipientId: senderUid,
        category: "financial",
        actionType: "ICASH_WITHDRAWAL",
        title: "iCash Sent Successfully",
        message: `You sent ${amount.toLocaleString()} iCash to ${recipient.username}.`,
        payload: {
          userName: sender.username,
          amountICash: amount,
          amountLocal: 0,
          currency: "iCash",
          transactionId: transactionRef,
        },
        sendSocket: true,
        sendPush: true,
      });
      // B. Notification for the RECIPIENT (Credit Alert)
      createNotification({
        notificationId: receipientNotificationId,
        recipientId: recipientId,
        category: "financial",
        actionType: "ICASH_PURCHASE",
        title: "iCash Received!",
        message: `You received ${amount.toLocaleString()} iCash from ${sender.username}.`,
        payload: {
          userName: recipient.username,
          amountICash: amount,
          transactionId: transactionRef,
        },
        sendSocket: true,
        sendPush: true,
      });

      res.status(200).json({ message: "Transfer successful", transactionRef });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      res
        .status(500)
        .json({ message: error.message || "Internal Server Error" });
    }
  });
  return router;
}