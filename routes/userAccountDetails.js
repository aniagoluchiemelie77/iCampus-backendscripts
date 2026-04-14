import express from "express";
import { authenticate, protect } from "../middleware/auth.js";
import { Transactions } from "../tableDeclarations.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { icashPinResetTemplate } from "../services/emailTemplates.js";
import { sendEmail } from "../services/emailService.js";

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
    res
      .status(200)
      .json({ success: true, message: "PIN updated successfully." });
  });
  return router;
}