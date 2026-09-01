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
import { setImmediate } from "timers";
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
import {
  USD_EQUIVALENCE_OF_1_ICASH,
  EXCEPTION_ACCOUNT_LIMITS,
} from "../constants/inAppConstants.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
axiosRetry(axios, { retries: 3 });

const FAQ_DATA = [
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
    answer: `iCash operates on a fixed exchange rate where 1 iCash equals exactly ${USD_EQUIVALENCE_OF_1_ICASH} USD (or its equivalent value in your local currency). Local currency inputs are automatically converted at the prevailing market rate into USD before iCash is issued.`,
  },
  {
    id: "acad-2",
    question: "How many free Lecture Exceptions do I get each month?",
    answer: `Your monthly allotment depends on your subscription tier:\n Free Tier: ${EXCEPTION_ACCOUNT_LIMITS.free} free exception per month.\n• Pro Tier: ${EXCEPTION_ACCOUNT_LIMITS.pro} free exceptions per month.\n• Premium Tier: ${EXCEPTION_ACCOUNT_LIMITS.premium} free exceptions per month.`,
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
      "iCampus supports two distinct types of lecture formats:\n1. Online sessions\n2. Physical classroom sessions",
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
    let reviewerId = req.user?.uid || req.user?.id;
    if (!reviewerId) {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : req.body?.token;

      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          reviewerId = decoded.id || decoded.uid;
        } catch (err) {
          setImmediate(() => {
            logControllerPerformance(
              controllerName,
              action,
              startTime,
              "error",
              "Invalid or expired authentication token",
            );
          });
          return res.status(401).json({
            success: false,
            message: "Expired or invalid authentication token.",
          });
        }
      }
    }

    if (!reviewerId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthenticated review submission",
        );
      });
      return res.status(401).json({
        success: false,
        message: "Authentication required to submit a review.",
      });
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

    if (!targetId || !targetType || rating === undefined || rating === null) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing required tracking metrics",
        );
      });
      return res.status(400).json({
        success: false,
        message: "Missing required fields: targetId, targetType, and rating.",
      });
    }

    const numericRating = Number(rating);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid rating score",
        );
      });
      return res.status(400).json({
        success: false,
        message: "Rating must be a valid number between 1 and 5.",
      });
    }

    let parsedMediaUrls = [];
    if (mediaUrls) {
      try {
        parsedMediaUrls =
          typeof mediaUrls === "string" ? JSON.parse(mediaUrls) : mediaUrls;
        if (!Array.isArray(parsedMediaUrls))
          parsedMediaUrls = [parsedMediaUrls];
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
          accuracy: rawAttrs?.accuracy ? Number(rawAttrs.accuracy) : undefined,
          deliverySpeed: rawAttrs?.deliverySpeed
            ? Number(rawAttrs.deliverySpeed)
            : undefined,
          clarity: rawAttrs?.clarity ? Number(rawAttrs.clarity) : undefined,
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
      rating: numericRating,
      comment: comment ? comment.trim() : "",
      mediaUrls: parsedMediaUrls,
      attributes: parsedAttributes,
      createdAt: new Date(),
    };

    await newReviewDocRef.set(reviewData);

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    return res.status(200).json({
      success: true,
      message: "Reviews validation metrics published successfully.",
      reviewId: newReviewDocRef.id,
    });
  } catch (error) {
    console.error(
      "Global crash layer hit in createReviewController:",
      error.message,
    );
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
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
    const userId = req.user?.uid || req.user?.id;
    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

    if (!newPassword || newPassword.length < 6) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid password format",
        );
      });
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }
    const [querySnapshot, hashedPassword] = await Promise.all([
      User.where("uid", "==", userId).limit(1).get(),
      bcrypt.hash(newPassword, 10),
    ]);

    if (querySnapshot.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDocRef = querySnapshot.docs[0].ref;
    const user = querySnapshot.docs[0].data();

    const now = new Date();
    const formattedTime = `${now.toLocaleDateString()} at ${now.toLocaleTimeString()}`;

    const passwordUpdatePromise = userDocRef.update({
      password: hashedPassword,
      updatedAt: now,
    });

    const notificationPromise = createNotification({
      notificationId: generateNotificationId("auth"),
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
    }).catch((err) => console.error("Notification dispatch failed:", err));

    await Promise.all([passwordUpdatePromise, notificationPromise]);

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });

    return res
      .status(200)
      .json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Error in createNewPasswordInApp:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res
      .status(500)
      .json({ success: false, message: "Could not update password" });
  }
};
export const deleteAccount = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteAccountController";
  const action = "deleteAccount";

  try {
    const userUid = req.user?.id || req.user?.uid;
    const { reason } = req.body;

    if (!userUid) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ status: false, message: "Unauthorized user context." });
    }
    const [
      userQuery,
      prefsQuery,
      bankCardsQuery,
      itagQuery,
      followsAsFollower,
      followsAsFollowing,
      enrolledCoursesQuery,
      lecturerCoursesQuery,
      postsQuery,
      postRepostersQuery,
      commentsQuery,
      repostsAsUserQuery,
    ] = await Promise.all([
      User.where("uid", "==", userUid).limit(1).get(),
      userPrefs.where("userId", "==", userUid).get(),
      UserBankOrCardDetails.where("userId", "==", userUid).get(),
      ITag.where("userId", "==", userUid).get(),
      Follow.where("followerId", "==", userUid).get(),
      Follow.where("followingId", "==", userUid).get(),
      Course.where("studentsEnrolled", "array-contains", userUid).get(),
      Course.where("lecturerIds", "array-contains", userUid).get(),
      Posts.where("originalAuthor", "==", userUid).get(),
      PostReposters.where("uid", "==", userUid).get(),
      Comments.where("userId", "==", userUid).get(),
      PostReposters.where("userId", "==", userUid).get(),
    ]);

    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res.status(404).json({ status: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();
    const createdAtDate = user.createdAt?.toDate
      ? user.createdAt.toDate()
      : new Date(user.createdAt || Date.now());
    const accountAgeDays = Math.floor(
      (Date.now() - createdAtDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    const operations = [];
    operations.push({
      type: "set",
      ref: DeletedUser.doc(),
      data: {
        uid: userUid,
        reason: reason || "N/A",
        accountAgeDays,
        tierAtDeletion: user.tier || "standard",
        finalBalance: user.balance || 0,
        deletedAt: new Date(),
      },
    });
    operations.push({ type: "delete", ref: userDoc.ref });

    const collectDeletes = (snapshot) => {
      snapshot.forEach((doc) =>
        operations.push({ type: "delete", ref: doc.ref }),
      );
    };

    collectDeletes(prefsQuery);
    collectDeletes(bankCardsQuery);
    collectDeletes(itagQuery);
    collectDeletes(followsAsFollower);
    collectDeletes(followsAsFollowing);
    collectDeletes(postsQuery);
    collectDeletes(postRepostersQuery);
    collectDeletes(commentsQuery);
    collectDeletes(repostsAsUserQuery);

    enrolledCoursesQuery.forEach((doc) => {
      const currentList = doc.data().studentsEnrolled || [];
      operations.push({
        type: "update",
        ref: doc.ref,
        data: { studentsEnrolled: currentList.filter((id) => id !== userUid) },
      });
    });

    lecturerCoursesQuery.forEach((doc) => {
      const currentList = doc.data().lecturerIds || [];
      operations.push({
        type: "update",
        ref: doc.ref,
        data: { lecturerIds: currentList.filter((id) => id !== userUid) },
      });
    });
    const CHUNK_SIZE = 450;
    const batchPromises = [];
    for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
      const chunk = operations.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();

      chunk.forEach((op) => {
        if (op.type === "set") batch.set(op.ref, op.data);
        else if (op.type === "delete") batch.delete(op.ref);
        else if (op.type === "update") batch.update(op.ref, op.data);
      });

      batchPromises.push(batch.commit());
    }

    await Promise.all(batchPromises);
    res
      .status(200)
      .json({ status: true, message: "Account deleted successfully." });
    setImmediate(async () => {
      try {
        await notifyAdmins(
          { role: ["super_admin", "support"] },
          {
            notificationId: generateNotificationId("profile"),
            category: "profile",
            message: `User ${userUid} has permanently deleted their account. Reason provided: ${reason || "None"}.`,
            actionType: "ACCOUNT_DELETION_ADMIN_ALERT",
            title: "User Account Deletion",
            payload: { userUid, reason },
            senderId: "system",
          },
          false,
        );
        logControllerPerformance(controllerName, action, startTime, "success");
      } catch (bgErr) {
        console.error(
          "Background deletion cleanup logging/alerts failed:",
          bgErr,
        );
      }
    });
  } catch (error) {
    console.error("Account Deletion Cleanup Failed:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res
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

    const [verificationQuery, userQuery] = await Promise.all([
      PhoneNumberVerification.where("phoneNumber", "==", phoneNumber)
        .where("code", "==", hashedInput)
        .limit(1)
        .get(),
      User.where("uid", "==", req.user.id).limit(1).get(),
    ]);

    if (verificationQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid or expired code",
        );
      });
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res.status(404).json({ message: "User not found" });
    }

    const verificationDoc = verificationQuery.docs[0];
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
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Phone number not registered to user",
        );
      });
      return res
        .status(404)
        .json({ message: "Phone number not found in user records" });
    }
    await Promise.all([
      userDoc.ref.update({
        phoneNumbers: updatedPhoneNumbers,
        updatedAt: new Date(),
      }),
      verificationDoc.ref.delete(),
    ]);
    res.status(200).json({
      success: true,
      message: "Phone verified!",
      phoneNumbers: updatedPhoneNumbers,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in verifyPhoneNumberOTP:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
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
  const userUid = req.user?.uid || req.user?.id;

  if (!userUid) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ message: "Unauthorized user context.", success: false });
  }

  if (type !== "primary" && type !== "secondary") {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid update type",
      );
    });
    return res
      .status(400)
      .json({ message: "Invalid update type", success: false });
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid email format",
      );
    });
    return res.status(400).json({
      message: "Please provide a valid email address.",
      success: false,
    });
  }

  try {
    const userQuery = await User.where("uid", "==", userUid).limit(1).get();

    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ message: "User not found", success: false });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const sanitizedEmail = email.trim().toLowerCase();

    if (type === "primary") {
      await userDoc.ref.update({
        email: sanitizedEmail,
        updatedAt: new Date(),
      });
    } else if (type === "secondary") {
      const recoveryEmails = userData.recoveryEmails || [];
      const emailExists = recoveryEmails.some(
        (rec) => rec.email.toLowerCase() === sanitizedEmail,
      );

      if (!emailExists) {
        recoveryEmails.push({
          email: sanitizedEmail,
          isVerified: true,
          addedAt: new Date(),
        });

        await userDoc.ref.update({
          recoveryEmails: recoveryEmails,
          updatedAt: new Date(),
        });
      }
    }
    res.status(200).json({
      message: `${type === "primary" ? "Primary" : "Recovery"} email updated successfully.`,
      success: true,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in updateEmails:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
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
  const userUid = req.user?.uid || req.user?.id;

  if (!userUid) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized user context." });
  }

  if (!emailToDelete || typeof emailToDelete !== "string") {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid or missing email to delete",
      );
    });
    return res.status(400).json({
      success: false,
      message: "Please provide a valid recovery email to delete.",
    });
  }

  try {
    const userQuery = await User.where("uid", "==", userUid).limit(1).get();

    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const recoveryEmails = userData.recoveryEmails || [];
    const targetEmailLower = emailToDelete.trim().toLowerCase();

    const initialLength = recoveryEmails.length;
    const updatedRecoveryEmails = recoveryEmails.filter(
      (rec) => rec.email.toLowerCase() !== targetEmailLower,
    );

    if (updatedRecoveryEmails.length === initialLength) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Recovery email not found in records",
        );
      });
      return res.status(404).json({
        success: false,
        message: "Recovery email not found in records.",
      });
    }

    await userDoc.ref.update({
      recoveryEmails: updatedRecoveryEmails,
      updatedAt: new Date(),
    });
    res.status(200).json({
      success: true,
      message: "Recovery email deleted successfully.",
      recoveryEmails: updatedRecoveryEmails,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in deleteRecoveryEmail:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({
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
    const userUid = req.user?.uid || req.user?.id;

    if (!userUid) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

    if (!phoneNumber || typeof phoneNumber !== "string") {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Phone number is required",
        );
      });
      return res
        .status(400)
        .json({ success: false, message: "Phone number is required" });
    }

    const userQuery = await User.where("uid", "==", userUid).limit(1).get();

    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const phoneNumbers = userData.phoneNumbers || [];
    const targetPhone = phoneNumber.trim();

    const initialLength = phoneNumbers.length;
    const updatedPhoneNumbers = phoneNumbers.filter(
      (phone) => phone.number !== targetPhone,
    );

    if (updatedPhoneNumbers.length === initialLength) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Phone number not found in records",
        );
      });
      return res.status(404).json({
        success: false,
        message: "Phone number not found in user records.",
      });
    }

    await userDoc.ref.update({
      phoneNumbers: updatedPhoneNumbers,
      updatedAt: new Date(),
    });
    res.status(200).json({
      success: true,
      message: "Phone number deleted successfully",
      phoneNumbers: updatedPhoneNumbers,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Delete phone error:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const toggleBlockedUsers = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleBlockUsersController";
  const action = "toggleBlockUsers";
  const { targetUserId, targetUid } = req.body;
  const resolvedTargetId = targetUserId || targetUid;
  const userId = req.user?.uid || req.user?.id;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, error: "Unauthorized user context." });
  }

  if (!resolvedTargetId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Target user ID is required",
      );
    });
    return res
      .status(400)
      .json({ success: false, error: "Target user ID is required" });
  }

  if (userId === resolvedTargetId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Self-blocking attempted",
      );
    });
    return res
      .status(400)
      .json({ success: false, error: "You cannot block yourself." });
  }

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const blockedUsers = userData.blockedUsers || [];
    const isBlocked = blockedUsers.includes(resolvedTargetId);

    if (isBlocked) {
      const updatedBlockedUsers = blockedUsers.filter(
        (id) => id !== resolvedTargetId,
      );
      await userDoc.ref.update({
        blockedUsers: updatedBlockedUsers,
        updatedAt: new Date(),
      });

      res.status(200).json({ success: true, action: "unblocked" });
      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
    } else {
      const updatedBlockedUsers = [...blockedUsers];
      if (!updatedBlockedUsers.includes(resolvedTargetId)) {
        updatedBlockedUsers.push(resolvedTargetId);
      }

      const updatePromise = userDoc.ref.update({
        blockedUsers: updatedBlockedUsers,
        updatedAt: new Date(),
      });
      const [forwardFollowQuery, backwardFollowQuery] = await Promise.all([
        Follow.where("followerId", "==", userId)
          .where("followingId", "==", resolvedTargetId)
          .get(),
        Follow.where("followerId", "==", resolvedTargetId)
          .where("followingId", "==", userId)
          .get(),
        updatePromise,
      ]);

      const batch = db.batch();
      forwardFollowQuery.forEach((doc) => batch.delete(doc.ref));
      backwardFollowQuery.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      res.status(200).json({ success: true, action: "blocked" });
      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
    }
  } catch (err) {
    console.error("Error in toggleBlockedUsers:", err);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      );
    });
    return res.status(500).json({ success: false, error: err.message });
  }
};
export const customizeItag = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "customizeItagController";
  const action = "customizeItag";

  try {
    const userId = req.user?.uid || req.user?.id;
    const { updates } = req.body;

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User ID is required",
        );
      });
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    if (!updates || typeof updates !== "object") {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid or missing update payload",
        );
      });
      return res.status(400).json({
        success: false,
        message: "Valid updates payload is required.",
      });
    }

    const sanitizedUsername = updates.username
      ? updates.username.trim().toLowerCase()
      : null;
    const [itagQuery, usernameQuery] = await Promise.all([
      ITag.where("userId", "==", userId).limit(1).get(),
      sanitizedUsername
        ? ITag.where("username", "==", sanitizedUsername).get()
        : Promise.resolve(null),
    ]);

    if (itagQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "iTag not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "iTag not found" });
    }

    const itagDoc = itagQuery.docs[0];

    if (usernameQuery && !usernameQuery.empty) {
      const usernameExists = usernameQuery.docs.some(
        (doc) => doc.id !== itagDoc.id,
      );
      if (usernameExists) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Username already exists",
          );
        });
        return res
          .status(400)
          .json({ success: false, message: "Username already exists" });
      }
    }

    const processedUpdates = {
      ...updates,
      ...(sanitizedUsername ? { username: sanitizedUsername } : {}),
      updatedAt: new Date(),
    };

    await itagDoc.ref.update(processedUpdates);
    const updatedITag = {
      id: itagDoc.id,
      ...itagDoc.data(),
      ...processedUpdates,
    };
    res.status(200).json({
      success: true,
      message: "iTag updated successfully",
      data: updatedITag,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Update Error:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
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
  const userId = req.user?.uid || req.user?.id;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized user context." });
  }

  if (!password || typeof password !== "string") {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Password is required",
      );
    });
    return res
      .status(400)
      .json({ success: false, message: "Password is required." });
  }

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();

    if (!user.password) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Password not set for user",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Incorrect current password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Incorrect current password",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Incorrect current password" });
    }
    res.status(200).json({ success: true, message: "Password verified" });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in verifyPasswordInapp:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const revokeLoggedInDeviceSession = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "revokeLoggedInDeviceController";
  const action = "revokeLoggedInDevice";
  const userId = req.user?.uid || req.user?.id;
  const { deviceIdToRevoke } = req.body;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, error: "Unauthorized user context." });
  }

  if (!deviceIdToRevoke) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Device ID to revoke is required",
      );
    });
    return res
      .status(400)
      .json({ success: false, error: "Device ID to revoke is required." });
  }

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      const cause = "User not found";
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          cause,
        );
      });
      return res.status(404).json({ success: false, error: "User not found" });
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
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          cause,
        );
      });
      return res
        .status(404)
        .json({ success: false, error: "Session not found" });
    }

    await Promise.all([
      addFlag(userId, "SESSION_REVOKED"),
      userDoc.ref.update({
        sessions: updatedSessions,
        updatedAt: new Date(),
      }),
    ]);

    res
      .status(200)
      .json({ success: true, message: "Device logged out successfully" });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in revokeLoggedInDeviceSession:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res
      .status(500)
      .json({ success: false, error: "Could not revoke session" });
  }
};
export const patchUserPreferences = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "updateUserPreferencesController";
  const action = "updateUserPreferences";
  const userId = req.user?.uid || req.user?.id;
  const updateData = req.body;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, error: "Unauthorized user context." });
  }

  if (
    !updateData ||
    typeof updateData !== "object" ||
    Array.isArray(updateData)
  ) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid update payload",
      );
    });
    return res
      .status(400)
      .json({ success: false, error: "Valid update payload is required." });
  }

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
    const updatedPrefs = {
      id: prefDocRef.id,
      ...existingData,
      ...payload,
    };
    res.status(200).json({
      success: true,
      message: "Preferences updated successfully",
      preferences: updatedPrefs,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in patchUserPreferences:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res
      .status(500)
      .json({ success: false, error: "Server error updating preferences" });
  }
};
export const sendPhoneNumberOTP = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "sendOtpToMobileController";
  const action = "sendOtpToMobile";
  const { phoneNumber, channel = "whatsapp" } = req.body;

  if (!phoneNumber) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Phone number is required",
      );
    });
    return res
      .status(400)
      .json({ success: false, message: "Phone number is required." });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Twilio credentials missing",
      );
    });
    return res
      .status(500)
      .json({ success: false, message: "SMS/WhatsApp service misconfigured." });
  }

  const client = twilio(accountSid, authToken);
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

    const isWhatsApp = channel.toLowerCase() === "whatsapp";
    const fromAddress = isWhatsApp
      ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`
      : process.env.TWILIO_PHONE_NUMBER;
    const toAddress = isWhatsApp ? `whatsapp:${phoneNumber}` : phoneNumber;

    await client.messages.create({
      from: fromAddress,
      contentSid: process.env.TWILIO_CONTENT_SID,
      contentVariables: JSON.stringify({ 1: otpCode }),
      to: toAddress,
    });
    res.status(200).json({ success: true, message: `OTP sent to ${channel}` });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Twilio Error:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to send verification message",
    });
  }
};
export const verifyIcashPin = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyIcashPinController";
  const action = "verifyIcashPin";
  const { pin } = req.body;
  const userId = req.user?.id || req.user?.uid;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized user context." });
  }

  if (!pin || typeof pin !== "string") {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "PIN is required",
      );
    });
    return res
      .status(400)
      .json({ success: false, message: "PIN is required." });
  }

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();

    if (user.isSuspended) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "This account is already suspended.",
        );
      });
      return res.status(403).json({
        success: false,
        isSuspended: true,
        message: "This account is already suspended.",
      });
    }

    let lockoutTimestamp = null;
    if (user.iCashLockoutUntil) {
      lockoutTimestamp = user.iCashLockoutUntil.toDate
        ? user.iCashLockoutUntil.toDate().getTime()
        : new Date(user.iCashLockoutUntil).getTime();
    }

    if (lockoutTimestamp && lockoutTimestamp > Date.now()) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Locked. Try again",
        );
      });
      return res.status(403).json({
        success: false,
        message: `Locked. Try again after ${moment(lockoutTimestamp).format("LT")}`,
      });
    }

    if (!user.iCashPin) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "iCash PIN not set",
        );
      });
      return res.status(401).json({ success: false, message: "Invalid PIN" });
    }

    const isMatch = await bcrypt.compare(pin, user.iCashPin);
    if (!isMatch) {
      const currentAttempts = (user.iCashAttempts || 0) + 1;

      if (currentAttempts >= 5) {
        await Promise.all([
          addFlag(userId, "FAILED_PIN_ATTEMPT"),
          userDoc.ref.update({
            isSuspended: true,
            iCashAttempts: 0,
            updatedAt: new Date(),
          }),
          notifyAdmins(
            { role: ["moderator", "super_admin"] },
            {
              notificationId: generateNotificationId("security"),
              category: "security",
              actionType: "ACCOUNT_SUSPENDED_SECURITY",
              payload: {
                userId,
                reason: "Excessive failed iCash PIN attempts",
              },
              senderId: "system",
            },
            false,
          ),
        ]);

        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Maximum attempts reached. Account suspended for security.",
          );
        });
        return res.status(403).json({
          success: false,
          isSuspended: true,
          message: "Maximum attempts reached. Account suspended for security.",
        });
      }

      await Promise.all([
        addFlag(userId, "FAILED_PIN_ATTEMPT"),
        userDoc.ref.update({
          iCashAttempts: currentAttempts,
          updatedAt: new Date(),
        }),
      ]);

      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid PIN.",
        );
      });
      return res.status(401).json({
        success: false,
        message: "Invalid PIN",
        attemptsRemaining: 5 - currentAttempts,
      });
    }

    await userDoc.ref.update({
      iCashAttempts: 0,
      iCashLockoutUntil: null,
      updatedAt: new Date(),
    });
    res
      .status(200)
      .json({ success: true, message: "PIN verified successfully" });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in verifyIcashPin:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const icashPinSetup = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "icashPinSetupController";
  const action = "icashPinSetup";
  const { pin } = req.body;
  const userId = req.user?.id || req.user?.uid;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized user context." });
  }

  if (!pin || typeof pin !== "string" || pin.length < 4) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid PIN format",
      );
    });
    return res.status(400).json({
      success: false,
      message: "A valid PIN of at least 4 digits is required.",
    });
  }

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();

    if (user.iCashPin) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "PIN already exists. Use the 'Reset PIN' flow to change it.",
        );
      });
      return res.status(400).json({
        success: false,
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
    res.status(200).json({ success: true, message: "iCash PIN secured." });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in icashPinSetup:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const requestIcashPinReset = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "requestIcashPinResetController";
  const action = "requestIcashPinReset";
  const userId = req.user?.id || req.user?.uid;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized user context." });
  }

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await userDoc.ref.update({
      resetPinOTP: hashedOtp,
      resetPinOTPExpires: otpExpires,
      updatedAt: new Date(),
    });

    try {
      const htmlContent = icashPinResetTemplate(user.firstname || "User", otp);
      await sendEmail({
        to: user.email,
        subject: "IMPORTANT: iCash PIN Reset Code",
        text: `Your reset code is ${otp}`,
        html: htmlContent,
      });
      res
        .status(200)
        .json({ success: true, message: "OTP sent to your registered email." });
      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
    } catch (err) {
      await userDoc.ref.update({
        resetPinOTP: null,
        resetPinOTPExpires: null,
        updatedAt: new Date(),
      });

      console.error("Email Dispatch Error:", err);
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Email could not be sent.",
        );
      });
      return res
        .status(500)
        .json({ success: false, message: "Email could not be sent." });
    }
  } catch (error) {
    console.error("Error in requestIcashPinReset:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const resetIcashPin = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "resetIcashPinController";
  const action = "resetIcashPin";
  const { otp, newPin } = req.body;
  const userId = req.user?.id || req.user?.uid;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
    });
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized user context." });
  }

  if (!otp || !newPin || typeof newPin !== "string" || newPin.length < 4) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid payload parameters",
      );
    });
    return res.status(400).json({
      success: false,
      message: "OTP and a valid new PIN are required.",
    });
  }

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const user = userDoc.data();

    let otpExpiresTime = null;
    if (user.resetPinOTPExpires) {
      otpExpiresTime = user.resetPinOTPExpires.toDate
        ? user.resetPinOTPExpires.toDate().getTime()
        : new Date(user.resetPinOTPExpires).getTime();
    }

    const hashedInputOtp = crypto
      .createHash("sha256")
      .update(otp)
      .digest("hex");

    if (
      !user.resetPinOTP ||
      user.resetPinOTP !== hashedInputOtp ||
      !otpExpiresTime ||
      otpExpiresTime <= Date.now()
    ) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid or expired OTP.",
        );
      });
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP." });
    }

    const suspiciousActivity = user.suspiciousActivity || [];
    if (suspiciousActivity.length > 0) {
      await addFlag(userId, "PIN_RESET_WHILE_SUSPICIOUS");
      if (suspiciousActivity.length > 3) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Account security in review. Please contact support to help reset PIN.",
          );
        });
        return res.status(403).json({
          success: false,
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

    await Promise.all([
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
          userName: user.firstname || "iCampus User",
          date: formattedDate,
          time: formattedTime,
        },
        sendEmail: true,
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      }),
      notifyAdmins(
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
      ).catch((err) => console.error("Admin audit notification failed:", err)),
    ]);
    res
      .status(200)
      .json({ success: true, message: "PIN updated successfully." });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in resetIcashPin:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const markNotificationAsRead = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markNotificationAsReadController";
  const action = "markNotificationAsRead";

  try {
    const { id } = req.params;
    const userId = req.user?.uid || req.user?.id;

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

    if (!id) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Notification ID required",
        );
      });
      return res
        .status(400)
        .json({ success: false, message: "Notification ID is required." });
    }

    const notificationQuery = await Notification.where(
      "notificationId",
      "==",
      id,
    )
      .where("recipientId", "==", userId)
      .limit(1)
      .get();

    if (notificationQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Notification not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }

    const notificationDoc = notificationQuery.docs[0];
    const existingData = notificationDoc.data();
    const updateTimestamp = new Date();

    await notificationDoc.ref.update({
      isRead: true,
      updatedAt: updateTimestamp,
    });

    const notification = {
      id: notificationDoc.id,
      ...existingData,
      isRead: true,
      updatedAt: updateTimestamp,
    };
    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      notification,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const markAllNotificationsAsRead = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markAllNotificationAsReadController";
  const action = "markAllNotificationAsRead";

  try {
    const userId = req.user?.uid || req.user?.id;

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

    const unreadQuery = await Notification.where("recipientId", "==", userId)
      .where("isRead", "==", false)
      .get();

    if (unreadQuery.empty) {
      res.status(200).json({
        success: true,
        message: "All notifications marked as read",
        modifiedCount: 0,
      });
      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
      return;
    }

    const batches = [];
    let currentBatch = db.batch();
    let operationCount = 0;
    const updateTimestamp = new Date();

    unreadQuery.docs.forEach((doc) => {
      currentBatch.update(doc.ref, {
        isRead: true,
        updatedAt: updateTimestamp,
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

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      modifiedCount: unreadQuery.size,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res
      .status(500)
      .json({ success: false, message: "Server error updating notifications" });
  }
};
export const toggleFollowingUsers = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleFollowingController";
  const action = "toggleFollowing";

  try {
    const followerId = req.user?.uid || req.user?.id;
    const { followingId } = req.body;

    if (!followerId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

    if (!followingId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing target followingId",
        );
      });
      return res
        .status(400)
        .json({ success: false, message: "Missing target followingId" });
    }

    if (followerId === followingId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "You cannot follow yourself",
        );
      });
      return res
        .status(400)
        .json({ success: false, message: "You cannot follow yourself" });
    }

    const [followQuery, targetUserQuery] = await Promise.all([
      Follow.where("followerId", "==", followerId)
        .where("followingId", "==", followingId)
        .limit(1)
        .get(),
      User.where("uid", "==", followingId).limit(1).get(),
    ]);

    const targetUserData = !targetUserQuery.empty
      ? targetUserQuery.docs[0].data()
      : null;
    const targetFirstName = targetUserData?.firstname || "User";

    if (!followQuery.empty) {
      await followQuery.docs[0].ref.delete();

      res.status(200).json({
        success: true,
        action: "unfollowed",
        message: `Unfollowed ${targetFirstName} successfully`,
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
      return;
    } else {
      const [, followerUserQuery] = await Promise.all([
        Follow.add({
          followerId,
          followingId,
          createdAt: new Date(),
        }),
        User.where("uid", "==", followerId).limit(1).get(),
      ]);

      const followerUserData = !followerUserQuery.empty
        ? followerUserQuery.docs[0].data()
        : null;
      const followerName = followerUserData?.firstname || "Someone";

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

      res.status(200).json({
        success: true,
        action: "followed",
        message: `Followed ${targetFirstName} successfully`,
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
      return;
    }
  } catch (error) {
    console.error("Follow Toggle Error:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const updateUserProfile = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "updateUserProfileController";
  const action = "updateUserProfile";

  try {
    const userId = req.user?.id || req.user?.uid;
    const updates = req.body || {};

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

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
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const existingUserData = userDoc.data();
    const updateTimestamp = new Date();

    const payload = {
      ...filteredUpdates,
      updatedAt: updateTimestamp,
    };

    await userDoc.ref.set(payload, { merge: true });

    const mergedUserData = {
      ...existingUserData,
      ...payload,
    };

    const {
      resetPinOTP,
      resetPinOTPExpires,
      iCashPin,
      password,
      refreshTokens,
      ...sanitizedUser
    } = mergedUserData;

    const updatedUser = { id: userDoc.id, ...sanitizedUser };

    res.status(200).json({
      success: true,
      data: updatedUser,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
export const verifyiTagUsernameAvailability = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyiTagUsernameAvailabilityController";
  const action = "verifyiTagUsernameAvailability";

  try {
    const rawVal = req.params?.val;

    if (!rawVal || typeof rawVal !== "string") {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing or invalid username parameter",
        );
      });
      return res.status(400).json({
        available: false,
        message: "Missing or invalid username parameter",
      });
    }

    const val = rawVal.trim().toLowerCase();
    const itagQuery = await ITag.where("username", "==", val).limit(1).get();

    if (itagQuery.empty) {
      res.status(200).json({
        available: true,
        message: "iTag username available",
      });
      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
      return;
    }

    res.status(200).json({
      available: false,
      message: "iTag username already exists",
    });
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "iTag username already exists",
      );
    });
  } catch (error) {
    console.error("Error fetching iTag:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({
      available: false,
      message: "Server error",
    });
  }
};
export const searchBookInLibrary = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "searchBookInLibraryController";
  const action = "searchBookInLibrary";

  try {
    const userId = req.user?.uid || req.user?.id;
    const { q } = req.query;

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

    if (!q || typeof q !== "string" || !q.trim()) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing or invalid search query",
        );
      });
      return res
        .status(400)
        .json({ success: false, message: "Missing or invalid search query" });
    }

    const searchQuery = q.trim();
    const searchUrl = `https://1lib.sk/s/${encodeURIComponent(searchQuery)}`;

    const { data } = await axios.get(searchUrl, {
      timeout: 8000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
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
          downloadUrl: detailsUrl?.startsWith("http")
            ? detailsUrl
            : `https://1lib.sk${detailsUrl}`,
        });
      }
    });

    res.status(200).json({ success: true, books });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Library Scraping Error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res
      .status(500)
      .json({ success: false, message: "Failed to connect to the library" });
  }
};
export const searchUserUsingUidOrNameQuery = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "searchUserUsingUidOrNameQueryController";
  const action = "searchUserUsingUidOrNameQuery";
  const { q, uid, viewerRole, viewerTier } = req.query;

  const isAdmin = viewerRole === "admin";

  try {
    let users = [];

    if (uid) {
      const userQuery = await User.where("uid", "==", uid).limit(1).get();
      if (!userQuery.empty) {
        users.push({ id: userQuery.docs[0].id, ...userQuery.docs[0].data() });
      }
    } else if (q && typeof q === "string" && q.trim().length > 0) {
      const snapshot = await User.get();
      const searchTerm = q.trim().toLowerCase();

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
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Query or UID required",
        );
      });
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

    res
      .status(200)
      .json({ success: true, data: uid ? safeResults[0] : safeResults });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Search Users Controller Error:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ message: error.message, success: false });
  }
};
export const checkAccountState = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "checkAccountStateController";
  const action = "checkAccountState";

  try {
    const userId = req.user?.uid || req.user?.id;

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

    const userQuery = await User.where("uid", "==", userId).limit(1).get();

    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = userQuery.docs[0].data();

    res.status(200).json({
      success: true,
      user: {
        uid: user.uid,
        isSuspended: user.isSuspended || false,
      },
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Check Account State Error:", error);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
export const createPersonaVerifyInquiry = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createPersonaVerifyInquiryController";
  const action = "createPersonaVerifyInquiry";

  try {
    const userId = req.user?.id || req.user?.uid;
    const { userType } = req.body || {};

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

    const INDIVIDUAL_TEMPLATE_ID = process.env.INDIVIDUAL_TEMPLATE_ID;
    const ENTERPRISE_TEMPLATE_ID = process.env.ENTERPRISE_TEMPLATE_ID;
    const PERSONA_API_KEY = process.env.PERSONA_API_KEY;

    if (
      !INDIVIDUAL_TEMPLATE_ID ||
      !ENTERPRISE_TEMPLATE_ID ||
      !PERSONA_API_KEY
    ) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing Persona configuration keys",
        );
      });
      return res.status(500).json({
        success: false,
        error: "Server configuration error for verification.",
      });
    }

    const selectedTemplate =
      userType === "enterprise"
        ? ENTERPRISE_TEMPLATE_ID
        : INDIVIDUAL_TEMPLATE_ID;

    const personaEnvironment =
      process.env.PERSONA_ENV ||
      (process.env.NODE_ENV === "production" ? "production" : "sandbox");

    const response = await axios.post(
      "https://withpersona.com/api/v1/inquiries",
      {
        data: {
          attributes: {
            "template-id": selectedTemplate,
            "reference-id": userId,
            environment: personaEnvironment,
          },
        },
      },
      {
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${PERSONA_API_KEY}`,
          Accept: "application/json",
          "Persona-Version": "2023-01-05",
          "Content-Type": "application/json",
        },
      },
    );

    const inquiryId = response.data?.data?.id;

    if (!inquiryId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid response from Persona API",
        );
      });
      return res.status(502).json({
        success: false,
        error: "Failed to retrieve inquiry ID from verification provider.",
      });
    }

    res.status(200).json({ success: true, inquiryId });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Persona API Error:", error.response?.data || error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({
      success: false,
      error: "Failed to initialize verification session",
      details: error.response?.data?.errors || error.message,
    });
  }
};
export const handleUnifiedCourseSearch = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "handleUnifiedCourseSearchController";
  const action = "handleUnifiedCourseSearch";

  try {
    const searchQuery = req.query.q;
    if (
      !searchQuery ||
      typeof searchQuery !== "string" ||
      searchQuery.trim().length < 2
    ) {
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
        id: course.courseId || course.id,
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

    const dynamicUnifiedResults = normalizedInstitutional.sort((a, b) =>
      a.title.localeCompare(b.title),
    );

    res.status(200).json({
      success: true,
      courses: dynamicUnifiedResults,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Institutional course search failure:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
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
    if (
      !searchQuery ||
      typeof searchQuery !== "string" ||
      searchQuery.trim().length < 2
    ) {
      return res.status(200).json({ success: true, resources: [] });
    }

    const searchTerm = searchQuery.toLowerCase().trim();
    const institutionalSnapshot = await Course.get();
    const institutionalMatches = [];

    institutionalSnapshot.forEach((doc) => {
      const data = doc.data();
      const courseTitle = (data.courseTitle || "").toLowerCase();
      const courseCode = (data.courseCode || "").toLowerCase();
      const resources = Array.isArray(data.resources) ? data.resources : [];

      const hasMatchingResource = resources.some((url) => {
        if (typeof url !== "string") return false;
        try {
          const rawFileName = url.split("/").pop() || "";
          const cleanedFileName = decodeURIComponent(rawFileName)
            .split("?")[0]
            .toLowerCase();
          return cleanedFileName.includes(searchTerm);
        } catch {
          return false;
        }
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
      const resources = Array.isArray(course.resources) ? course.resources : [];
      if (resources.length === 0) return;

      const courseTitle = course.courseTitle || "";
      const courseCode = course.courseCode || "";

      resources.forEach((url) => {
        if (typeof url !== "string") return;

        let cleanedFileName = "Untitled Material";
        try {
          const rawFileName = url.split("/").pop() || "Untitled Material";
          cleanedFileName = decodeURIComponent(rawFileName).split("?")[0];
        } catch {
          cleanedFileName = "Untitled Material";
        }

        const matchesQuery =
          courseTitle.toLowerCase().includes(searchTerm) ||
          courseCode.toLowerCase().includes(searchTerm) ||
          cleanedFileName.toLowerCase().includes(searchTerm);

        if (matchesQuery) {
          const base64Hash = Buffer.from(url)
            .toString("base64")
            .substring(0, 8);

          const fileFormat =
            url.split(".").pop()?.split("?")[0]?.toLowerCase() || "pdf";

          normalizedInstitutional.push({
            id: `${course.courseId || course.id}-${base64Hash}`,
            title: cleanedFileName.split("-").pop() || cleanedFileName,
            url: url,
            format: fileFormat,
            isPremiumPaid: false,
            price: 0,
            metaSource: `${courseCode} • Institutional`,
            courseId: course.courseId || course.id,
          });
        }
      });
    });

    const unifiedResources = normalizedInstitutional.sort((a, b) =>
      a.title.localeCompare(b.title),
    );

    res.status(200).json({
      success: true,
      resources: unifiedResources,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error(
      "Institutional resource library lookup down: ",
      error.message,
    );
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
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
    const { theme } = req.body || {};
    const sanitizedTheme =
      typeof theme === "string" ? theme.trim().toLowerCase() : "";

    if (!["light", "dark", "system"].includes(sanitizedTheme)) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid choice schema profile allocation assignment.",
        );
      });
      return res.status(400).json({
        success: false,
        message: "Invalid choice schema profile allocation assignment.",
      });
    }

    const userId = req.user?.uid || req.user?.id;
    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user context",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user context." });
    }

    const collectionRef =
      typeof UserPrefs !== "undefined" ? UserPrefs : userPrefs;
    if (!collectionRef) {
      throw new Error("UserPrefs collection reference is not defined.");
    }

    const prefQuery = await collectionRef
      .where("userId", "==", userId)
      .limit(1)
      .get();

    const preferenceData = {
      theme: sanitizedTheme,
      updatedAt: new Date(),
    };

    if (prefQuery.empty) {
      preferenceData.createdAt = new Date();
      await collectionRef.add({
        userId,
        ...preferenceData,
      });
    } else {
      await prefQuery.docs[0].ref.update(preferenceData);
    }

    res.status(200).json({
      success: true,
      message: "Theme synchronization configurations stored successfully.",
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Preferences Update Engine System Fault:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
export const refreshUserDetails = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "refreshUserDetailsController";
  const action = "refreshUserDetails";

  try {
    const uid = req.user?.uid || req.user?.id;
    if (!uid) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized: Missing user identifier",
        );
      });
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Missing user identifier",
      });
    }

    const prefCollection =
      typeof userPrefs !== "undefined" ? userPrefs : UserPrefs;

    const [userQuery, prefQuery] = await Promise.all([
      User.where("uid", "==", uid).limit(1).get(),
      prefCollection
        ? prefCollection.where("userId", "==", uid).limit(1).get()
        : { empty: true },
    ]);

    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();

    const { password, iCashPin, userAccountDetails, ...safeUserData } =
      userData;

    let theme = "light";
    if (!prefQuery.empty && prefQuery.docs && prefQuery.docs[0]) {
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

    res.status(200).json({
      success: true,
      message: "Refresh successful",
      user: safeUser,
      accessToken,
      refreshToken,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error in user refresh handler:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
export const aiChat = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "aiChatController";
  const action = "aiChat";

  try {
    const { message, context = {}, history = [] } = req.body || {};
    const uid = req.user?.uid || req.user?.id;

    if (!uid) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user context",
      );
      return res
        .status(401)
        .json({ success: false, error: "Unauthorized user context." });
    }

    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Message content is required." });
    }

    const { type = "general", data = {} } = context;
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    let systemInstruction = "";
    if (type === "support") {
      systemInstruction = `You are iAssistant, the official Support AI for iCampus. 
        Use the provided FAQ knowledge: ${JSON.stringify(typeof FAQ_DATA !== "undefined" ? FAQ_DATA : {})}. 
        If the user's issue cannot be resolved via the FAQs, acknowledge the limitation 
        and state that you are escalating the issue to a human support ticket.
        If the issue requires escalation, respond strictly in a valid JSON format:
          {
            "reply": "Your natural language response to the user...",
            "requiresEscalation": true,
            "suggestedCategory": "technical|billing|content|other",
            "suggestedSummary": "A very short 5- 10 words summary of the issue",
            "suggestedSeverity": "low|medium|high|critical"
          }
          If no escalation is needed, just provide your response as plain text or wrapped in the same JSON structure with "requiresEscalation": false.
        `;
    } else {
      systemInstruction = `You are iAssistant, the official Academic AI Tutor for iCampus. 
      Your purpose is to help students and lecturers understand educational material. 
      Academic Context: ${type === "course" ? `Course: ${data.courseTitle || "General Course"}` : type === "lecture" ? `Topic: ${data.topicName || "General Lecture"}` : "General Study"}.`;
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
        ...(Array.isArray(history) ? history : []),
      ],
    });
    const result = await chat.sendMessage(message);
    const replyText = result.response.text();
    let finalReply;
    let aiResponse;
    const ticketRefId =
      typeof generateTicketId === "function"
        ? generateTicketId(uid)
        : `TKT-${Date.now()}`;
    let createdTicketId = null;

    try {
      const cleanedJsonText = replyText
        .replace(/^```json\s*([\s\S]*?)\s*```$/, "$1")
        .trim();
      aiResponse = JSON.parse(cleanedJsonText);
    } catch (e) {
      aiResponse = { reply: replyText, requiresEscalation: false };
    }

    let newTicket = null;
    if (aiResponse.requiresEscalation) {
      newTicket = {
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

      if (typeof SupportTicket !== "undefined" && SupportTicket.add) {
        await SupportTicket.add(newTicket);
      }
      createdTicketId = ticketRefId;
      finalReply =
        (aiResponse.reply || replyText) + `\n\nTicket ID: ${ticketRefId}`;
    } else {
      finalReply = aiResponse.reply || replyText;
    }
    res
      .status(200)
      .json({ success: true, reply: finalReply, ticketId: createdTicketId });
    setImmediate(() => {
      const backgroundTasks = [];

      if (aiResponse.requiresEscalation && typeof notifyAdmins === "function") {
        backgroundTasks.push(
          notifyAdmins(
            { role: ["support", "super_admin"] },
            {
              notificationId:
                typeof generateNotificationId === "function"
                  ? generateNotificationId("system")
                  : `NOTIF-${Date.now()}`,
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
          ),
        );
      }

      if (typeof logControllerPerformance === "function") {
        backgroundTasks.push(
          Promise.resolve().then(() =>
            logControllerPerformance(
              controllerName,
              action,
              startTime,
              "success",
            ),
          ),
        );
      }

      Promise.all(backgroundTasks);
    });
  } catch (error) {
    console.error("AI Chat Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch response" });
  }
};
export const createQuickMeeting = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createQuickMeetingController";
  const action = "createQuickMeeting";

  try {
    const hostId = req.user?.uid || req.user?.id;

    if (!hostId) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user identifier",
      );
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user identifier" });
    }

    const preparedData =
      typeof prepareLectureData === "function"
        ? prepareLectureData(req.body)
        : req.body;
    const {
      date,
      startTime: meetingStartTime,
      endTime,
      topicName,
      lectureType = "Online",
      location = "",
    } = preparedData;

    if (!date || !meetingStartTime || !endTime || !topicName) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required meeting fields." });
    }

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
        success: false,
        message: `Conflict detected! You are already scheduled for "${conflict.topicName}" at this time.`,
      });
    }

    const meetingId =
      typeof generateLectureId === "function"
        ? generateLectureId(hostId, lectureType)
        : `LEC-${Date.now()}`;
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
    const [_, userQuery] = await Promise.all([
      Lectures.doc(meetingId).set(newMeeting),
      User.where("uid", "==", hostId).limit(1).get(),
    ]);
    const responseBody = {
      success: true,
      message: "Meeting scheduled successfully",
      meeting: newMeeting,
    };

    res.status(200).json(responseBody);
    setImmediate(async () => {
      const backgroundTasks = [];
      const readableDate = new Date(date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      const notificationMessage = `Your online class session '${topicName}' is set for ${readableDate} at ${meetingStartTime}. Click here to join: ${location}`;

      if (typeof createNotification === "function") {
        backgroundTasks.push(
          createNotification({
            notificationId:
              typeof generateNotificationId === "function"
                ? generateNotificationId("classroom")
                : `NOTIF-${Date.now()}`,
            recipientId: hostId,
            category: "classroom",
            actionType: "CLASS_SCHEDULED",
            title: "Class Scheduled",
            message: notificationMessage,
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
          }).catch((err) => console.error("Meeting notification error:", err)),
        );
      }

      if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        const monthlyStats = userData.monthlyStats || {};
        const minutesActive = (monthlyStats.minutesActive || 0) + 15;
        const aiQueries = (monthlyStats.aiQueries || 0) + 2;

        backgroundTasks.push(
          userDoc.ref
            .update({
              "monthlyStats.minutesActive": minutesActive,
              "monthlyStats.aiQueries": aiQueries,
              updatedAt: new Date(),
            })
            .catch((err) => console.error("User stats update error:", err)),
        );
      }

      if (typeof logControllerPerformance === "function") {
        backgroundTasks.push(
          Promise.resolve().then(() =>
            logControllerPerformance(
              controllerName,
              action,
              startTime,
              "success",
            ),
          ),
        );
      }

      await Promise.all(backgroundTasks);
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
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};
export const registerDropOffStation = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "registerDropOffStationController";
  const action = "registerDropOffStation";

  try {
    const { name, address, images, latitude, longitude } = req.body;
    const userId = req.user?.id || req.user?.uid;

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user identifier",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user identifier" });
    }

    if (
      !name ||
      !address ||
      latitude === undefined ||
      longitude === undefined
    ) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing required station fields.",
        );
      });
      return res
        .status(400)
        .json({ success: false, message: "Missing required station fields." });
    }

    const stationId =
      typeof generateStationId === "function"
        ? generateStationId()
        : `STN-${Date.now()}`;
    const ticketRefId =
      typeof generateTicketId === "function"
        ? generateTicketId(userId)
        : `TKT-${Date.now()}`;
    const now = new Date();

    const newRequest = {
      id: stationId,
      userId,
      name,
      address,
      images: Array.isArray(images) ? images : [],
      latitude,
      longitude,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    const newTicket = {
      userId,
      ticketRefId,
      source: "in-app",
      category: "technical",
      summary: `New Station Registration: ${name}`,
      originalMessage: `User ${userId} requests to register drop-off station ${name} at ${address} with coordinates: ${latitude} ${longitude}.`,
      severity: "high",
      status: "open",
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      DropOffStation.doc(stationId).set(newRequest),
      SupportTicket.add(newTicket),
      typeof createNotification === "function"
        ? createNotification({
            notificationId:
              typeof generateNotificationId === "function"
                ? generateNotificationId("store")
                : `NOTIF-${Date.now()}`,
            recipientId: userId,
            category: "store",
            actionType: "STATION_REQUEST_RECEIVED",
            title: "Drop-off Station Registration Request Received",
            message:
              "Your drop-off station request has been received and is under review. Expect a reply within 5 days.",
            payload: {
              requestId: stationId,
              address: newRequest.address,
            },
          })
        : Promise.resolve(),
      typeof notifyAdmins === "function"
        ? notifyAdmins(
            { role: ["super_admin", "moderator"] },
            {
              notificationId:
                typeof generateNotificationId === "function"
                  ? generateNotificationId("store")
                  : `NOTIF-ADM-${Date.now()}`,
              actionType: "NEW_STATION_REGISTRATION",
              title: "New Station Request",
              message: `New drop-off station "${name}" submitted by user ${userId}.`,
              payload: { ticketRefId, requestId: stationId, name, userId },
            },
            true,
          ).catch((err) => console.error("Admin notification failed:", err))
        : Promise.resolve(),
    ]);

    res.status(200).json({
      success: true,
      message: "Request submitted successfully",
      stationId,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Register Drop-Off Station Error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

//Tested and trusted using jest
export const searchPosts = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "searchPostsController";
  const action = "searchPosts";

  try {
    const searchQuery = req.query.q;
    const userId = req.user?.id || req.user?.uid;

    if (
      !searchQuery ||
      typeof searchQuery !== "string" ||
      searchQuery.trim().length < 2
    ) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({ success: true, count: 0, posts: [] });
    }

    const searchTerm = searchQuery.toLowerCase().trim();
    const [postsSnapshot, commentsSnapshot, repostersSnapshot] =
      await Promise.all([
        Posts.orderBy("createdAt", "desc").limit(100).get(),
        Comments.get(),
        PostReposters.get(),
      ]);

    const allComments = commentsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    const allReposters = repostersSnapshot.docs.map((doc) => doc.data());
    const matchedPosts = [];

    postsSnapshot.forEach((doc) => {
      const data = doc.data();
      const postId = data.postId || doc.id;

      const content = (data.content || "").toLowerCase();
      const postComments = allComments.filter((c) => c.postId === postId);
      const jobTitle = (data.jobMetadata?.title || "").toLowerCase();
      const jobCompany = (data.jobMetadata?.company || "").toLowerCase();
      const eventTitle = (data.eventMetadata?.title || "").toLowerCase();

      const hasMatchingComment = postComments.some((c) =>
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
        matchedPosts.push({
          id: doc.id,
          ...data,
          comments: postComments,
          repostersDetails,
        });
      }
    });

    const limitedPosts = matchedPosts.slice(0, 40);
    const uniqueCommentUserIds = [
      ...new Set(
        limitedPosts
          .flatMap((p) => p.comments || [])
          .map((c) => c.userId)
          .filter(Boolean),
      ),
    ];
    const userMap = {};
    if (uniqueCommentUserIds.length > 0) {
      const userQueries = await Promise.all(
        uniqueCommentUserIds.map((uid) =>
          User.where("uid", "==", uid)
            .limit(1)
            .get()
            .catch(() => null),
        ),
      );

      userQueries.forEach((userQuery) => {
        if (userQuery && !userQuery.empty) {
          const cuData = userQuery.docs[0].data();
          userMap[cuData.uid] = {
            uid: cuData.uid,
            firstname: cuData.firstname,
            lastname: cuData.lastname,
            username: cuData.username,
            profilePic: cuData.profilePic,
          };
        }
      });
    }
    const formattedPosts = await Promise.all(
      limitedPosts.map(async (post) => {
        const postComments = post.comments || [];

        const commentsWithUsers = postComments.map((commentData) => ({
          ...commentData,
          userId: userMap[commentData.userId] || commentData.userId,
        }));

        const featuredReposter =
          typeof getPriorityReposter === "function"
            ? await getPriorityReposter(post.repostersDetails || [], userId)
            : null;

        return {
          ...post,
          comments: commentsWithUsers,
          commentsCount: commentsWithUsers.length,
          repostsCount:
            post.repostsCount !== undefined
              ? post.repostsCount
              : (post.repostersDetails || []).length,
          featuredReposter,
        };
      }),
    );
    res.status(200).json({
      success: true,
      count: formattedPosts.length,
      posts: formattedPosts,
    });
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
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