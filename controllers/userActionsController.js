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
  DropOffStation,
  PostReposters,
  Comments,
} from "../tableDeclarations.js";
import { icashPinResetTemplate } from "../services/emailTemplates.js";
import { sendEmail } from "../services/emailService.js";
import twilio from "twilio";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { createNotification } from "../services/notification.js";
import { addFlag } from "../utils/flagger.js";
import {
  generateNotificationId,
  generateTokens,
  generateTicketId,
  generateStationId,
} from "../utils/idGenerator.js";
import axiosRetry from "axios-retry";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { notifyAdmins } from "../services/adminNotification.js";
import { getPriorityReposter } from "../utils/reposterPriorityChecker.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { prepareLectureData } from "../utils/onlineClassLinkGenerator.js";
import { db } from "../config/firebaseAdmin.js";

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
      "If you choose to receive your purchased product at a selected drop-off location during checkout, the seller will be notified immediately to drop the product at your selected locatio. Once it arrives, you will be notified, then head to the station, and the agent scans the generated order QR code from your device to confirm pickup. This instantly dispatches payment to both the seller and the agent (their cut).",
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

    const newReviewDocRef = Reviews.doc();
    const reviewData = {
      reviewId: newReviewDocRef.id,
      reviewerId,
      targetId,
      targetType,
      orderId: orderId || null,
      rating: Number(rating),
      comment: comment ? comment.trim() : "",
      mediaUrls: parsedMediaUrls,
      attributes: parsedAttributes,
      createdAt: new Date(),
    };

    await newReviewDocRef.set(reviewData);

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
    const querySnapshot = await User.where("uid", "==", req.user.id)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDocRef = querySnapshot.docs[0].ref;
    const user = querySnapshot.docs[0].data();

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await userDocRef.update({
      password: hashedPassword,
      updatedAt: new Date(),
    });

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

  const batch = db.batch();

  try {
    const userUid = req.user.id;
    const { reason } = req.body;
    const userQuery = await User.where("uid", "==", userUid).limit(1).get();

    if (userQuery.empty) {
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

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();
    const createdAtDate = user.createdAt?.toDate
      ? user.createdAt.toDate()
      : new Date(user.createdAt || Date.now());
    const accountAgeDays = Math.floor(
      (Date.now() - createdAtDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    batch.set(DeletedUser.doc(), {
      uid: userUid,
      reason: reason || "N/A",
      accountAgeDays,
      tierAtDeletion: user.tier || "standard",
      finalBalance: user.balance || 0,
      deletedAt: new Date(),
    });
    batch.delete(userDoc.ref);
    const prefsQuery = await userPrefs.where("userId", "==", userUid).get();
    prefsQuery.forEach((doc) => batch.delete(doc.ref));
    const bankCardsQuery = await UserBankOrCardDetails.where(
      "userId",
      "==",
      userUid,
    ).get();
    bankCardsQuery.forEach((doc) => batch.delete(doc.ref));
    const itagQuery = await ITag.where("userId", "==", userUid).get();
    itagQuery.forEach((doc) => batch.delete(doc.ref));
    const followsAsFollower = await Follow.where(
      "followerId",
      "==",
      userUid,
    ).get();
    const followsAsFollowing = await Follow.where(
      "followingId",
      "==",
      userUid,
    ).get();
    followsAsFollower.forEach((doc) => batch.delete(doc.ref));
    followsAsFollowing.forEach((doc) => batch.delete(doc.ref));
    const enrolledCoursesQuery = await Course.where(
      "studentsEnrolled",
      "array-contains",
      userUid,
    ).get();
    const lecturerCoursesQuery = await Course.where(
      "lecturerIds",
      "array-contains",
      userUid,
    ).get();

    enrolledCoursesQuery.forEach((doc) => {
      const currentList = doc.data().studentsEnrolled || [];
      batch.update(doc.ref, {
        studentsEnrolled: currentList.filter((id) => id !== userUid),
      });
    });

    lecturerCoursesQuery.forEach((doc) => {
      const currentList = doc.data().lecturerIds || [];
      batch.update(doc.ref, {
        lecturerIds: currentList.filter((id) => id !== userUid),
      });
    });
    const postsQuery = await Posts.where("originalAuthor", "==", userUid).get();
    postsQuery.forEach((doc) => {
      batch.delete(doc.ref);
    });

    const postRepostersQuery = await PostReposters.where(
      "uid",
      "==",
      userUid,
    ).get();
    postRepostersQuery.forEach((doc) => {
      batch.delete(doc.ref);
    });

    const commentsQuery = await Comments.where("userId", "==", userUid).get();
    commentsQuery.forEach((doc) => {
      batch.delete(doc.ref);
    });

    // Also remove the deleted user's repost details from other posts or collections if applicable
    const repostsAsUserQuery = await PostReposters.where(
      "userId",
      "==",
      userUid,
    ).get();
    repostsAsUserQuery.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    await notifyAdmins(
      { role: ["super_admin", "support"] },
      {
        notificationId: generateNotificationId("profile"),
        category: "profile",
        message: `User ${userUid} has permanently deleted their account. Reason provided: ${reason || "None"}.`,
        actionType: "ACCOUNT_DELETION_ADMIN_ALERT",
        title: "User Account Deletion",
        payload: {
          userUid: userUid,
          reason: reason,
        },
        senderId: "system",
      },
      false,
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    res
      .status(200)
      .json({ status: true, message: "Account deleted successfully." });
  } catch (error) {
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
  }
};
export const verifyPhoneNumberOTP = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyPhoneNumberController";
  const action = "verifyPhoneNumber";
  const { phoneNumber, codeInput } = req.body;

  try {
    const hashedInput = crypto
      .createHash("sha256")
      .update(codeInput)
      .digest("hex");

    const verificationQuery = await PhoneNumberVerification.where(
      "phoneNumber",
      "==",
      phoneNumber,
    )
      .where("code", "==", hashedInput)
      .limit(1)
      .get();

    if (verificationQuery.empty) {
      const cause = "Invalid or expired code";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    const verificationDoc = verificationQuery.docs[0];
    const userQuery = await User.where("uid", "==", req.user.id).limit(1).get();

    if (userQuery.empty) {
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

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const phoneNumbers = userData.phoneNumbers || [];

    let phoneFound = false;
    const updatedPhoneNumbers = phoneNumbers.map((phone) => {
      if (phone.number === phoneNumber) {
        phoneFound = true;
        return { ...phone, isVerified: true };
      }
      return phone;
    });

    if (!phoneFound) {
      const cause = "Phone number not registered to user";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res
        .status(404)
        .json({ message: "Phone number not found in user records" });
    }

    await userDoc.ref.update({
      phoneNumbers: updatedPhoneNumbers,
      updatedAt: new Date(),
    });
    await verificationDoc.ref.delete();

    logControllerPerformance(controllerName, action, startTime, "success");

    res.status(200).json({
      success: true,
      message: "Phone verified!",
      phoneNumbers: updatedPhoneNumbers,
    });
  } catch (error) {
    console.error("Error in verifyPhoneNumberOTP:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res
      .status(500)
      .json({ message: "Internal server error during phone verification" });
  }
};
export const updateEmails = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "updateEmailController";
  const action = "updateEmail";
  const { email, type } = req.body;
  const userUid = req.user.id;

  try {
    if (type !== "primary" && type !== "secondary") {
      const cause = "Invalid update type";
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        cause,
      );
      return res
        .status(400)
        .json({ message: "Invalid update type", success: false });
    }

    const userQuery = await User.where("uid", "==", userUid).limit(1).get();

    if (userQuery.empty) {
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
        .json({ message: "User not found", success: false });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();

    if (type === "primary") {
      await userDoc.ref.update({
        email: email,
        updatedAt: new Date(),
      });
    } else if (type === "secondary") {
      const recoveryEmails = userData.recoveryEmails || [];
      const emailExists = recoveryEmails.some((rec) => rec.email === email);

      if (!emailExists) {
        recoveryEmails.push({
          email,
          isVerified: true,
          addedAt: new Date(),
        });

        await userDoc.ref.update({
          recoveryEmails: recoveryEmails,
          updatedAt: new Date(),
        });
      }
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: `${type === "primary" ? "Primary" : "Recovery"} email updated`,
      success: true,
    });
  } catch (error) {
    console.error("Error in updateEmails:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      message: "Internal server error during email update",
      success: false,
    });
  }
};
export const deleteRecoveryEmail = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteRecoveryEmailController";
  const action = "deleteRecoveryEmail";
  const { emailToDelete } = req.body;
  const userUid = req.user.id;

  try {
    const userQuery = await User.where("uid", "==", userUid).limit(1).get();

    if (userQuery.empty) {
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

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const recoveryEmails = userData.recoveryEmails || [];
    const updatedRecoveryEmails = recoveryEmails.filter(
      (rec) => rec.email !== emailToDelete,
    );

    await userDoc.ref.update({
      recoveryEmails: updatedRecoveryEmails,
      updatedAt: new Date(),
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ success: true, recoveryEmails: updatedRecoveryEmails });
  } catch (error) {
    console.error("Error in deleteRecoveryEmail:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({
      success: false,
      message: "Internal server error during recovery email deletion",
    });
  }
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

    const userQuery = await User.where("uid", "==", userUid).limit(1).get();

    if (userQuery.empty) {
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

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const phoneNumbers = userData.phoneNumbers || [];
    const updatedPhoneNumbers = phoneNumbers.filter(
      (phone) => phone.number !== phoneNumber,
    );

    await userDoc.ref.update({
      phoneNumbers: updatedPhoneNumbers,
      updatedAt: new Date(),
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Phone number deleted successfully",
      phoneNumbers: updatedPhoneNumbers,
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
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ error: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const blockedUsers = userData.blockedUsers || [];
    const isBlocked = blockedUsers.includes(targetUserId);

    if (isBlocked) {
      const updatedBlockedUsers = blockedUsers.filter(
        (id) => id !== targetUserId,
      );
      await userDoc.ref.update({
        blockedUsers: updatedBlockedUsers,
        updatedAt: new Date(),
      });

      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({ action: "unblocked" });
    } else {
      const updatedBlockedUsers = [...blockedUsers];
      if (!updatedBlockedUsers.includes(targetUserId)) {
        updatedBlockedUsers.push(targetUserId);
      }

      await userDoc.ref.update({
        blockedUsers: updatedBlockedUsers,
        updatedAt: new Date(),
      });
      const batch = db.batch();

      const forwardFollowQuery = await Follow.where("followerId", "==", userId)
        .where("followingId", "==", targetUserId)
        .get();

      forwardFollowQuery.forEach((doc) => batch.delete(doc.ref));

      const backwardFollowQuery = await Follow.where(
        "followerId",
        "==",
        targetUserId,
      )
        .where("followingId", "==", userId)
        .get();

      backwardFollowQuery.forEach((doc) => batch.delete(doc.ref));

      await batch.commit();

      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({ action: "blocked" });
    }
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    return res.status(500).json({ error: err.message });
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

    const itagQuery = await ITag.where("userId", "==", userId).limit(1).get();

    if (itagQuery.empty) {
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

    const itagDoc = itagQuery.docs[0];
    if (updates && updates.username) {
      const usernameQuery = await ITag.where(
        "username",
        "==",
        updates.username,
      ).get();
      const usernameExists = usernameQuery.docs.some(
        (doc) => doc.id !== itagDoc.id,
      );
      if (usernameExists) {
        return res.status(400).json({
          success: false,
          message: "Username already exists",
        });
      }
    }

    const updatedData = {
      ...updates,
      updatedAt: new Date(),
    };

    await itagDoc.ref.update(updatedData);
    const refreshedDoc = await itagDoc.ref.get();
    const updatedITag = { id: refreshedDoc.id, ...refreshedDoc.data() };

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
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
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

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();

    if (!user.password) {
      const cause = "Password not set for user";
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
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
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

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();
    const sessions = user.sessions || [];
    const originalLength = sessions.length;

    const updatedSessions = sessions.filter(
      (s) => s.deviceId !== deviceIdToRevoke,
    );

    if (updatedSessions.length === originalLength) {
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

    await userDoc.ref.update({
      sessions: updatedSessions,
      updatedAt: new Date(),
    });

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
    const prefsQuery = await userPrefs
      .where("userId", "==", userId)
      .limit(1)
      .get();

    let prefDocRef;
    let existingData = {};

    if (prefsQuery.empty) {
      prefDocRef = UserPrefs.doc();
      existingData = { userId, createdAt: new Date() };
    } else {
      prefDocRef = prefsQuery.docs[0].ref;
      existingData = prefsQuery.docs[0].data();
    }

    const payload = {
      ...updateData,
      updatedAt: new Date(),
    };
    await prefDocRef.set({ ...existingData, ...payload }, { merge: true });
    const refreshedDoc = await prefDocRef.get();
    const updatedPrefs = { id: refreshedDoc.id, ...refreshedDoc.data() };

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

  try {
    const existingQuery = await PhoneNumberVerification.where(
      "phoneNumber",
      "==",
      phoneNumber,
    )
      .limit(1)
      .get();
    const verificationData = {
      phoneNumber,
      code: hashedCode,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      updatedAt: new Date(),
    };

    if (existingQuery.empty) {
      await PhoneNumberVerification.add({
        ...verificationData,
        createdAt: new Date(),
      });
    } else {
      await existingQuery.docs[0].ref.update(verificationData);
    }

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

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();
    let lockoutTimestamp = null;
    if (user.iCashLockoutUntil) {
      lockoutTimestamp = user.iCashLockoutUntil.toDate
        ? user.iCashLockoutUntil.toDate().getTime()
        : new Date(user.iCashLockoutUntil).getTime();
    }

    if (lockoutTimestamp && lockoutTimestamp > Date.now()) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Locked. Try again",
      );
      return res.status(403).json({
        message: `Locked. Try again after ${moment(lockoutTimestamp).format("LT")}`,
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

    if (!user.iCashPin) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "iCash PIN not set",
      );
      return res.status(401).json({ message: "Invalid PIN" });
    }

    const isMatch = await bcrypt.compare(pin, user.iCashPin);
    if (!isMatch) {
      const currentAttempts = (user.iCashAttempts || 0) + 1;
      await addFlag(userId, "FAILED_PIN_ATTEMPT");

      if (currentAttempts >= 5) {
        await userDoc.ref.update({
          isSuspended: true,
          iCashAttempts: 0,
          updatedAt: new Date(),
        });

        await notifyAdmins(
          { role: ["moderator", "super_admin"] },
          {
            notificationId: generateNotificationId("security"),
            category: "security",
            actionType: "ACCOUNT_SUSPENDED_SECURITY",
            payload: { userId, reason: "Excessive failed iCash PIN attempts" },
            senderId: "system",
          },
          false,
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

      await userDoc.ref.update({
        iCashAttempts: currentAttempts,
        updatedAt: new Date(),
      });

      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid PIN.",
      );
      return res.status(401).json({
        message: "Invalid PIN",
        attemptsRemaining: 5 - currentAttempts,
      });
    }

    await userDoc.ref.update({
      iCashAttempts: 0,
      iCashLockoutUntil: null,
      updatedAt: new Date(),
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true });
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
export const icashPinSetup = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "icashPinSetupController";
  const action = "icashPinSetup";
  const { pin } = req.body;
  const userId = req.user.id;

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();

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
    const hashedPin = await bcrypt.hash(pin, salt);

    await userDoc.ref.update({
      iCashPin: hashedPin,
      twoFactorEnabled: true,
      updatedAt: new Date(),
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true, message: "iCash PIN secured." });
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
export const requestIcashPinReset = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "requestIcashPinResetController";
  const action = "requestIcashPinReset";
  const userId = req.user.id;

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await userDoc.ref.update({
      resetPinOTP: otp,
      resetPinOTPExpires: otpExpires,
      updatedAt: new Date(),
    });

    try {
      const htmlContent = icashPinResetTemplate(user.firstname, otp);
      await sendEmail({
        email: user.email,
        subject: "IMPORTANT: iCash PIN Reset Code",
        message: `Your reset code is ${otp}`,
        html: htmlContent,
      });

      logControllerPerformance(controllerName, action, startTime, "success");
      return res
        .status(200)
        .json({ message: "OTP sent to your registered email." });
    } catch (err) {
      await userDoc.ref.update({
        resetPinOTP: null,
        resetPinOTPExpires: null,
        updatedAt: new Date(),
      });

      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Email could not be sent.",
      );
      return res.status(500).json({ message: "Email could not be sent." });
    }
  } catch (error) {
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
export const resetIcashPin = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "resetIcashPinController";
  const action = "resetIcashPin";
  const { otp, newPin } = req.body;
  const userId = req.user.id;

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid or expired OTP.",
      );
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();
    let otpExpiresTime = null;
    if (user.resetPinOTPExpires) {
      otpExpiresTime = user.resetPinOTPExpires.toDate
        ? user.resetPinOTPExpires.toDate().getTime()
        : new Date(user.resetPinOTPExpires).getTime();
    }

    if (
      !user.resetPinOTP ||
      user.resetPinOTP !== otp ||
      !otpExpiresTime ||
      otpExpiresTime <= Date.now()
    ) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid or expired OTP.",
      );
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }

    const suspiciousActivity = user.suspiciousActivity || [];
    if (suspiciousActivity.length > 0) {
      await addFlag(userId, "PIN_RESET_WHILE_SUSPICIOUS");
      if (suspiciousActivity.length > 3) {
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
    const hashedPin = await bcrypt.hash(newPin, salt);

    await userDoc.ref.update({
      iCashPin: hashedPin,
      resetPinOTP: null,
      resetPinOTPExpires: null,
      iCashAttempts: 0,
      updatedAt: new Date(),
    });

    const now = new Date();
    const formattedDate = now.toLocaleDateString();
    const formattedTime = now.toLocaleTimeString();

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
        notificationId: generateNotificationId("security"),
        actionType: "ICASH_PIN_RESET_AUDIT",
        payload: {
          userUid: user.uid,
          userName: `${user.firstname || ""} ${user.lastname || ""}`.trim(),
        },
        senderId: "system",
      },
      false,
    ).catch((err) => console.error("Admin audit notification failed:", err));

    logControllerPerformance(controllerName, action, startTime, "success");
    res
      .status(200)
      .json({ success: true, message: "PIN updated successfully." });
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
export const markNotificationAsRead = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markNotificationAsReadController";
  const action = "markNotificationAsRead";
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    const notificationQuery = await Notification.where(
      "notificationId",
      "==",
      id,
    )
      .where("recipientId", "==", userId)
      .limit(1)
      .get();

    if (notificationQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Notification not found",
      );
      return res.status(404).json({ message: "Notification not found" });
    }

    const notificationDoc = notificationQuery.docs[0];

    await notificationDoc.ref.update({
      isRead: true,
      updatedAt: new Date(),
    });

    const refreshedDoc = await notificationDoc.ref.get();
    const notification = { id: refreshedDoc.id, ...refreshedDoc.data() };

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

    const unreadQuery = await Notification.where("recipientId", "==", userId)
      .where("isRead", "==", false)
      .get();

    if (unreadQuery.empty) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({
        success: true,
        message: "All notifications marked as read",
        modifiedCount: 0,
      });
    }
    const batches = [];
    let currentBatch = db.batch();
    let operationCount = 0;

    unreadQuery.docs.forEach((doc) => {
      currentBatch.update(doc.ref, {
        isRead: true,
        updatedAt: new Date(),
      });
      operationCount++;

      if (operationCount === 500) {
        batches.push(currentBatch.commit());
        currentBatch = db.batch();
        operationCount = 0;
      }
    });

    if (operationCount > 0) {
      batches.push(currentBatch.commit());
    }

    await Promise.all(batches);

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      modifiedCount: unreadQuery.size,
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

    const followQuery = await Follow.where("followerId", "==", followerId)
      .where("followingId", "==", followingId)
      .limit(1)
      .get();

    const targetUserQuery = await User.where("uid", "==", followingId)
      .limit(1)
      .get();
    const targetUserData = !targetUserQuery.empty
      ? targetUserQuery.docs[0].data()
      : null;
    const targetFirstName = targetUserData?.firstname || "User";

    if (!followQuery.empty) {
      await followQuery.docs[0].ref.delete();

      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({
        success: true,
        action: "unfollowed",
        message: `Unfollowed ${targetFirstName} successfully`,
      });
    } else {
      await Follow.add({
        followerId,
        followingId,
        createdAt: new Date(),
      });

      const followerUserQuery = await User.where("uid", "==", followerId)
        .limit(1)
        .get();
      const followerUserData = !followerUserQuery.empty
        ? followerUserQuery.docs[0].data()
        : null;
      const followerName = followerUserData
        ? followerUserData.firstname
        : "Someone";

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
        message: `Followed ${targetFirstName} successfully`,
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
      }, {});

    const userQuery = await User.where("uid", "==", userId).limit(1).get();

    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];

    const payload = {
      ...filteredUpdates,
      updatedAt: new Date(),
    };

    await userDoc.ref.set(payload, { merge: true });
    const refreshedDoc = await userDoc.ref.get();
    const userData = refreshedDoc.data();

    const {
      resetPinOTP,
      resetPinOTPExpires,
      iCashPin,
      password,
      refreshTokens,
      ...sanitizedUser
    } = userData;

    const updatedUser = { id: refreshedDoc.id, ...sanitizedUser };

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
    const downloadsQuery = await UserDownloads.where("userId", "==", userId)
      .limit(1)
      .get();

    if (downloadsQuery.empty) {
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

    const docRef = downloadsQuery.docs[0].ref;
    const data = downloadsQuery.docs[0].data();
    const ownedProducts = data.ownedProducts || [];

    const productIndex = ownedProducts.findIndex(
      (p) => p.productId === productId,
    );

    if (productIndex === -1) {
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
    ownedProducts[productIndex] = {
      ...ownedProducts[productIndex],
      progress,
      completedLessons,
      lastWatched,
    };

    await docRef.update({
      ownedProducts,
      lastAccessed: new Date(),
      updatedAt: new Date(),
    });

    const refreshedDoc = await docRef.get();
    const updatedUserDownloads = {
      id: refreshedDoc.id,
      ...refreshedDoc.data(),
    };

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
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};
export const verifyiTagUsernameAvailability = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyiTagUsernameAvailabilityController";
  const action = "verifyiTagUsernameAvailability";
  try {
    const { val } = req.params;
    const itagQuery = await ITag.where("username", "==", val).limit(1).get();

    if (itagQuery.empty) {
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
      const userQuery = await User.where("uid", "==", userId).limit(1).get();

      if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        const monthlyStats = userData.monthlyStats || {};
        const lastAccess = monthlyStats.lastLibraryAccess;

        let lastAccessTime = null;
        if (lastAccess) {
          lastAccessTime = lastAccess.toDate
            ? lastAccess.toDate().getTime()
            : new Date(lastAccess).getTime();
        }

        const isNewSession =
          !lastAccessTime || today.getTime() - lastAccessTime > 1000 * 60 * 60;

        const libraryUsageSessions =
          (monthlyStats.libraryUsageSessions || 0) + (isNewSession ? 1 : 0);
        const booksFound = (monthlyStats.booksFound || 0) + 1;

        await userDoc.ref.update({
          "monthlyStats.libraryUsageSessions": libraryUsageSessions,
          "monthlyStats.booksFound": booksFound,
          "monthlyStats.lastLibraryAccess": today,
          updatedAt: new Date(),
        });
      }
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

  const isAdmin =
    viewerRole === "admin";

  try {
    let users = [];

    if (uid) {
      const userQuery = await User.where("uid", "==", uid).limit(1).get();
      if (!userQuery.empty) {
        users.push({ id: userQuery.docs[0].id, ...userQuery.docs[0].data() });
      }
    } else if (q) {
      const snapshot = await User.get();
      const searchTerm = q.toLowerCase();

      snapshot.forEach((doc) => {
        const data = doc.data();
        const firstname = (data.firstname || "").toLowerCase();
        const lastname = (data.lastname || "").toLowerCase();
        const username = (data.username || "").toLowerCase();

        let isMatch =
          firstname.includes(searchTerm) ||
          lastname.includes(searchTerm) ||
          username.includes(searchTerm);

        if (isAdmin && !isMatch) {
          const userUid = (data.uid || "").toLowerCase();
          const itagusername = (data.itagusername || "").toLowerCase();
          const schoolCode = (data.schoolCode || "").toLowerCase();
          const email = (data.email || "").toLowerCase();
          const department = (data.department || "").toLowerCase();
          const matricNumber = (data.matricNumber || "").toLowerCase();
          const staffId = (data.staffId || "").toLowerCase();

          isMatch =
            userUid.includes(searchTerm) ||
            itagusername.includes(searchTerm) ||
            schoolCode.includes(searchTerm) ||
            email.includes(searchTerm) ||
            department.includes(searchTerm) ||
            matricNumber.includes(searchTerm) ||
            staffId.includes(searchTerm);
        }

        if (isMatch) {
          users.push({ id: doc.id, ...data });
        }
      });
      users = users.slice(0, 20);
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
        email: u.email,
        username: u.username,
        lastname: u.lastname,
        profilePic: u.profilePic,
        usertype: u.usertype,
        tier: u.tier,
        isVerified: u.isVerified,
        organizationName: u.organizationName || "",
        displayScore:
          isEnterprise || isPro ? Math.round(u.currentIScore || 0) : "Locked",
        bio: isAdmin ? u.bio : "",
        pointsBalance: isAdmin ? u.pointsBalance : "",
        pendingSalesBalance: isAdmin ? u.pendingSalesBalance : "",
        website: isAdmin ? u.website : "",
        headline: isAdmin ? u.headline : "",
        department: isAdmin ? u.department : "",
        staffId: isAdmin ? u.staffId : "",
        matricNumber: isAdmin ? u.matricNumber : "",
        itagusername: isAdmin ? u.itagusername : "",
        schoolName: isAdmin ? u.schoolName : "",
        country: isAdmin ? u.country : "",
        current_level: isAdmin ? u.current_level : "",
        isSuspended: isAdmin ? u.isSuspended : "",
        twoFactorEnabled: isAdmin ? u.twoFactorEnabled : "",
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
};;
export const checkAccountState = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "checkAccountStateController";
  const action = "checkAccountState";
  try {
    const userQuery = await User.where("uid", "==", req.user.uid)
      .limit(1)
      .get();
    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const user = userQuery.docs[0].data();

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      user: {
        uid: user.uid,
        isSuspended: user.isSuspended || false,
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

    const searchTerm = searchQuery.toLowerCase().trim();
    const institutionalSnapshot = await Course.get();
    const institutionalCourses = [];

    institutionalSnapshot.forEach((doc) => {
      const data = doc.data();
      const courseTitle = (data.courseTitle || "").toLowerCase();
      const courseCode = (data.courseCode || "").toLowerCase();
      const department = (data.department || "").toLowerCase();

      if (
        courseTitle.includes(searchTerm) ||
        courseCode.includes(searchTerm) ||
        department.includes(searchTerm)
      ) {
        institutionalCourses.push({ id: doc.id, ...data });
      }
    });

    const limitedInstitutional = institutionalCourses.slice(0, 25);
    const allLecturerUids = [
      ...new Set(
        limitedInstitutional
          .map((course) => course.lecturerIds?.[course.lecturerIds.length - 1])
          .filter(Boolean),
      ),
    ];

    let lecturerMap = {};
    if (allLecturerUids.length > 0) {
      const chunks = [];
      for (let i = 0; i < allLecturerUids.length; i += 30) {
        chunks.push(allLecturerUids.slice(i, i + 30));
      }

      for (const chunk of chunks) {
        const lecturerSnapshot = await User.where("uid", "in", chunk).get();
        lecturerSnapshot.forEach((doc) => {
          const user = doc.data();
          lecturerMap[user.uid] =
            `${user.firstname || ""} ${user.lastname || ""}`.trim();
        });
      }
    }

    const normalizedInstitutional = limitedInstitutional.map((course) => {
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
    const productSnapshot = await Product.where("type", "==", "course").get();
    const marketplaceCourses = [];

    productSnapshot.forEach((doc) => {
      const data = doc.data();
      const title = (data.title || "").toLowerCase();
      const description = (data.description || "").toLowerCase();
      const category = (data.category || "").toLowerCase();

      if (
        title.includes(searchTerm) ||
        description.includes(searchTerm) ||
        category.includes(searchTerm)
      ) {
        marketplaceCourses.push({ id: doc.id, ...data });
      }
    });

    const limitedMarketplace = marketplaceCourses.slice(0, 25);
    const normalizedPremium = await Promise.all(
      limitedMarketplace.map(async (product) => {
        let instructorNames = "Instructor";
        const lecturerUids = product.courseDetails?.lecturerIds || [];

        if (lecturerUids.length > 0) {
          const discoveredUsers = [];
          const chunks = [];
          for (let i = 0; i < lecturerUids.length; i += 30) {
            chunks.push(lecturerUids.slice(i, i + 30));
          }

          for (const chunk of chunks) {
            const userSnapshot = await User.where("uid", "in", chunk).get();
            userSnapshot.forEach((doc) => {
              discoveredUsers.push(doc.data());
            });
          }

          if (discoveredUsers.length > 0) {
            instructorNames = discoveredUsers
              .map((u) => `${u.firstname || ""} ${u.lastname || ""}`.trim())
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

    const searchTerm = searchQuery.toLowerCase().trim();
    const institutionalSnapshot = await Course.get();
    const institutionalMatches = [];

    institutionalSnapshot.forEach((doc) => {
      const data = doc.data();
      const courseTitle = (data.courseTitle || "").toLowerCase();
      const courseCode = (data.courseCode || "").toLowerCase();
      const resources = data.resources || [];
      const hasMatchingResource = resources.some((url) => {
        const rawFileName = url.split("/").pop() || "";
        const cleanedFileName = decodeURIComponent(rawFileName)
          .split("?")[0]
          .toLowerCase();
        return cleanedFileName.includes(searchTerm);
      });

      if (
        courseTitle.includes(searchTerm) ||
        courseCode.includes(searchTerm) ||
        hasMatchingResource
      ) {
        institutionalMatches.push({ id: doc.id, ...data });
      }
    });

    const limitedInstitutional = institutionalMatches.slice(0, 30);
    const normalizedInstitutional = [];

    limitedInstitutional.forEach((course) => {
      const resources = course.resources || [];
      if (resources.length === 0) return;

      const courseTitle = course.courseTitle || "";
      const courseCode = course.courseCode || "";

      resources.forEach((url) => {
        const rawFileName = url.split("/").pop() || "Untitled Material";
        const cleanedFileName = decodeURIComponent(rawFileName).split("?")[0];

        const matchesQuery =
          courseTitle.toLowerCase().includes(searchTerm) ||
          courseCode.toLowerCase().includes(searchTerm) ||
          cleanedFileName.toLowerCase().includes(searchTerm);

        if (matchesQuery) {
          const base64Hash = Buffer.from(url)
            .toString("base64")
            .substring(0, 8);
          normalizedInstitutional.push({
            id: `${course.courseId || course.id}-${base64Hash}`,
            title: cleanedFileName.split("-").pop() || cleanedFileName,
            url: url,
            format: url.split(".").pop()?.split("?")[0]?.toLowerCase() || "pdf",
            isPremiumPaid: false,
            price: 0,
            metaSource: `${courseCode} • Institutional`,
            courseId: course.courseId || course.id,
          });
        }
      });
    });
    const productSnapshot = await Product.where("type", "==", "file")
      .where("isAvailable", "==", true)
      .get();

    const marketplaceFiles = [];

    productSnapshot.forEach((doc) => {
      const data = doc.data();
      const title = (data.title || "").toLowerCase();
      const description = (data.description || "").toLowerCase();
      const category = (data.category || "").toLowerCase();
      const fileName = (data.fileDetails?.fileName || "").toLowerCase();

      if (
        title.includes(searchTerm) ||
        description.includes(searchTerm) ||
        category.includes(searchTerm) ||
        fileName.includes(searchTerm)
      ) {
        marketplaceFiles.push({ id: doc.id, ...data });
      }
    });

    const limitedMarketplace = marketplaceFiles.slice(0, 25);

    const normalizedPremium = limitedMarketplace.map((product) => {
      return {
        id: product.productId || product.id,
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

    const userId = req.user.uid;
    const prefQuery = await userPrefs
      .where("userId", "==", userId)
      .limit(1)
      .get();

    const preferenceData = {
      theme,
      updatedAt: new Date(),
    };

    if (prefQuery.empty) {
      preferenceData.createdAt = new Date();
      await UserPrefs.add({
        userId,
        ...preferenceData,
      });
    } else {
      await prefQuery.docs[0].ref.update(preferenceData);
    }

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

    const [userQuery, prefQuery] = await Promise.all([
      User.where("uid", "==", uid).limit(1).get(),
      userPrefs.where("uid", "==", uid).limit(1).get(),
    ]);

    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();

    const { password, iCashPin, userAccountDetails, ...safeUserData } =
      userData;

    let theme = "light";
    if (!prefQuery.empty) {
      const prefData = prefQuery.docs[0].data();
      if (prefData.theme) {
        theme = prefData.theme;
      }
    }

    const safeUser = {
      id: userDoc.id,
      ...safeUserData,
      theme,
    };
    const { accessToken, refreshToken } = await generateTokens({
      uid,
      ...userData,
    });

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
        ...(history || []),
      ],
    });

    const result = await chat.sendMessage(message);
    const replyText = result.response.text();
    let finalReply;
    let aiResponse;
    const ticketRefId = generateTicketId(uid);
    let createdTicketId = null;

    try {
      aiResponse = JSON.parse(replyText);
    } catch (e) {
      aiResponse = { reply: replyText, requiresEscalation: false };
    }

    if (aiResponse.requiresEscalation) {
      const newTicket = {
        userId: uid,
        originalMessage: message,
        status: "open",
        ticketRefId,
        summary: aiResponse.suggestedSummary || "AI could not resolve query",
        category: aiResponse.suggestedCategory || "other",
        severity: aiResponse.suggestedSeverity || "medium",
        thread: [{ sender: "user", message: message }],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ticketDocRef = await SupportTicket.add(newTicket);
      createdTicketId = ticketRefId;

      finalReply = aiResponse.reply + `\n\nTicket ID: ${ticketRefId}`;

      await notifyAdmins(
        { role: ["support", "super_admin"] },
        {
          notificationId: generateNotificationId("system"),
          actionType: "AI_SUPPORT_ESCALATION",
          payload: {
            ticketId: ticketRefId,
            userUid: uid,
            summary: newTicket.summary,
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
      const userQuery = await User.where("uid", "==", uid).limit(1).get();
      if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        const monthlyStats = userData.monthlyStats || {};
        const aiQueries = (monthlyStats.aiQueries || 0) + 1;

        await userDoc.ref.update({
          "monthlyStats.aiQueries": aiQueries,
          updatedAt: new Date(),
        });
      }
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ reply: finalReply, ticketId: createdTicketId });
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
    const userId = req.user?.id || req.user?.uid;

    if (!searchQuery || searchQuery.trim().length < 2) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({ success: true, posts: [] });
    }

    const searchTerm = searchQuery.toLowerCase().trim();
    const postsSnapshot = await Posts.get();
    const matchedPosts = [];
    const commentsSnapshot = await Comments.get();
    const allComments = commentsSnapshot.docs.map((doc) => doc.data());

    const repostersSnapshot = await PostReposters.get();
    const allReposters = repostersSnapshot.docs.map((doc) => doc.data());

    postsSnapshot.forEach((doc) => {
      const data = doc.data();
      const postId = data.postId;

      const content = (data.content || "").toLowerCase();
      const comments = allComments.filter((c) => c.postId === postId);
      const jobTitle = (data.jobMetadata?.title || "").toLowerCase();
      const jobCompany = (data.jobMetadata?.company || "").toLowerCase();
      const eventTitle = (data.eventMetadata?.title || "").toLowerCase();

      const hasMatchingComment = comments.some((c) =>
        (c.comment || "").toLowerCase().includes(searchTerm),
      );

      if (
        content.includes(searchTerm) ||
        hasMatchingComment ||
        jobTitle.includes(searchTerm) ||
        jobCompany.includes(searchTerm) ||
        eventTitle.includes(searchTerm)
      ) {
        const repostersDetails = allReposters.filter(
          (r) => r.postId === postId,
        );
        matchedPosts.push({ id: doc.id, ...data, comments, repostersDetails });
      }
    });

    matchedPosts.sort((a, b) => {
      const timeA = a.createdAt?.toDate
        ? a.createdAt.toDate().getTime()
        : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toDate
        ? b.createdAt.toDate().getTime()
        : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    const limitedPosts = matchedPosts.slice(0, 40);

    const formattedPosts = await Promise.all(
      limitedPosts.map(async (post) => {
        const targetPostId = post.postId || post.id;
        const commentsSnapshot = await Comments.where(
          "postId",
          "==",
          targetPostId,
        ).get();
        const comments = [];
        for (const doc of commentsSnapshot.docs) {
          const commentData = doc.data();
          let commentUser = null;
          if (commentData.userId) {
            const commentUserQuery = await User.where(
              "uid",
              "==",
              commentData.userId,
            )
              .limit(1)
              .get();
            if (!commentUserQuery.empty) {
              const cuData = commentUserQuery.docs[0].data();
              commentUser = {
                uid: cuData.uid,
                firstname: cuData.firstname,
                lastname: cuData.lastname,
                username: cuData.username,
                profilePic: cuData.profilePic,
              };
            }
          }
          comments.push({
            ...commentData,
            userId: commentUser || commentData.userId,
          });
        }
        const commentsCount = commentsSnapshot.size;

        const featuredReposter =
          typeof getPriorityReposter === "function"
            ? await getPriorityReposter(post.repostersDetails || [], userId)
            : null;

        return {
          ...post,
          comments,
          commentsCount,
          repostsCount:
            post.repostsCount !== undefined
              ? post.repostsCount
              : (post.repostersDetails || []).length,
          featuredReposter,
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
    const preparedData = prepareLectureData(req.body);
    const {
      date,
      startTime: meetingStartTime,
      endTime,
      topicName,
      lectureType,
      location,
    } = preparedData;
    const hostId = req.user.uid;
    const lecturesQuery = await Lectures.where("hostId", "==", hostId)
      .where("date", "==", date)
      .get();

    let conflict = null;
    lecturesQuery.forEach((doc) => {
      const data = doc.data();
      if (data.startTime < endTime && data.endTime > meetingStartTime) {
        conflict = data;
      }
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

    const meetingId = generateLectureId(hostId, lectureType);
    const newMeeting = {
      id: meetingId,
      hostId,
      topicName,
      date,
      startTime: meetingStartTime,
      endTime,
      lectureType,
      location,
      status: "scheduled",
      isTaught: false,
      attendance: [],
      courseId: null,
      department: null,
      level: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await Lectures.doc(meetingId).set(newMeeting);

    const readableDate = new Date(date).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const message = `Your online class session '${topicName}' is set for ${readableDate} at ${meetingStartTime}. Click here to join: ${location}`;

    await createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: hostId,
      category: "classroom",
      actionType: "CLASS_SCHEDULED",
      title: "Class Scheduled",
      message,
      payload: {
        topicName,
        lectureId: meetingId,
        location,
        time: meetingStartTime,
        date: readableDate,
      },
      entityId: meetingId,
      entityType: "lecture",
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    });

    const userQuery = await User.where("uid", "==", hostId).limit(1).get();
    if (!userQuery.empty) {
      const userDoc = userQuery.docs[0];
      const userData = userDoc.data();
      const monthlyStats = userData.monthlyStats || {};
      const minutesActive = (monthlyStats.minutesActive || 0) + 15;
      const aiQueries = (monthlyStats.aiQueries || 0) + 2;

      await userDoc.ref.update({
        "monthlyStats.minutesActive": minutesActive,
        "monthlyStats.aiQueries": aiQueries,
        updatedAt: new Date(),
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(201).json({
      message: "Meeting scheduled successfully",
      meeting: newMeeting,
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
export const registerDropOffStation = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "registerDropOffStationController";
  const action = "registerDropOffStation";
  const { name, address, images, latitude, longitude } = req.body;
  const userId = req.user.id || req.user.uid;

  try {
    const stationId = generateStationId();
    const newRequest = {
      id: stationId,
      userId,
      name,
      address,
      images,
      latitude,
      longitude,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await DropOffStation.doc(stationId).set(newRequest);

    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: userId,
      category: "store",
      actionType: "STATION_REQUEST_RECEIVED",
      title: "Drop-off Station Registeration Request Received",
      message:
        "Your drop-off station request has been received and is under review. Expect a reply within 5 days.",
      payload: {
        requestId: stationId,
        address: newRequest.address,
      },
    });

    const ticketRefId = generateTicketId(userId);
    const newTicket = {
      userId,
      ticketRefId,
      source: "in-app",
      category: "technical",
      summary: `New Station Registration: ${name}`,
      originalMessage: `User ${userId} requests to register drop-off station ${name} at ${address} with coordinates: ${latitude} ${longitude}.`,
      severity: "high",
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await SupportTicket.add(newTicket);

    await notifyAdmins(
      { role: ["super_admin", "moderator"] },
      {
        notificationId: generateNotificationId("store"),
        actionType: "NEW_STATION_REGISTRATION",
        title: "New Station Request",
        message: `New drop-off station "${name}" submitted by user ${userId}.`,
        payload: { ticketRefId, requestId: stationId, name, userId },
      },
      true,
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res
      .status(201)
      .json({ success: true, message: "Request submitted successfully" });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ success: false, message: "Server error" });
  }
};