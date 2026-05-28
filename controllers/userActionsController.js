import {
  Reviews,
  User,
  DeletedUser,
  userPrefs,
  Posts,
  UserBankOrCardDetails,
  ITag,
  Follow,
  Product,
  Course,
  PhoneNumberVerification,
} from "../tableDeclarations";
import { icashPinResetTemplate } from "../services/emailTemplates.js";
import { sendEmail } from "../services/emailService.js";
import twilio from "twilio";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { createNotification } from "../services/notificationService.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import mongoose from "mongoose";

export const createReviewController = async (req, res) => {
  try {
    let reviewerId = null;
    reviewerId = req.user?.id;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        reviewerId = decoded.id || decoded.uid;
      } catch (err) {
        console.log(
          "Standard token verification failed, checking payload body next...",
        );
      }
    }
    if (!reviewerId && req.body.token) {
      try {
        const decoded = jwt.verify(req.body.token, process.env.JWT_SECRET);
        reviewerId = decoded.id || decoded.uid;
      } catch (err) {
        return res.status(401).json({
          success: false,
          message: "Expired or invalid fallback authentication token link.",
        });
      }
    }
    const {
      targetId,
      targetType,
      orderId,
      rating,
      comment,
      mediaUrls,
      attributes,
    } = req.body;
    if (!targetId || !targetType || !rating) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required tracking metrics (targetId, targetType, or rating rating arrays).",
      });
    }
    let parsedMediaUrls = [];
    if (mediaUrls) {
      try {
        parsedMediaUrls =
          typeof mediaUrls === "string" ? JSON.parse(mediaUrls) : mediaUrls;
      } catch (e) {
        parsedMediaUrls = [mediaUrls];
      }
    }

    let parsedAttributes = {
      accuracy: undefined,
      deliverySpeed: undefined,
      clarity: undefined,
    };
    if (attributes) {
      try {
        const rawAttrs =
          typeof attributes === "string" ? JSON.parse(attributes) : attributes;
        parsedAttributes = {
          accuracy: Number(rawAttrs.accuracy) || undefined,
          deliverySpeed: Number(rawAttrs.deliverySpeed) || undefined,
          clarity: Number(rawAttrs.clarity) || undefined,
        };
      } catch (e) {
        console.error("Attributes parsing layout mismatch anomaly:", e);
      }
    }
    const newReview = new Reviews({
      reviewerId,
      targetId,
      targetType,
      orderId,
      rating: Number(rating),
      comment: comment ? comment.trim() : "",
      mediaUrls: parsedMediaUrls,
      attributes: parsedAttributes,
    });

    await newReview.save();
    return res.status(201).json({
      success: true,
      message: "Reviews validation metrics published successfully.",
    });
  } catch (error) {
    console.error("Global crash layer hit in createReviewController:", error);
    return res.status(500).json({
      success: false,
      message:
        "Internal application routing anomaly during review storage commit pipeline.",
    });
  }
};
export const createNewPasswordInApp = async (req, res) => {
  const { newPassword } = req.body;
  try {
    const user = await User.findOne({ uid: req.user.id });
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();
    const now = new Date();
    const formattedTime = `${now.toLocaleDateString()} at ${now.toLocaleTimeString()}`;
    await createNotification({
      notificationId: generateNotificationId("security"),
      recipientId: user.uid,
      recipientEmail: user.email,
      recoveryEmails: user.recoveryEmails,
      category: "auth",
      actionType: "PASSWORD_CHANGED",
      title: "Password Changed",
      message: `Your password was successfully updated on ${formattedTime}.`,
      payload: {
        userName: user.firstname || "User",
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
};
export const deleteAccount = async (req, res) => {
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
};
export const verifyPhoneNumberOTP = async (req, res) => {
  const { phoneNumber, codeInput } = req.body;

  const hashedInput = crypto
    .createHash("sha256")
    .update(codeInput)
    .digest("hex");

  const verificationRecord = await PhoneNumberVerification.findOne({
    phoneNumber: phoneNumber,
    code: hashedInput,
  });

  if (!verificationRecord) {
    return res.status(400).json({ message: "Invalid or expired code" });
  }

  const updatedUser = await User.findOneAndUpdate(
    { uid: req.user.id, "phoneNumbers.number": phoneNumber },
    { $set: { "phoneNumbers.$.isVerified": true } },
    { new: true },
  );

  if (!updatedUser) {
    return res.status(404).json({ message: "User not found" });
  }
  await PhoneNumberVerification.deleteOne({ _id: verificationRecord._id });

  res.status(200).json({
    success: true,
    message: "Phone verified!",
    phoneNumbers: updatedUser.phoneNumbers,
  });
};
export const updateEmails = async (req, res) => {
  const { email, type } = req.body;
  const userUid = req.user.id;
  let update = {};

  if (type === "primary") {
    update = { $set: { email: email } };
  } else if (type === "secondary") {
    update = {
      $addToSet: {
        recoveryEmails: { email, isVerified: true, addedAt: new Date() },
      },
    };
  } else {
    return res
      .status(400)
      .json({ message: "Invalid update type", success: false });
  }
  const updatedUser = await User.findOneAndUpdate({ uid: userUid }, update, {
    new: true,
  });
  if (!updatedUser) {
    return res.status(404).json({ message: "User not found", success: false });
  }
  return res.status(200).json({
    message: `${type === "primary" ? "Primary" : "Recovery"} email updated`,
    success: true,
  });
};
export const deleteRecoveryEmail = async (req, res) => {
  const { emailToDelete } = req.body;
  const userUid = req.user.iid;
  const updatedUser = await User.findOneAndUpdate(
    { uid: userUid },
    { $pull: { recoveryEmails: { email: emailToDelete } } },
    { new: true },
  );
  res.json({ success: true, recoveryEmails: updatedUser.recoveryEmails });
};
export const deletePhoneNumber = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const userUid = req.user.id;

    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number is required" });
    }
    const updatedUser = await User.findOneAndUpdate(
      { uid: userUid },
      { $pull: { phoneNumbers: { number: phoneNumber } } },
      { new: true },
    );
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json({
      message: "Phone number deleted successfully",
      phoneNumbers: updatedUser.phoneNumbers,
    });
  } catch (error) {
    console.error("Delete phone error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
export const toggleBlockedUsers = async (req, res) => {
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
};
export const customizeItag = async (req, res) => {
  try {
    const { userId, updates } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }
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
};
export const verifyPasswordInapp = async (req, res) => {
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
};
export const revokeLoggedInDeviceSession = async (req, res) => {
  const userId = req.user.id;
  const { deviceIdToRevoke } = req.body;

  try {
    const user = await User.findOne({ uid: userId });
    if (!user) return res.status(404).json({ error: "User not found" });
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
};
export const patchUserPreferences = async (req, res) => {
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
};
export const sendPhoneNumberOTP = async (req, res) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = twilio(accountSid, authToken);
  const { phoneNumber, channel } = req.body;
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedCode = crypto.createHash("sha256").update(otpCode).digest("hex");
  await PhoneNumberVerification.findOneAndUpdate(
    { phoneNumber },
    { code: hashedCode, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
    { upsert: true },
  );

  try {
    const message = await client.messages.create({
      from: `${channel}:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      contentSid: process.env.TWILIO_CONTENT_SID,
      contentVariables: JSON.stringify({ 1: otpCode }),
      to: `${channel}:${phoneNumber}`,
    });

    console.log("WhatsApp sent:", message.sid);
    res.status(200).json({ success: true, message: "OTP sent to WhatsApp" });
  } catch (error) {
    console.error("Twilio Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to send WhatsApp message" });
  }
};
export const verifyIcashPin = async (req, res) => {
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
};
export const icashPinSetup = async (req, res) => {
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
};
export const requestIcashPinReset = async (req, res) => {
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
};
export const resetIcashPin = async (req, res) => {
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
    notificationId: generateNotificationId("security"),
    recipientEmail: user.email,
    recoveryEmails: user.recoveryEmails,
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
  res.status(200).json({ success: true, message: "PIN updated successfully." });
};  