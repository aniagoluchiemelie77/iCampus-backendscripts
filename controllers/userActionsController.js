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
  Message,
  Notification,
  UserDownloads,
  SupportTicket,
  Lectures,
} from "../tableDeclarations.js";
import { icashPinResetTemplate } from "../services/emailTemplates.js";
import { sendEmail } from "../services/emailService.js";
import twilio from "twilio";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { createNotification } from "../services/notificationService.js";
import { addFlag } from "../utils/flagger.js";
import {
  generateNotificationId,
  generateTokens,
  generateTicketId,
} from "../utils/idGenerator.js";
import mongoose from "mongoose";
import axiosRetry from "axios-retry";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { notifyAdmins } from "../services/adminNotification.js";
import { getPriorityReposter } from "../utils/reposterPriorityChecker.js";
import { logControllerPerformance } from "../utils/eventLogger.js";

const now = new Date();
const formattedDate = now.toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const formattedTime = now.toLocaleTimeString("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
axiosRetry(axios, { retries: 3 });

const FAQ_DATA = [
  {
    id: "iscore-1",
    question: "What is the Unified iScore and how is it calculated?",
    answer:
      "The iScore is a comprehensive metric (capped at 100) that measures your platform engagement, performance, and reputation. It dynamically adjusts its calculation rules depending on whether you are a Student, Lecturer, or standard user. \n Reputation accounts for up to 20 points of your score. It aggregates ratings from your profile reviews.\n•  For Lecturers, points are driven by review averages and active time. \n• For students, points are calculated from your average Test Scores and lecture attendance rates.\n• For normal users, iScore relies entirely on community metrics, combining library usage and platform activity. \n You can also earn points by launching library sessions, downloading books, and interacting with the in-app AI Assistant. \n Lastly, to prevent jarring monthly jumps, iCampus uses a smoothing formula. It carries forward 30% of your previous month’s iScore and blends it with 70% of your current month’s calculated iScore.",
  },
  {
    id: "icash-1",
    question: "What is iCash?",
    answer:
      "iCash is the unified digital medium of exchange used across the iCampus platform and future subsidiaries of Aniagolu Global Tech Services Ltd. It ensures a stable internal economy by keeping transactions independent of volatile local currencies.",
  },
  {
    id: "acad-1",
    question: "What are Lecture Exceptions and how do they work?",
    answer:
      "Lecture Exceptions are formal absence permits that students can request by providing a valid reason to be excused from a specific lecture on a specified date. Once submitted, the request goes directly to the lecturer for review and pending acceptance.",
  },
  {
    id: "test-1",
    question: "How do online Tests work?",
    answer:
      "Tests are created by lecturers with strict start and end times. To begin, you must take a selfie which the AI matches against your official institutional record. During the test, the front camera constantly monitors for outside cheating motions. Glancing away from the screen is capped at 5 seconds; exceeding this triggers an on-screen warning and increments your warning count. Your final score is calculated and displayed immediately after the test concludes.",
  },
  {
    id: "iap-1",
    question: "How do physical product purchases and home delivery work?",
    answer:
      "When purchasing a physical item for home delivery, you provide your delivery address and phone number during checkout. Once your package arrives, the seller will scan a unique QR code generated on your phone. This scan verifies that you received the item, minimizes fraud, and releases the payment to the seller.",
  },
  {
    id: "icash-2",
    question: "What is the exchange rate for iCash?",
    answer:
      "iCash operates on a fixed exchange rate where 1 iCash equals exactly 0.74 USD (or its equivalent value in your local currency). Local currency inputs are automatically converted at the prevailing market rate into USD before iCash is issued.",
  },
  {
    id: "acad-2",
    question: "How many free Lecture Exceptions do I get each month?",
    answer:
      "Your monthly allotment depends on your subscription tier:\n• Free Tier: 1 free exception per month.\n• Pro Tier: 2 free exceptions per month.\n• Premium Tier: 3 free exceptions per month.",
  },
  {
    id: "test-2",
    question: "What actions will trigger an automatic test submission?",
    answer:
      "An automatic test submission and completion will be triggered instantly if you minimize the application or exit the test screen. Additionally, there is a strict cap on cheating warnings; if your warning count reaches or exceeds this threshold, the system will lock you out and automatically submit your test.",
  },
  {
    id: "iap-2",
    question: "How does the drop-off station delivery option work?",
    answer:
      "If you choose a drop-off location, you will select from a list of nearby stations and agents during checkout. The seller is notified to drop the product off there. Once it arrives, you head to the station, and the agent scans your phone’s QR code to confirm pickup. This instantly dispatches payment to both the seller and the agent (their cut).",
  },
  {
    id: "icash-3",
    question: "How secure are my iCash transactions?",
    answer:
      "Security is handled at an architectural level using a Zero-Trust protocol. All debits require Multi-Factor Authorization (MFA) via Biometric Fingerprint/Face Detection or a high-entropy 6-digit Transaction PIN. Data is also fully protected using end-to-end AES-256 encryption.",
  },
  {
    id: "acad-3",
    question: "What happens if I exhaust my free monthly exceptions?",
    answer:
      "If you have exhausted your free monthly allowance, you can purchase additional exceptions at a cost of 0.5 iCash each. Please note that if a lecturer disapproves or cancels a purchased exception, no refunds are issued.",
  },
  {
    id: "iap-3",
    question: "What happens when I buy a digital file or a course?",
    answer:
      "For digital files, the download URL is sent to you immediately after payment, and funds are instantly dispatched to the seller. For courses, completing the purchase grants you immediate access to your courses within your downloads section.",
  },
  {
    id: "icash-4",
    question: "How does the platform prevent fraud and double-spending?",
    answer:
      'iCampus runs a centralized ledger utilizing atomic transactions, meaning a wallet cannot start a second transaction until the first is fully processed or rolled back. Additionally, "Velocity Triggers" automatically freeze and flag your account for review if an unusual number of high-value transfers occur within 60 seconds.',
  },
  {
    id: "acad-4",
    question:
      "What are the different lecture formats supported for attendance?",
    answer:
      "iCampus supports three distinct types of lecture formats:\n1. Online sessions\n2. Pre-recorded video sessions\n3. Physical classroom sessions",
  },
  {
    id: "iap-4",
    question:
      "Why can’t I see my sales earnings in my primary wallet immediately?",
    answer:
      "All earnings from sales or agent commissions are securely held in your Sales Hub payout balance. To access and withdraw these funds, you must meet two security criteria: your identity must be verified, and Two-Factor Authentication (2FA) must be enabled.",
  },
  {
    id: "icash-5",
    question: "Are there any fees associated with using iCash?",
    answer:
      "Yes, the ecosystem applies standard transaction fees: an App Tax of 15% on peer-to-peer services/in-app purchases, and a 1% processing withdrawal fee when you convert your iCash back into local fiat currency.",
  },
  {
    id: "acad-5",
    question:
      "How does physical class attendance tracking work via BLE (Bluetooth Low Energy)?",
    answer:
      "While physical attendance can be managed manually outside the app, the system features automated BLE tracking. The lecturer acts as the Bluetooth host. Students in close proximity simply turn on their Bluetooth and snap a quick verification selfie. The application then automatically compiles and processes the secure attendance list for the lecturer.",
  },
  {
    id: "iap-5",
    question: "Who needs to undergo identity verification for payouts?",
    answer:
      'Students and lecturers are automatically verified by the platform system. However, if your account is registered as an "Enterprise" or "Other" user tier, you must complete a persona verification check before you can access your Sales Hub payouts.',
  },
  {
    id: "icash-6",
    question: "Can I track my transaction history?",
    answer:
      "Absolutely. Every single movement of iCash generates a unique, unchangeable Transaction Hash on an immutable ledger. You will also receive real-time push notifications the exact millisecond any transaction is initiated.",
  },
  {
    id: "iap-6",
    question: "What security is required to withdraw or transfer iCash?",
    answer:
      "To protect your earnings and funds from unauthorized access, any iCash withdrawal or peer-to-peer (P2P) transfer strictly requires you to input your secure 6-digit Transaction PIN.",
  },
  {
    id: "iap-7",
    question: "What happens if an order is cancelled?",
    answer:
      "If an order gets cancelled, the cancellation reason will be immediately updated and displayed to the sellers and the buyer will be refunded.",
  },
];

export const createReviewController = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "ReviewController";
  const action = "createReview";
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
      const cause = "Missing required tracking metrics";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
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
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(201).json({
      success: true,
      message: "Reviews validation metrics published successfully.",
    });
  } catch (error) {
    console.error(
      "Global crash layer hit in createReviewController:",
      error.message,
    );
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message:
        "Internal application routing anomaly during review storage commit pipeline.",
    });
  }
};
export const createNewPasswordInApp = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "InAppPasswordCreationController";
  const action = "createPasswordInApp";
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
    logControllerPerformance(controllerName, action, startTime, "success");
    res
      .status(200)
      .json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res
      .status(500)
      .json({ success: false, message: "Could not update password" });
  }
};
export const deleteAccount = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteAccountController";
  const action = "deleteAccount";
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userUid = req.user.id;
    const { reason } = req.body;

    const user = await User.findOne({ uid: userUid });
    if (!user) {
      const cause = "User not found";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      throw new Error("User not found");
    }
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
    await notifyAdmins(
      { role: ["super_admin", "support"] },
      {
        actionType: "ACCOUNT_DELETION_ADMIN_ALERT",
        payload: {
          userUid: userUid,
          reason: reason,
        },
        senderId: "system",
      },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    res
      .status(200)
      .json({ status: true, message: "Account deleted successfully." });
  } catch (error) {
    await session.abortTransaction();
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    console.error("Cleanup Failed:", error);
    res
      .status(500)
      .json({ status: false, message: "Error during account deletion." });
  } finally {
    session.endSession();
  }
};
export const verifyPhoneNumberOTP = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyPhoneNumberController";
  const action = "verifyPhoneNumber";
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
    const cause = "Invalid or expired code";
    logControllerPerformance(controllerName, action, startTime, "error", cause);
    return res.status(400).json({ message: "Invalid or expired code" });
  }

  const updatedUser = await User.findOneAndUpdate(
    { uid: req.user.id, "phoneNumbers.number": phoneNumber },
    { $set: { "phoneNumbers.$.isVerified": true } },
    { new: true },
  );

  if (!updatedUser) {
    const cause = "User not found";
    logControllerPerformance(controllerName, action, startTime, "error", cause);
    return res.status(404).json({ message: "User not found" });
  }
  await PhoneNumberVerification.deleteOne({ _id: verificationRecord._id });
  logControllerPerformance(controllerName, action, startTime, "success");

  res.status(200).json({
    success: true,
    message: "Phone verified!",
    phoneNumbers: updatedUser.phoneNumbers,
  });
};
export const updateEmails = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "updateEmailController";
  const action = "updateEmail";
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
    const cause = "Invalid update type";
    logControllerPerformance(controllerName, action, startTime, "error", cause);
    return res
      .status(400)
      .json({ message: "Invalid update type", success: false });
  }
  const updatedUser = await User.findOneAndUpdate({ uid: userUid }, update, {
    new: true,
  });
  if (!updatedUser) {
    const cause = "User not found";
    logControllerPerformance(controllerName, action, startTime, "error", cause);
    return res.status(404).json({ message: "User not found", success: false });
  }
  logControllerPerformance(controllerName, action, startTime, "success");
  return res.status(200).json({
    message: `${type === "primary" ? "Primary" : "Recovery"} email updated`,
    success: true,
  });
};
export const deleteRecoveryEmail = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteRecoveryEmailController";
  const action = "deleteRecoveryEmail";
  const { emailToDelete } = req.body;
  const userUid = req.user.id;
  const updatedUser = await User.findOneAndUpdate(
    { uid: userUid },
    { $pull: { recoveryEmails: { email: emailToDelete } } },
    { new: true },
  );
  logControllerPerformance(controllerName, action, startTime, "success");
  res.json({ success: true, recoveryEmails: updatedUser.recoveryEmails });
};
export const deletePhoneNumber = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deletePhoneNumberController";
  const action = "deletePhoneNumber";
  try {
    const { phoneNumber } = req.body;
    const userUid = req.user.id;

    if (!phoneNumber) {
      const cause = "Phone number is required";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res.status(400).json({ message: "Phone number is required" });
    }
    const updatedUser = await User.findOneAndUpdate(
      { uid: userUid },
      { $pull: { phoneNumbers: { number: phoneNumber } } },
      { new: true },
    );
    if (!updatedUser) {
      const cause = "User not found";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res.status(404).json({ message: "User not found" });
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Phone number deleted successfully",
      phoneNumbers: updatedUser.phoneNumbers,
    });
  } catch (error) {
    console.error("Delete phone error:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ message: "Server error" });
  }
};
export const toggleBlockedUsers = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleBlockUsersController";
  const action = "toggleBlockUsers";
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
      logControllerPerformance(controllerName, action, startTime, "success");
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
      logControllerPerformance(controllerName, action, startTime, "success");
      res.status(200).json({ action: "blocked" });
    }
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ error: err.message });
  }
};
export const customizeItag = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "customizeItagController";
  const action = "customizeItag";
  try {
    const userId = req.user.id;
    const { updates } = req.body;

    if (!userId) {
      const cause = "User ID is required";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
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
      const cause = "iTag not found";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res.status(404).json({
        success: false,
        message: "iTag not found",
      });
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "iTag updated successfully",
      data: updatedITag,
    });
  } catch (error) {
    console.error("Update Error:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
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
  const startTime = Date.now();
  const controllerName = "verifyPasswordInAppController";
  const action = "verifyPasswordInApp";
  const { password } = req.body;
  const userId = req.user.id;
  try {
    const user = await User.findOne({ uid: userId }).select("+password");
    if (!user) {
      const cause = "User not found";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const cause = "Incorrect current password";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res
        .status(401)
        .json({ success: false, message: "Incorrect current password" });
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true, message: "Password verified" });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const revokeLoggedInDeviceSession = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "revokeLoggedInDeviceController";
  const action = "revokeLoggedInDevice";
  const userId = req.user.id;
  const { deviceIdToRevoke } = req.body;

  try {
    const user = await User.findOne({ uid: userId });
    if (!user) {
      const cause = "User not found";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res.status(404).json({ error: "User not found" });
    }
    const originalLength = user.sessions.length;
    user.sessions = user.sessions.filter(
      (s) => s.deviceId !== deviceIdToRevoke,
    );

    if (user.sessions.length === originalLength) {
      const cause = "Session not found";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res.status(404).json({ error: "Session not found" });
    }
    await addFlag(userId, "SESSION_REVOKED");
    await user.save();
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ message: "Device logged out successfully" });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ error: "Could not revoke session" });
  }
};
export const patchUserPreferences = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "updateUserPreferencesController";
  const action = "updateUserPreferences";
  const userId = req.user.id;
  const updateData = req.body;

  try {
    const updatedPrefs = await userPrefs.findOneAndUpdate(
      { userId: userId },
      { $set: updateData },
      { new: true, upsert: true },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      message: "Preferences updated successfully",
      preferences: updatedPrefs,
    });
  } catch (error) {
    console.error(error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ error: "Server error updating preferences" });
  }
};
export const sendPhoneNumberOTP = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "sendOtpToMobileController";
  const action = "sendOtpToMobile";
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
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true, message: "OTP sent to WhatsApp" });
  } catch (error) {
    console.error("Twilio Error:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res
      .status(500)
      .json({ success: false, message: "Failed to send WhatsApp message" });
  }
};
export const verifyIcashPin = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyIcashPinController";
  const action = "verifyIcashPin";
  const { pin } = req.body;
  const userId = req.user.id;
  const user = await User.findOne({ uid: userId }).select("+iCashPin");
  if (!user) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "User not found",
    );
    return res.status(404).json({ message: "User not found" });
  }
  if (user.iCashLockoutUntil && user.iCashLockoutUntil > Date.now()) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Locked. Try again",
    );
    return res.status(403).json({
      message: `Locked. Try again after ${moment(user.iCashLockoutUntil).format("LT")}`,
    });
  }
  if (user.isSuspended) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "This account is already suspended.",
    );
    return res.status(403).json({
      isSuspended: true,
      message: "This account is already suspended.",
    });
  }
  const isMatch = await bcrypt.compare(pin, user.iCashPin);
  if (!isMatch) {
    user.iCashAttempts += 1;
    await addFlag(userId, "FAILED_PIN_ATTEMPT");
    if (user.iCashAttempts >= 5) {
      user.isSuspended = true;
      user.iCashAttempts = 0;
      await user.save();
      await notifyAdmins(
        { role: ["moderator", "super_admin"] },
        {
          actionType: "ACCOUNT_SUSPENDED_SECURITY",
          payload: { userId, reason: "Excessive failed iCash PIN attempts" },
          senderId: "system",
        },
        true,
      );
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Maximum attempts reached. Account suspended for security.",
      );
      return res.status(403).json({
        isSuspended: true,
        message: "Maximum attempts reached. Account suspended for security.",
      });
    }

    await user.save();
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Invalid PIN.",
    );
    return res.status(401).json({
      message: "Invalid PIN",
      attemptsRemaining: 5 - user.iCashAttempts,
    });
  }
  user.iCashAttempts = 0;
  user.iCashLockoutUntil = null;
  await user.save();
  logControllerPerformance(controllerName, action, startTime, "success");
  res.status(200).json({ success: true });
};
export const icashPinSetup = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "icashPinSetupController";
  const action = "icashPinSetup";
  const { pin } = req.body;
  const userId = req.user.id;
  const user = await User.findOne({ uid: userId }).select("+iCashPin");
  if (user.iCashPin) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "PIN already exists. Use the 'Reset PIN' flow to change it.",
    );
    return res.status(400).json({
      message: "PIN already exists. Use the 'Reset PIN' flow to change it.",
    });
  }
  const salt = await bcrypt.genSalt(10);
  user.iCashPin = await bcrypt.hash(pin, salt);
  user.twoFactorEnabled = true;
  await user.save();
  logControllerPerformance(controllerName, action, startTime, "success");
  res.status(200).json({ success: true, message: "iCash PIN secured." });
};
export const requestIcashPinReset = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "requestIcashPinResetController";
  const action = "requestIcashPinReset";
  const userId = req.user.id;
  const user = await User.findOne({ uid: userId });
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
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ message: "OTP sent to your registered email." });
  } catch (err) {
    user.resetPinOTP = undefined;
    user.resetPinOTPExpires = undefined;
    await user.save();
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Email could not be sent.",
    );
    res.status(500).json({ message: "Email could not be sent." });
  }
};
export const resetIcashPin = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "resetIcashPinController";
  const action = "resetIcashPin";
  const { otp, newPin } = req.body;
  const userId = req.user.id;
  const user = await User.findOne({
    uid: userId,
    resetPinOTP: otp,
    resetPinOTPExpires: { $gt: Date.now() },
  }).select("+iCashPin suspiciousActivity");

  if (!user) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Invalid or expired OTP.",
    );
    return res.status(400).json({ message: "Invalid or expired OTP." });
  }
  if (user.suspiciousActivity && user.suspiciousActivity.length > 0) {
    await addFlag(userId, "PIN_RESET_WHILE_SUSPICIOUS");
    if (user.suspiciousActivity.length > 3) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Account security in review. Please contact support to help reset PIN.",
      );
      return res.status(403).json({
        message:
          "Account security in review. Please contact support to help reset PIN.",
      });
    }
  }
  const salt = await bcrypt.genSalt(10);
  user.iCashPin = await bcrypt.hash(newPin, salt);
  user.resetPinOTP = undefined;
  user.resetPinOTPExpires = undefined;
  user.iCashAttempts = 0;
  await user.save();
  await createNotification({
    notificationId: generateNotificationId("security"),
    recipientEmail: user.email,
    recoveryEmails: user.recoveryEmails,
    recipientId: user.uid,
    category: "security",
    actionType: "ICASH_PIN_RESET",
    title: "iCash PIN Reset",
    message: `Your iCash PIN has been successfully reset.`,
    payload: {
      userName: user.firstname || "iCampus User",
      date: formattedDate,
      time: formattedTime,
    },
    sendEmail: true,
    sendPush: true,
    sendSocket: true,
    saveToDb: true,
  });
  await notifyAdmins(
    { role: ["super_admin", "support"] },
    {
      actionType: "ICASH_PIN_RESET_AUDIT",
      payload: {
        userUid: user.uid,
        userName: `${user.firstname} ${user.lastname}`,
      },
      senderId: "system",
    },
    false, // Typically don't email admins for every PIN reset unless required
  ).catch((err) => console.error("Admin audit notification failed:", err));
  logControllerPerformance(controllerName, action, startTime, "success");
  res.status(200).json({ success: true, message: "PIN updated successfully." });
};
export const markAllMessagesAsRead = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markAllMessagesAsReadController";
  const action = "markAllMessagesAsRead";
  try {
    const userId = req.user.id;
    await Message.updateMany(
      { recipientId: userId, status: { $ne: "seen" } },
      { $set: { status: "seen" } },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ success: true });
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ error: err.message, success: false });
  }
};
export const markNotificationAsRead = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markNotificationAsReadController";
  const action = "markNotificationAsRead";
  try {
    const { id } = req.params;
    const userId = req.user.uid;
    const notification = await Notification.findOneAndUpdate(
      {
        notificationId: id,
        recipientId: userId,
      },
      { isRead: true },
      { new: true },
    );

    if (!notification) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Notification not found",
      );
      return res.status(404).json({ message: "Notification not found" });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      notification,
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const markAllNotificationsAsRead = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markAllNotificationAsReadController";
  const action = "markAllNotificationAsRead";
  try {
    const userId = req.user.uid;
    const result = await Notification.updateMany(
      {
        recipientId: userId,
        isRead: false,
      },
      {
        $set: { isRead: true },
      },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res
      .status(500)
      .json({ success: false, message: "Server error updating notifications" });
  }
};
export const toggleFollowingUsers = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleFollowingController";
  const action = "toggleFollowing";
  try {
    const followerId = req.user.uid;
    const { followingId } = req.body;

    if (!followingId) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing target followingId",
      );
      return res
        .status(400)
        .json({ success: false, message: "Missing target followingId" });
    }
    if (followerId === followingId) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "You cannot follow yourself",
      );
      return res
        .status(400)
        .json({ success: false, message: "You cannot follow yourself" });
    }
    const existingFollow = await Follow.findOne({ followerId, followingId });

    if (existingFollow) {
      await Follow.deleteOne({ _id: existingFollow._id });
      const targetUser = await User.findOne({ uid: followingId })
        .select("firstname")
        .lean();

      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({
        success: true,
        action: "unfollowed",
        message: `Unfollowed ${targetUser?.firstname || "User"} successfully`,
      });
    } else {
      await Follow.create({ followerId, followingId });
      const followerUser = await User.findOne({ uid: followerId })
        .select("firstname")
        .lean();
      const followerName = followerUser ? followerUser.firstname : "Someone";

      createNotification({
        notificationId: generateNotificationId("social"),
        recipientId: followingId,
        category: "social",
        actionType: "NEW_FOLLOWER",
        title: "New Follower",
        message: `${followerName} started following you`,
        payload: {
          followerId,
          firstname: followerName,
        },
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      }).catch((err) => console.error("Follow Notification Error:", err));
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({
        success: true,
        action: "followed",
        message: `Followed ${targetUser?.firstname || "User"} successfully`,
      });
    }
  } catch (error) {
    console.error("Follow Toggle Error:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const updateUserProfile = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "updateUserProfileController";
  const action = "updateUserProfile";
  try {
    const userId = req.user.id;
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

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
export const updateDownloadedCourseViewProgress = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "updateDownloadedCourseViewProgressController";
  const action = "updateDownloadedCourseViewProgress";
  const { productId, progress, completedLessons, lastWatched } = req.body;
  const userId = req.user.id;
  try {
    const updatedUserDownloads = await UserDownloads.findOneAndUpdate(
      {
        userId: userId,
        "ownedProducts.productId": productId,
      },
      {
        $set: {
          "ownedProducts.$.progress": progress,
          "ownedProducts.$.completedLessons": completedLessons,
          "ownedProducts.$.lastWatched": lastWatched,
          lastAccessed: new Date(),
        },
      },
      { new: true },
    );

    if (!updatedUserDownloads) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Product not found in user's library",
      );
      return res
        .status(404)
        .json({ message: "Product not found in user's library" });
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true, data: updatedUserDownloads });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Server Error", error });
  }
};
export const verifyiTagUsernameAvailability = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyiTagUsernameAvailabilityController";
  const action = "verifyiTagUsernameAvailability";
  try {
    const { val } = req.params;
    const iTagData = await ITag.findOne({ username: val });

    if (!iTagData) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(404).json({
        available: true,
        message: "iTag username available",
      });
    }
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "iTag username already exists",
    );
    return res.status(200).json({
      available: false,
      message: "iTag username already exists",
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    console.error("Error fetching iTag:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
};
export const searchBookInLibrary = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "searchBookInLibraryController";
  const action = "searchBookInLibrary";
  const { q } = req.query;
  const userId = req.user.id;
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
    $(".resItemBox").each((index, element) => {
      const row = $(element);
      const title = row.find('h3[itemprop="name"] a').text().trim();
      const author = row.find(".authors a").text().trim() || "Unknown Author";
      const thumbnail =
        row.find(".cover").attr("data-src") || row.find(".cover").attr("src");
      const detailsUrl = row.find('h3[itemprop="name"] a').attr("href");

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
    logControllerPerformance(controllerName, action, startTime, "success");
    res.json(books);
  } catch (error) {
    console.error("Scraping Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ error: "Failed to connect to the library" });
  }
};
export const searchUserUsingUidOrNameQuery = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "searchUserUsingUidOrNameQueryController";
  const action = "searchUserUsingUidOrNameQuery";
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Query or UID required",
      );
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
    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ success: true, data: uid ? safeResults[0] : safeResults });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: error.message, success: false });
  }
};
export const checkAccountState = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "checkAccountStateController";
  const action = "checkAccountState";
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      user: {
        uid: user.uid,
        isSuspended: user.isSuspended,
      },
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Server error" });
  }
};
export const createPersonaVerifyInquiry = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createPersonaVerifyInquiryController";
  const action = "createPersonaVerifyInquiry";
  try {
    const userId = req.user.id;
    const { userType } = req.body;

    const INDIVIDUAL_TEMPLATE_ID = process.env.INDIVIDUAL_TEMPLATE_ID;
    const ENTERPRISE_TEMPLATE_ID = process.env.ENTERPRISE_TEMPLATE_ID;
    const selectedTemplate =
      userType === "enterprise"
        ? ENTERPRISE_TEMPLATE_ID
        : INDIVIDUAL_TEMPLATE_ID;

    const response = await axios.post(
      "https://withpersona.com/api/v1/inquiries",
      {
        data: {
          attributes: {
            "template-id": selectedTemplate,
            "reference-id": userId,
            environment: "sandbox",
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PERSONA_API_KEY}`,
          Accept: "application/json",
          "Persona-Version": "2023-01-05",
          "Content-Type": "application/json",
        },
      },
    );
    const inquiryId = response.data.data.id;
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ inquiryId });
  } catch (error) {
    console.error("Persona API Error:", error.response?.data || error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({
      error: "Failed to initialize verification session",
      details: error.response?.data?.errors,
    });
  }
};
export const handleUnifiedCourseSearch = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "handleUnifiedCourseSearchController";
  const action = "handleUnifiedCourseSearch";
  try {
    const searchQuery = req.query.q;
    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(200).json({ success: true, courses: [] });
    }
    const searchRegex = new RegExp(
      searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    const institutionalCourses = await Course.find({
      $or: [
        { courseTitle: { $regex: searchRegex } },
        { courseCode: { $regex: searchRegex } },
        { department: { $regex: searchRegex } },
      ],
    })
      .limit(25)
      .lean();
    const allLecturerUids = [
      ...new Set(
        institutionalCourses
          .map((course) => course.lecturerIds?.[course.lecturerIds.length - 1])
          .filter(Boolean),
      ),
    ];
    let lecturerMap = {};
    if (allLecturerUids.length > 0) {
      const lecturers = await User.find(
        { uid: { $in: allLecturerUids } },
        "uid firstname lastname",
      ).lean();
      lecturerMap = lecturers.reduce((acc, user) => {
        acc[user.uid] = `${user.firstname} ${user.lastname}`;
        return acc;
      }, {});
    }
    const normalizedInstitutional = institutionalCourses.map((course) => {
      const mappedInstructors = course.lecturerIds
        ?.map((uid) => lecturerMap[uid])
        .filter(Boolean)
        .join(", ");

      return {
        id: course.courseId,
        title: course.courseTitle,
        code: course.courseCode,
        semester: course.semester,
        session: course.session,
        creditLoad: course.credits,
        isPremiumPaid: false,
        price: 0,
        thumbnail: course.thumbnailUrl || null,
        studentsCount: course.studentsEnrolled?.length || 0,
        isActive: course.isActive ?? true,
        instructors:
          mappedInstructors || course.instructorName || "Course Instructor",
      };
    });
    const marketplaceCourses = await Product.find({
      type: "course",
      $or: [
        { title: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
        { category: { $regex: searchRegex } },
      ],
    })
      .limit(25)
      .lean();
    const normalizedPremium = await Promise.all(
      marketplaceCourses.map(async (product) => {
        let instructorNames = "Instructor";
        const lecturerUids = product.courseDetails?.lecturerIds || [];

        if (lecturerUids.length > 0) {
          const discoveredUsers = await User.find(
            { uid: { $in: lecturerUids } },
            "firstname lastname",
          );
          if (discoveredUsers.length > 0) {
            instructorNames = discoveredUsers
              .map((u) => `${u.firstname} ${u.lastname}`)
              .join(", ");
          }
        }

        return {
          id: product.productId,
          title: product.title,
          code: product.category || "Premium",
          isPremiumPaid: true,
          semester: null,
          session: null,
          creditLoad: null,
          price: product.priceInPoints || 0,
          thumbnail: product.mediaUrls?.[0] || null,
          studentsCount: product.courseDetails?.studentsEnrolled?.length || 0,
          isActive: product.isAvailable ?? true,
          instructors: instructorNames,
        };
      }),
    );

    const dynamicUnifiedResults = [
      ...normalizedInstitutional,
      ...normalizedPremium,
    ].sort((a, b) => a.title.localeCompare(b.title));
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      courses: dynamicUnifiedResults,
    });
  } catch (error) {
    console.error("Unified course search failure:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Internal server lookup engine exception error.",
    });
  }
};
export const handleUnifiedResourceSearch = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "handleUnifiedResourceSearchController";
  const action = "handleUnifiedResourceSearch";
  try {
    const searchQuery = req.query.q;
    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(200).json({ success: true, resources: [] });
    }
    const searchRegex = new RegExp(
      searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    const institutionalMatches = await Course.find({
      $or: [
        { courseTitle: { $regex: searchRegex } },
        { courseCode: { $regex: searchRegex } },
        { resources: { $regex: searchRegex } },
      ],
    })
      .select("courseId courseTitle courseCode resources")
      .limit(30)
      .lean();

    const normalizedInstitutional = [];

    institutionalMatches.forEach((course) => {
      if (!course.resources || course.resources.length === 0) return;

      course.resources.forEach((url) => {
        const rawFileName = url.split("/").pop() || "Untitled Material";
        const cleanedFileName = decodeURIComponent(rawFileName).split("?")[0];
        const matchesQuery =
          course.courseTitle.match(searchRegex) ||
          course.courseCode.match(searchRegex) ||
          cleanedFileName.match(searchRegex);
        if (matchesQuery) {
          normalizedInstitutional.push({
            id: `${course.courseId}-${Buffer.from(url).toString("base64").substring(0, 8)}`,
            title: cleanedFileName.split("-").pop() || cleanedFileName,
            url: url,
            format: url.split(".").pop()?.split("?")[0]?.toLowerCase() || "pdf",
            isPremiumPaid: false,
            price: 0,
            metaSource: `${course.courseCode} • Institutional`,
            courseId: course.courseId,
          });
        }
      });
    });
    const marketplaceFiles = await Product.find({
      type: "file",
      isAvailable: true,
      $or: [
        { title: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
        { category: { $regex: searchRegex } },
        { "fileDetails.fileName": { $regex: searchRegex } },
      ],
    })
      .limit(25)
      .lean();

    const normalizedPremium = marketplaceFiles.map((product) => {
      return {
        id: product.productId,
        title: product.title,
        url: product.fileDetails?.fileUrl || product.mediaUrls?.[0] || null,
        format: product.fileDetails?.fileFormat || "pdf",
        isPremiumPaid: true,
        price: product.priceInPoints || 0,
        metaSource: `${product.category || "Document"} • Marketplace`,
        fileSize: product.fileDetails?.fileSizeInMB
          ? `${product.fileDetails.fileSizeInMB} MB`
          : null,
      };
    });
    const unifiedResources = [
      ...normalizedInstitutional,
      ...normalizedPremium,
    ].sort((a, b) => a.title.localeCompare(b.title));

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      resources: unifiedResources,
    });
  } catch (error) {
    console.error("Unified resource library lookup down: ", error.message);
    await logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Internal engine error resolving resource records.",
    });
  }
};
export const toggleTheme = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleThemeController";
  const action = "toggleTheme";
  try {
    const { theme } = req.body;

    if (!["light", "dark", "system"].includes(theme)) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid choice schema profile allocation assignment.",
      );
      return res.status(400).json({
        message: "Invalid choice schema profile allocation assignment.",
      });
    }
    await userPrefs.findOneAndUpdate(
      { userId: req.user.uid },
      { $set: { theme } },
      { new: true, upsert: true },
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "Theme synchronization configurations stored successfully.",
    });
  } catch (error) {
    console.error("Preferences Update Engine System Fault:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};
export const refreshUserDetails = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "refreshUserDetailsController";
  const action = "refreshUserDetails";
  try {
    const uid = req.user.uid;
    if (!uid) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized: Missing user identifier",
      );
      return res
        .status(401)
        .json({ message: "Unauthorized: Missing user identifier" });
    }
    const [user, preferences] = await Promise.all([
      User.findOne({ uid }),
      userPrefs.findOne({ uid }),
    ]);
    if (!user) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const {
      password: _,
      iCashPin: _,
      userAccountDetails: _,
      ...safeUser
    } = user.toObject();
    safeUser.theme = preferences ? preferences.theme : "light";
    const { accessToken, refreshToken } = await generateTokens(user);
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Refresh successful",
      user: safeUser,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Error in user refresh handler:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const aiChat = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createQuickMeetingController";
  const action = "createQuickMeeting";
  const { message, context, history } = req.body;
  const uid = req.user.uid;
  const { type, data } = context;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    let systemInstruction = "";
    if (type === "support") {
      systemInstruction = `You are iAssistant, the official Support AI for iCampus. 
      Use the provided FAQ knowledge: ${JSON.stringify(FAQ_DATA)}. 
      If the user's issue cannot be resolved via the FAQs, acknowledge the limitation 
      and state that you are escalating the issue to a human support ticket.
      If the issue requires escalation, respond in a JSON format:
{
  "reply": "Your natural language response to the user...",
  "requiresEscalation": true,
  "suggestedCategory": "technical|billing|content|other",
  "suggestedSummary": "A very short 5- 10 words summary of the issue",
  "suggestedSeverity": "low|medium|high|critical"
}
If no escalation is needed, just provide your response as plain text.
      `;
    } else {
      systemInstruction = `You are iAssistant, the official Academic AI Tutor for iCampus. 
      Your purpose is to help students and lecturers understand educational material. 
      Academic Context: ${type === "course" ? `Course: ${data.courseTitle}` : type === "lecture" ? `Topic: ${data.topicName}` : "General Study"}.`;
    }
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: systemInstruction + "\nConfirm you are ready." }],
        },
        {
          role: "model",
          parts: [
            { text: "Understood. I am ready to assist you in this context." },
          ],
        },
        ...history,
      ],
    });

    const result = await chat.sendMessage(message);
    const replyText = result.response.text();
    let finalReply;
    let aiResponse;
    const ticketRefId = generateTicketId(uid);

    try {
      aiResponse = JSON.parse(replyText);
    } catch (e) {
      aiResponse = { reply: replyText, requiresEscalation: false };
    }

    if (aiResponse.requiresEscalation) {
      const ticket = await SupportTicket.create({
        userId: uid,
        originalMessage: message,
        status: "open",
        ticketRefId,
        summary: aiResponse.suggestedSummary || "AI could not resolve query",
        category: aiResponse.suggestedCategory || "other",
        severity: aiResponse.suggestedSeverity || "medium",
        thread: [{ sender: "user", message: message }],
      });
      finalReply = aiResponse.reply + `\n\nTicket ID: ${ticket.ticketRefId}`;
      await notifyAdmins(
        { role: ["support", "super_admin"] },
        {
          actionType: "AI_SUPPORT_ESCALATION",
          payload: {
            ticketId: ticket.ticketRefId,
            userUid: uid,
            summary: ticket.summary,
          },
          senderId: "system",
        },
        false,
      ).catch((err) =>
        console.error("Admin escalation notification failed:", err),
      );
    } else {
      finalReply = aiResponse.reply;
    }
    if (uid) {
      await User.findOneAndUpdate(
        { uid },
        { $inc: { "monthlyStats.aiQueries": 1 } },
      );
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ reply: finalReply, ticketId: ticket.ticketRefId });
  } catch (error) {
    console.error("AI Chat Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ error: "Failed to fetch response" });
  }
};
export const searchPosts = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "searchPostsController";
  const action = "searchPosts";
  try {
    const searchQuery = req.query.q;

    if (!searchQuery || searchQuery.trim().length < 2) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({ success: true, posts: [] });
    }
    const sanitizedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(sanitizedQuery, "i");
    const posts = await Posts.find({
      $or: [
        { content: { $regex: searchRegex } },
        { "comments.comment": { $regex: searchRegex } },
        { "jobMetadata.title": { $regex: searchRegex } },
        { "jobMetadata.company": { $regex: searchRegex } },
        { "eventMetadata.title": { $regex: searchRegex } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(40);

    const formattedPosts = await Promise.all(
      posts.map(async (post) => {
        const featuredReposter = await getPriorityReposter(
          post.repostersDetails || [],
          userId,
        );
        return {
          ...post,
          featuredReposter: featuredReposter,
        };
      }),
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      count: formattedPosts.length,
      posts: formattedPosts,
    });
  } catch (error) {
    console.error("Database match compilation exception:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve posts matching search parameter.",
    });
  }
};
export const createQuickMeeting = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createQuickMeetingController";
  const action = "createQuickMeeting";
  try {
    const { date, startTime, endTime, topicName, lectureType } = req.body;
    const hostId = req.user.uid;

    const conflict = await Lectures.findOne({
      date: date,
      hostId: hostId,
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    });

    if (conflict) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Conflict detected",
      );
      return res.status(409).json({
        message: `Conflict detected! You are already scheduled for "${conflict.topicName}" at this time.`,
      });
    }

    const location =
      lectureType === "Online"
        ? `https://live.useicampus.io/${hostId}/${Math.random().toString(36).substring(7)}`
        : req.body.location;

    const newMeeting = {
      id: generateLectureId(hostId, lectureType),
      hostId,
      topicName,
      date,
      startTime,
      endTime,
      lectureType,
      location,
      status: "scheduled",
      isTaught: false,
      attendance: [],
      courseId: null,
      department: null,
      level: null,
    };

    const result = await Lectures.create(newMeeting);
    const readableDate = new Date(date).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const message = `Your online class session '${topicName}' is set for ${readableDate} at ${startTime}. Click here to join: ${location}`;

    await createNotification({
      notificationId: generateNotificationId("meeting"),
      recipientId: hostId,
      category: "academic",
      actionType: "CLASS_SCHEDULED",
      title: "Class Scheduled",
      message,
      payload: {
        topicName,
        lectureId: result.id,
        location,
        time: startTime,
        date: readableDate,
      },
      entityId: result.id,
      entityType: "lecture",
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    });
    await User.updateOne(
      { uid: hostId },
      {
        $inc: { "monthlyStats.minutesActive": 15, "monthlyStats.aiQueries": 2 },
      },
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(201).json({
      message: "Meeting scheduled successfully",
      meeting: result,
    });
  } catch (error) {
    console.error("Quick Meeting Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Internal Server Error" });
  }
};