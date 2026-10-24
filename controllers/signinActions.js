import {
  User,
  OperationalInstitutions,
  EmailVerification,
  SchoolConfiguration,
  userPrefs,
  Admin,
  UserSessions,
} from "../tableDeclarations.js";
import { db } from "../config/firebaseAdmin.js";
import axiosRetry from "axios-retry";
import axios from "axios";
import crypto from "crypto";
import geoip from "geoip-lite";
import { setImmediate } from "timers";
import {
  generateNotificationId,
  generateUserUID,
  generateTokens,
} from "../utils/idGenerator.js";
import {
  verifyGoogleToken,
  verifyGithubToken,
} from "../api/foreignFetchApis.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createNotification } from "../services/notification.js";
import { generateUsername, Usernames } from "../utils/username.js";
import { client } from "../workers/reditFile.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { verifyAndNotifyLogin } from "../utils/suspiciousActivityDetector.js";
import { addFlag } from "../utils/flagger.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { promisify } from "util";
import { embedUserWithInstitutionTier } from "../utils/embedFunctions.js";
import { issueSignupProof, readSignupProof } from "../utils/signupProof.js";

/**
 * Looks one person up in the school's directory API. The school's endpoint
 * gets `school_id` plus `matriculation_number` or `staff_id` as query params
 * (the old code sent neither, so every lookup returned the same record).
 */
const querySchoolDirectory = async (schoolConfig, schoolId, params) => {
  const url = new URL(schoolConfig.externalApiConfig.endpoint);
  url.searchParams.set("school_id", schoolId);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    Number(schoolConfig.externalApiConfig.timeoutMs) || 8000,
  );
  try {
    return await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-iCampus-API-Key": schoolConfig.externalApiConfig.sharedSecret,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

// Fields a new account may set itself. Everything else (tier, balances,
// admin flags, verification, uid…) is decided by the server.
const SIGNUP_ALLOWED_FIELDS = [
  "usertype",
  "email",
  "firstname",
  "lastname",
  "country",
  "profilePic",
  "deviceId",
  "deviceName",
  "organizationName",
  "website",
  "jobTitle",
  "providerId",
];
const isStrongPassword = (pw) =>
  typeof pw === "string" &&
  pw.length >= 10 &&
  /[A-Z]/.test(pw) &&
  /[a-z]/.test(pw) &&
  /\d/.test(pw) &&
  /[\W_]/.test(pw);
const verifyJwtAsync = promisify(jwt.verify);
axiosRetry(axios, { retries: 3 });

export const fetchInstitutionByCountry = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchInstitutionByCountryController";
  const action = "fetchInstitutionByCountry";

  try {
    const { country } = req.query;

    if (!country) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Country is required",
        );
      });
      return res.status(400).json({ message: "Country is required" });
    }

    const normalizedCountry = country.trim().toLowerCase();
    const cacheKey = `institutions:${normalizedCountry}`;

    try {
      const cached = await client.get(cacheKey);
      if (cached) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        });
        return res.json({ cached: true, ...JSON.parse(cached) });
      }
    } catch (err) {
      console.warn(
        "Redis Cache Warning (Proceeding without cache):",
        err.message,
      );
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=universities+in+${encodeURIComponent(normalizedCountry)}&key=${apiKey}`;

    const response = await axios.get(url, { timeout: 5000 });

    if (
      response.data.status !== "OK" &&
      response.data.status !== "ZERO_RESULTS"
    ) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          response.data.status,
        );
      });
      throw new Error(`Google API Error: ${response.data.status}`);
    }

    const institutions = (response.data.results || []).map((item) => ({
      name: item.name,
      address: item.formatted_address,
      place_id: item.place_id,
      rating: item.rating || 0,
      user_ratings_total: item.user_ratings_total || 0,
      location: item.geometry?.location || null,
      photos: item.photos ? item.photos[0].photo_reference : null,
      types: item.types,
    }));

    const responsePayload = {
      count: institutions.length,
      source: "google_places",
      institutions,
    };
    res.json(responsePayload);
    setImmediate(() => {
      const cachePromise =
        typeof client.setEx === "function"
          ? client.setEx(cacheKey, 86400, JSON.stringify(responsePayload))
          : typeof client.setex === "function"
            ? client.setex(cacheKey, 86400, JSON.stringify(responsePayload))
            : client.set(
                cacheKey,
                JSON.stringify(responsePayload),
                "EX",
                86400,
              );
      cachePromise.catch((err) =>
        console.error("Redis cache write error:", err.message),
      );

      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Institutions fetch error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ message: "Failed to retrieve institutions" });
  }
};
export const verifyEmailUsingCode = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyEmailUsingCodeController";
  const action = "verifyEmailUsingCode";

  try {
    const { email, code } = req.body;
    if (!email || !code) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Email and code are required",
        );
      });
      return res
        .status(400)
        .json({ message: "Email and code are required", verified: false });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const hashedCode = crypto.createHash("sha256").update(code).digest("hex");
    const now = new Date();
    const docId = `ver_${crypto.createHash("md5").update(normalizedEmail).digest("hex")}`;
    const docRef = EmailVerification.doc(docId);

    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "No verification request found",
        );
      });
      return res
        .status(404)
        .json({ message: "No verification request found", verified: false });
    }

    const record = docSnapshot.data();
    // A 6-digit code is guessable without a cap; after 5 wrong tries the
    // code is burned and a new one must be requested.
    const MAX_CODE_ATTEMPTS = 5;
    if ((record.attempts || 0) >= MAX_CODE_ATTEMPTS) {
      docRef.delete().catch(() => {});
      return res.status(429).json({
        message: "Too many wrong attempts. Request a new code.",
        verified: false,
      });
    }
    if (record.code !== hashedCode) {
      docRef
        .update({ attempts: (record.attempts || 0) + 1 })
        .catch(() => {});
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid verification code",
        );
      });
      return res
        .status(400)
        .json({ message: "Invalid verification code", verified: false });
    }

    const expiresAt = record.expiresAt.toDate
      ? record.expiresAt.toDate()
      : new Date(record.expiresAt);

    if (expiresAt < now) {
      docRef
        .delete()
        .catch((err) => console.error("Error deleting expired token:", err));

      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Verification code has expired",
        );
      });
      return res
        .status(400)
        .json({ message: "Verification code has expired", verified: false });
    }
    await docRef.delete();
    res.status(200).json({
      message: "Email verified successfully",
      verified: true,
      email: normalizedEmail,
      // Required by signUp for password accounts.
      emailProof: issueSignupProof("email", { email: normalizedEmail }),
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("verifyEmailCode error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ message: "Server error", verified: false });
  }
};
export const changePassword = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "changePasswordController";
  const action = "changePassword";
  const { email, password, confirmPassword } = req.body;

  if (!email || !password || !confirmPassword || password !== confirmPassword) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid inputs or passwords do not match",
      );
    });
    return res
      .status(400)
      .json({ message: "Passwords do not match or are missing" });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const verificationDocId = `ver_${crypto.createHash("md5").update(normalizedEmail).digest("hex")}`;
    const verificationDocRef = EmailVerification.doc(verificationDocId);

    const verificationPromise = verificationDocRef.get();
    const userQueryPromise = User.where("email", "==", normalizedEmail)
      .limit(1)
      .get();
    const hashedPasswordPromise = bcrypt.hash(password, 10);

    const [verificationDoc, userSnapshot, hashedPassword] = await Promise.all([
      verificationPromise,
      userQueryPromise,
      hashedPasswordPromise,
    ]);

    const record = verificationDoc.exists ? verificationDoc.data() : null;

    if (!record || !record.verified) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Email not verified for password reset",
        );
      });
      return res
        .status(403)
        .json({ message: "Email not verified for password reset" });
    }

    if (userSnapshot.empty) {
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

    const userDoc = userSnapshot.docs[0];
    const userDocRef = userDoc.ref;
    const userData = userDoc.data();
    const userId = userData.uid || userDoc.id;
    const rawIp =
      req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
    const ip = rawIp.split(",")[0].trim();
    const geo = geoip.lookup(ip);
    const currentCountry = geo ? geo.country : "Unknown";

    const sessionsSnapshot = await UserSessions.where(
      "userId",
      "==",
      userId,
    ).get();
    const sessions = sessionsSnapshot.docs.map((doc) => doc.data());

    const sortedSessions = sessions.sort((a, b) => {
      const timeA = a.lastUsed?.toDate
        ? a.lastUsed.toDate().getTime()
        : new Date(a.lastUsed || 0).getTime();
      const timeB = b.lastUsed?.toDate
        ? b.lastUsed.toDate().getTime()
        : new Date(b.lastUsed || 0).getTime();
      return timeB - timeA;
    });

    const lastKnownLocation =
      sortedSessions.length > 0 ? sortedSessions[0].location : null;
    const isSuspicious =
      lastKnownLocation && !lastKnownLocation.includes(currentCountry);

    const sessionBatch = UserSessions.firestore.batch();
    sessionsSnapshot.docs.forEach((doc) => {
      sessionBatch.delete(doc.ref);
    });

    const userUpdatePromise = userDocRef.set(
      { password: hashedPassword, updatedAt: new Date() },
      { merge: true },
    );
    const deleteVerificationPromise = verificationDocRef.delete();
    const commitSessionsPromise = sessionBatch.commit();

    await Promise.all([
      userUpdatePromise,
      deleteVerificationPromise,
      commitSessionsPromise,
    ]);
    res.status(200).json({ message: "Password changed successfully" });
    setImmediate(() => {
      const now = new Date();
      const formattedDate = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const formattedTime = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      createNotification({
        notificationId: generateNotificationId("security"),
        recipientId: userId,
        isRead: false,
        recipientEmail: userData.email,
        recoveryEmails: userData.recoveryEmails,
        category: "auth",
        actionType: "PASSWORD_CHANGED",
        title: "Password Changed",
        message: `Your password was successfully updated on ${formattedTime}.`,
        payload: {
          userName: userData.firstname || userData.firstName || "User",
          date: formattedDate,
          time: formattedTime,
          userId: userId,
        },
        sendEmailFlag: true,
        sendEmail: true,
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      }).catch((err) => console.error("Notification dispatch failed:", err));

      notifyAdmins(
        { role: ["super_admin", "support"] },
        {
          notificationId: generateNotificationId("security"),
          actionType: isSuspicious
            ? "SUSPICIOUS_PASSWORD_CHANGE"
            : "PASSWORD_CHANGE_AUDIT",
          payload: {
            userEmail: userData.email,
            userUid: userId,
            previousLocation: lastKnownLocation || "None",
            currentLocation: `${geo?.city || "Unknown"}, ${currentCountry}`,
            severity: isSuspicious ? "HIGH" : "LOW",
          },
          senderId: "system",
        },
        isSuspicious,
      ).catch((err) => console.error("Admin audit failed:", err));

      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Password change error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ message: "Internal server error" });
  }
};

//Tested and trusted using jest
export const validateInstitution = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "validateInstitutionController";
  const action = "validateInstitution";

  try {
    const { schoolName } = req.body;

    if (!schoolName) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "School name required",
        );
      });
      return res.status(400).json({ message: "School name required" });
    }

    const trimmedSchoolName = schoolName.trim();
    const targetNormalized = trimmedSchoolName.toLowerCase();
    const cacheKey = `institution:validate:${targetNormalized}`;

    try {
      const cached = await client.get(cacheKey);
      if (cached) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        });
        return res.status(200).json({ cached: true, ...JSON.parse(cached) });
      }
    } catch (cacheErr) {
      console.warn("Redis Cache Warning:", cacheErr.message);
    }
    const institutionSnapshot = await OperationalInstitutions.where(
      "schoolName",
      "==",
      trimmedSchoolName,
    )
      .limit(1)
      .get();

    let institution = null;

    if (!institutionSnapshot.empty) {
      const doc = institutionSnapshot.docs[0];
      institution = { id: doc.id, ...doc.data() };
    } else {
      const allSnapshot = await OperationalInstitutions.get();
      allSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (
          data.schoolName &&
          data.schoolName.trim().toLowerCase() === targetNormalized
        ) {
          institution = { id: doc.id, ...data };
        }
      });
    }

    if (!institution) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "iCampus not yet operational in this institution.",
        );
      });
      return res.status(404).json({
        verified: false,
        message:
          "iCampus not yet operational in this institution. Student/Lecturer verification is unavailable.",
      });
    }

    const responsePayload = {
      message: "Institution verified",
      schoolName: institution.schoolName,
      schoolCode: institution.schoolCode,
      verified: true,
      logo: institution.logo || null,
    };
    res.status(200).json(responsePayload);
    setImmediate(() => {
      const cachePromise =
        typeof client.setEx === "function"
          ? client.setEx(cacheKey, 86400, JSON.stringify(responsePayload))
          : typeof client.setex === "function"
            ? client.setex(cacheKey, 86400, JSON.stringify(responsePayload))
            : client.set(
                cacheKey,
                JSON.stringify(responsePayload),
                "EX",
                86400,
              );
      cachePromise.catch((err) =>
        console.error("Redis cache write error:", err.message),
      );
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Institution Validation Error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ message: "Server error" });
  }
};
export const validateEmail = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "validateEmailController";
  const action = "validateEmail";

  try {
    const { email } = req.body;
    if (!email) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Email is required",
        );
      });
      return res.status(400).json({ message: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const docId = `ver_${crypto.createHash("md5").update(normalizedEmail).digest("hex")}`;
    const docRef = EmailVerification.doc(docId);

    const existingDoc = await docRef.get();

    const verificationPayload = {
      email: normalizedEmail,
      code: hashedCode,
      expiresAt,
      updatedAt: new Date(),
    };

    if (!existingDoc.exists) {
      verificationPayload.createdAt = new Date();
    }
    await docRef.set(verificationPayload, { merge: true });
    res.status(200).json({
      message: "Verification code sent",
      codeSent: true,
    });
    setImmediate(() => {
      const notificationJob = {
        notificationId: generateNotificationId("auth"),
        recipientEmail: normalizedEmail,
        category: "auth",
        actionType: "EMAIL_VERIFICATION",
        title: "Verify your Email",
        message: `Your verification code is ${code}. It expires in 15 minutes.`,
        payload: { code },
        sendEmail: true,
        sendPush: false,
        saveToDb: false,
        isRead: false,
      };

      createNotification(notificationJob).catch((err) =>
        console.error("Background verification email error:", err),
      );

      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Email verification error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ message: "Server error" });
  }
};
export const forgotPassword = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "forgotPasswordController";
  const action = "forgotPassword";

  try {
    const { email } = req.body;
    if (!email) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Email is required",
        );
      });
      return res.status(400).json({ message: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const userQueryPromise = User.where("email", "==", normalizedEmail)
      .limit(1)
      .get();
    const docId = `ver_${crypto.createHash("md5").update(normalizedEmail).digest("hex")}`;
    const verificationDocRef = EmailVerification.doc(docId);
    const verificationDocPromise = verificationDocRef.get();

    const [userSnapshot, verificationDocSnapshot] = await Promise.all([
      userQueryPromise,
      verificationDocPromise,
    ]);

    if (userSnapshot.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res.status(404).json({ message: "User with email not found" });
    }

    const userDoc = userSnapshot.docs[0];
    const user = { id: userDoc.id, ...userDoc.data() };

    if (verificationDocSnapshot.exists) {
      const existingRecord = verificationDocSnapshot.data();
      const updatedAtValue = existingRecord.updatedAt
        ? existingRecord.updatedAt.toDate
          ? existingRecord.updatedAt.toDate().getTime()
          : new Date(existingRecord.updatedAt).getTime()
        : 0;

      const timeSinceLastSent = Date.now() - updatedAtValue;
      if (timeSinceLastSent < 60000) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Please wait before requesting another code.",
          );
        });
        return res
          .status(429)
          .json({ message: "Please wait before requesting another code." });
      }
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = crypto.createHash("sha256").update(code).digest("hex");
    const durationMs = 15 * 60 * 1000;
    const expiresAt = new Date(Date.now() + durationMs);
    const readableExpires = expiresAt.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const verificationPayload = {
      email: normalizedEmail,
      code: hashedCode,
      expiresAt,
      updatedAt: new Date(),
    };

    if (!verificationDocSnapshot.exists) {
      verificationPayload.createdAt = new Date();
    }
    await verificationDocRef.set(verificationPayload, { merge: true });
    res.status(200).json({
      message: "Verification code sent, check your email",
      email: normalizedEmail,
    });
    setImmediate(() => {
      createNotification({
        notificationId: generateNotificationId("security"),
        recipientId: user.uid || user.id,
        isRead: false,
        recipientEmail: normalizedEmail,
        category: "security",
        actionType: "PASSWORD_RESET_CODE",
        title: "Password Reset Code",
        message: `Your 6-digit verification code is ${code}. It expires in ${readableExpires}.`,
        payload: {
          code: code,
          userName: user.firstname || "User",
          expiryTime: readableExpires,
        },
        sendEmail: true,
        sendPush: true,
        sendSocket: true,
        saveToDb: false,
      }).catch((err) =>
        console.error("Forgot password notification failed:", err),
      );

      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Forgot Password Error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
export const verifyStudent = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyStudentController";
  const action = "verifyStudent";
  const { school_id, matriculation_number } = req.body;

  if (!school_id || !matriculation_number) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing school ID or matriculation number",
      );
    });
    return res
      .status(400)
      .json({ message: "School ID and matriculation number are required" });
  }

  try {
    const schoolConfigSnapshot = await SchoolConfiguration.where(
      "schoolId",
      "==",
      school_id,
    )
      .limit(1)
      .get();

    if (schoolConfigSnapshot.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "iCampus is not active at this institution.",
        );
      });
      return res
        .status(400)
        .json({ message: "iCampus is not active at this institution." });
    }

    const schoolConfig = schoolConfigSnapshot.docs[0].data();

    if (
      !schoolConfig.isOperational ||
      !schoolConfig.externalApiConfig?.endpoint
    ) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "iCampus is not active or improperly configured.",
        );
      });
      return res
        .status(400)
        .json({ message: "iCampus is not active at this institution." });
    }

    const matric = String(matriculation_number).trim().toUpperCase();
    const schoolApiResponse = await querySchoolDirectory(schoolConfig, school_id, {
      matriculation_number: matric,
    });

    if (!schoolApiResponse.ok) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Student record not found in school directory.",
        );
      });
      return res
        .status(404)
        .json({ message: "Student record not found in school directory." });
    }

    const schoolStudent = await schoolApiResponse.json();
    if (!schoolStudent?.first_name || !schoolStudent?.email) {
      return res.status(404).json({
        message: "Student record not found in school directory.",
        verified: false,
      });
    }
    if (schoolStudent.isStillInSchool === false) {
      return res.status(403).json({
        message: "This matriculation number belongs to a graduated or withdrawn student.",
        verified: false,
      });
    }
    // Already registered? Say so now instead of at the last step.
    const existing = await User.where("usertype", "==", "student")
      .where("schoolCode", "==", school_id)
      .where("matricNumber", "==", matric)
      .limit(1)
      .get();
    if (!existing.empty) {
      return res.status(409).json({
        message: "An account already exists for this matriculation number. Log in instead.",
        verified: false,
      });
    }
    const identity = {
      firstname: schoolStudent.first_name,
      lastname: schoolStudent.last_name,
      department: schoolStudent.faculty_dept || schoolStudent.department || null,
      current_level: schoolStudent.level || null,
      schoolAvatarUrl: schoolStudent.profile_picture_url || null,
      email: String(schoolStudent.email).trim().toLowerCase(),
      isStillInSchool: schoolStudent.isStillInSchool !== false,
      matricNumber: matric,
    };
    res.status(200).json({
      success: true,
      verified: true,
      isVerified: true,
      ...identity,
      // signUp takes the student's identity from this, not from the app.
      verificationToken: issueSignupProof("student", {
        ...identity,
        schoolCode: school_id,
      }),
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (err) {
    const errorMessage =
      err.name === "AbortError"
        ? "External school verification timed out."
        : err.message;
    console.error("External institutional verification failed:", errorMessage);

    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        errorMessage,
      );
    });
    return res
      .status(err.name === "AbortError" ? 504 : 500)
      .json({ message: "Unable to reach school verification system." });
  }
};
export const verifyLecturer = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyLecturerController";
  const action = "verifyLecturer";
  // The app sent `school_name` (it holds the school code) while this read
  // `school_id`, so every lecturer verification failed with "Missing fields".
  const school_id = req.body?.school_id || req.body?.school_name;
  const incomingStaffId = req.body?.staff_id;

  if (!school_id || !incomingStaffId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required fields",
      );
    });
    return res
      .status(400)
      .json({ message: "Missing required fields", verified: false });
  }

  try {
    const schoolConfigSnapshot = await SchoolConfiguration.where(
      "schoolId",
      "==",
      school_id,
    )
      .limit(1)
      .get();

    if (schoolConfigSnapshot.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "iCampus is not operational or active at this institution.",
        );
      });
      return res.status(400).json({
        message: "iCampus is not operational or active at this institution.",
        verified: false,
      });
    }

    const schoolConfig = schoolConfigSnapshot.docs[0].data();

    if (
      !schoolConfig.isOperational ||
      !schoolConfig.externalApiConfig?.endpoint
    ) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "iCampus is not operational or active at this institution.",
        );
      });
      return res.status(400).json({
        message: "iCampus is not operational or active at this institution.",
        verified: false,
      });
    }

    const staffId = String(incomingStaffId).trim().toUpperCase();
    const portalResponse = await querySchoolDirectory(schoolConfig, school_id, {
      staff_id: staffId,
    });

    if (!portalResponse.ok) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Instructor credentials not found in school records",
        );
      });
      return res.status(404).json({
        message: "Instructor credentials not found in school records",
        verified: false,
      });
    }

    const externalLecturer = await portalResponse.json();
    if (!externalLecturer?.first_name || !externalLecturer?.email) {
      return res.status(404).json({
        message: "Instructor credentials not found in school records",
        verified: false,
      });
    }
    const existing = await User.where("usertype", "==", "lecturer")
      .where("schoolCode", "==", school_id)
      .where("staffId", "==", staffId)
      .limit(1)
      .get();
    if (!existing.empty) {
      return res.status(409).json({
        message: "An account already exists for this staff ID. Log in instead.",
        verified: false,
      });
    }
    const identity = {
      firstname: externalLecturer.first_name,
      lastname: externalLecturer.last_name,
      department: externalLecturer.department || null,
      staffId: externalLecturer.staff_id || staffId,
      schoolAvatarUrl: externalLecturer.profile_picture_url || null,
      email: String(externalLecturer.email).trim().toLowerCase(),
    };
    res.status(200).json({
      success: true,
      // The app checks `verified`; only `isVerified` was sent before, so a
      // found lecturer was still treated as "not found".
      verified: true,
      isVerified: true,
      ...identity,
      staff_id: identity.staffId,
      verificationToken: issueSignupProof("lecturer", {
        ...identity,
        schoolCode: school_id,
      }),
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (err) {
    const errorMessage =
      err.name === "AbortError"
        ? "External school verification timed out."
        : err.message;
    console.error("Lecturer Verification error:", errorMessage);

    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        errorMessage,
      );
    });
    return res
      .status(err.name === "AbortError" ? 504 : 500)
      .json({ message: "Server error during verification", verified: false });
  }
};
const REFRESH_ROTATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh Token Required" });
  }

  try {
    const decoded = await verifyJwtAsync(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET,
    );
    const userId = decoded.id;
    const userType = decoded.role || "users";

    const collectionName = userType === "admin" ? "admins" : "users";
    const userDoc = await db.collection(collectionName).doc(userId).get();

    if (!userDoc.exists) {
      return res.status(403).json({ message: "User not found" });
    }

    const userData = { uid: userDoc.id, ...userDoc.data() };
    const storedTokens = userData.refreshTokens || [];
    if (!storedTokens.includes(refreshToken)) {
      return res.status(403).json({ message: "Invalid Refresh Token Session" });
    }

    const newAccessToken = jwt.sign(
      { id: userId, email: userData.email, role: userType },
      process.env.JWT_SECRET,
      { expiresIn: "70m" },
    );

    // Sliding session (stay signed in while active, like LinkedIn): once the
    // refresh token is a week old, swap it in place for a fresh 30-day one.
    // Rotating at most weekly keeps the "response lost mid-rotation" window
    // tiny, and swapping in place keeps the 5-session cap intact.
    let activeRefreshToken = refreshToken;
    const issuedAtMs = (decoded.iat || 0) * 1000;
    if (Date.now() - issuedAtMs > REFRESH_ROTATE_AFTER_MS) {
      activeRefreshToken = jwt.sign(
        { id: userId, role: userType },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: "30d" },
      );
      await userDoc.ref.update({
        refreshTokens: storedTokens.map((t) =>
          t === refreshToken ? activeRefreshToken : t,
        ),
      });
    }

    // Tokens carry role "user" (not "users"); the old check never matched,
    // so the app never received the refreshed profile.
    let safeUser = null;
    if (userType === "users") {
      const enrichedUser = await embedUserWithInstitutionTier(userData);
      const [preferencesDoc] = await Promise.all([userPrefs.doc(userId).get()]);
      const preferences = preferencesDoc.exists ? preferencesDoc.data() : null;
      safeUser = { ...enrichedUser };
      delete safeUser.password;
      delete safeUser.userAccountDetails;
      delete safeUser.refreshTokens;
      safeUser.theme = preferences ? preferences.theme : "light";
    }

    return res.json({
      accessToken: newAccessToken,
      refreshToken: activeRefreshToken,
      user: safeUser,
    });
  } catch (e) {
    console.error("Refresh Token Error:", e.message);
    return res.status(403).json({ message: "Token Expired or Invalid" });
  }
};
export const Login = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "LoginController";
  const action = "Login";
  const credentials = req.body.credentials || req.body;

  const {
    identifier,
    password,
    deviceId,
    deviceName,
    socialProvider,
    idToken,
  } = credentials;

  if (!identifier) {
    return res.status(400).json({ error: "Identifier is required" });
  }

  try {
    const userSnapshot = await User.where("email", "==", identifier)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Account not found.",
        );
      });
      return res
        .status(404)
        .json({ error: "Account not found. Please sign up first." });
    }

    const userDoc = userSnapshot.docs[0];
    const user = { uid: userDoc.uid, ...userDoc.data() };
    if (socialProvider === "google") {
      const isValid = await verifyGoogleToken(idToken, identifier);
      if (!isValid)
        return res.status(401).json({ error: "Invalid Google token" });
    } else if (socialProvider === "github") {
      const isValid = await verifyGithubToken(idToken, identifier);
      if (!isValid)
        return res.status(401).json({ error: "Invalid GitHub token" });
    } else {
      let isMatch;
      isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid password" });
      }
    }

    if (socialProvider && user.providerId !== socialProvider) {
      return res.status(400).json({
        error: `This account was created using ${user.providerId || "a password"}. Please log in using that method.`,
      });
    }
    const enrichedUser = await embedUserWithInstitutionTier(user);
    const [preferencesDoc, tokens] = await Promise.all([
      userPrefs.doc(user.uid).get(),
      generateTokens(user),
    ]);

    const { accessToken, refreshToken } = tokens;
    const preferences = preferencesDoc.exists ? preferencesDoc.data() : null;
    const safeUser = { ...enrichedUser };
    delete safeUser.password;
    delete safeUser.userAccountDetails;
    safeUser.theme = preferences ? preferences.theme : "light";
    safeUser.sessions = [];

    res.status(200).json({
      message: "Login successful",
      user: safeUser,
      accessToken,
      refreshToken,
    });

    setImmediate(async () => {
      try {
        const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress)
          .split(",")[0]
          .trim();
        const geo = geoip.lookup(ip);
        const location = geo.city ? `${geo.city}, ${geo.country}` : geo.country;
        const sessionData = {
          userId: user.uid,
          deviceId,
          deviceName,
          ipAddress: ip,
          location,
          refreshToken,
          lastUsed: new Date(),
          updatedAt: new Date(),
        };
        const existingSessionQuery = await UserSessions.where(
          "userId",
          "==",
          user.uid,
        )
          .where("deviceId", "==", deviceId)
          .limit(1)
          .get();

        let isNewSession = false;
        if (!existingSessionQuery.empty) {
          const sessionDocRef = existingSessionQuery.docs[0].ref;
          await sessionDocRef.set(sessionData, { merge: true });
        } else {
          isNewSession = true;
          const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          sessionData.sessionId = sessionId;
          sessionData.createdAt = new Date();
          await UserSessions.doc(sessionId).set(sessionData);
        }

        logControllerPerformance(controllerName, action, startTime, "success");

        await verifyAndNotifyLogin(user, req, "USER_LOGIN_AUDIT").catch((err) =>
          console.error("Audit error:", err),
        );

        if (isNewSession) {
          const now = new Date();
          await createNotification({
            notificationId: generateNotificationId("security"),
            recipientId: user.uid,
            isRead: false,
            recipientEmail: user.email,
            recoveryEmails: user.recoveryEmails,
            category: "auth",
            actionType: "NEW_LOGIN",
            title: "Security Alert: New Login",
            payload: {
              userName: user.firstname || user.firstName,
              ipAddress: ip,
              location,
              date: now.toLocaleDateString(),
              time: now.toLocaleTimeString(),
              userId: user.uid,
            },
            message: `A login was detected from ${ip} in ${location}.`,
            sendEmail: true,
            saveToDb: true,
          }).catch((err) =>
            console.error("Background notification error:", err),
          );

          await addFlag(user.uid, "UNRECOGNIZED_LOCATION").catch((err) =>
            console.error("Background flag error:", err),
          );
        }
      } catch (bgError) {
        console.error("Background session/audit processing error:", bgError);
      }
    });
  } catch (error) {
    console.error("Login Error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || "Login error" });
    }
  }
};
export const AdminLogin = async (req, res) => {
  const credentials = req.body.credentials || req.body;
  const { identifier, password, deviceId, deviceName } = credentials;

  try {
    const adminSnapshot = await Admin.where("email", "==", identifier)
      .limit(1)
      .get();
    if (adminSnapshot.empty) {
      return res.status(404).json({ error: "Admin credentials invalid." });
    }

    const adminDoc = adminSnapshot.docs[0];
    const adminDocRef = adminDoc.ref;
    const admin = {
      id: adminDoc.id,
      ...adminDoc.data(),
    };

    const isMatch = await bcrypt.compare(password, admin.password || "");
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress)
      .split(",")[0]
      .trim();
    const geo = geoip.lookup(ip);
    const location = geo ? `${geo.city}, ${geo.country}` : "Unknown Location";

    const adminUid = admin.uid || admin.id;
    const sessionData = {
      userId: adminUid,
      deviceId,
      deviceName,
      ipAddress: ip,
      location,
      lastUsed: new Date(),
      updatedAt: new Date(),
    };
    const [existingSessionQuery, allSessionsSnapshot, tokens, _] =
      await Promise.all([
        UserSessions.where("userId", "==", adminUid)
          .where("deviceId", "==", deviceId)
          .limit(1)
          .get(),
        UserSessions.where("userId", "==", adminUid).get(),
        generateTokens(admin, "admin"),
        adminDocRef.set(
          { lastAccessed: new Date(), updatedAt: new Date() },
          { merge: true },
        ),
      ]);

    const { accessToken, refreshToken } = tokens;
    sessionData.refreshToken = refreshToken;

    const sessionOperations = [];
    if (!existingSessionQuery.empty) {
      const sessionDocRef = existingSessionQuery.docs[0].ref;
      sessionOperations.push(sessionDocRef.set(sessionData, { merge: true }));
    } else {
      const sessionId = `admsess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      sessionData.sessionId = sessionId;
      sessionData.createdAt = new Date();
      sessionOperations.push(UserSessions.doc(sessionId).set(sessionData));
    }

    await Promise.all(sessionOperations);

    const activeSessions = allSessionsSnapshot.docs.map((doc) => doc.data());
    const safeAdmin = { ...admin };
    delete safeAdmin.password;
    safeAdmin.sessions = activeSessions;
    res.status(200).json({
      message: "Admin login successful",
      admin: safeAdmin,
      accessToken,
      refreshToken,
    });
    setImmediate(() => {
      verifyAndNotifyLogin(admin, req, "ADMIN_LOGIN_AUDIT").catch((err) =>
        console.error("Admin audit error:", err),
      );
    });
  } catch (error) {
    console.error("Admin Login Error:", error);
    return res
      .status(500)
      .json({ error: "Internal server error during login" });
  }
};
export const signUp = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "signUpController";
  const action = "signUp";

  const body = req.body || {};
  const usertype = body.usertype;
  const providerId = ["google", "github"].includes(body.providerId)
    ? body.providerId
    : "password";
  const password = body.password;
  const { deviceId, deviceName } = body;
  const fail = (status, message) =>
    res.status(status).json({ message, success: false });

  if (!["student", "lecturer", "otherUser", "enterprise"].includes(usertype)) {
    return fail(400, "Choose a valid account type.");
  }

  // ---- Proof of identity ---------------------------------------------------
  // Students and lecturers: identity comes from the school directory lookup
  // (verifyStudent / verifyLecturer), never from the app. Everyone else must
  // prove the email: a code-verified email or a verified Google/GitHub login.
  let schoolIdentity = null;
  let email = String(body.email || "").trim().toLowerCase();
  if (usertype === "student" || usertype === "lecturer") {
    schoolIdentity = readSignupProof(body.verificationToken, usertype);
    if (!schoolIdentity) {
      return fail(
        401,
        "Your school verification has expired. Go back and verify again.",
      );
    }
    email = schoolIdentity.email;
  } else if (providerId === "google") {
    if (!(await verifyGoogleToken(body.idToken, email))) {
      return fail(401, "Google sign-in could not be verified. Try again.");
    }
  } else if (providerId === "github") {
    if (!(await verifyGithubToken(body.idToken, email))) {
      return fail(401, "GitHub sign-in could not be verified. Try again.");
    }
  } else {
    const emailProof = readSignupProof(body.emailProof, "email");
    if (!emailProof || emailProof.email !== email) {
      return fail(401, "Verify your email address before creating an account.");
    }
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(400, "A valid email is required.");
  }
  const isSocial = providerId !== "password";
  if (!isSocial && !isStrongPassword(password)) {
    return fail(
      400,
      "Password must be at least 10 characters with upper and lower case letters, a number and a symbol.",
    );
  }
  if (usertype === "enterprise" && !String(body.organizationName || "").trim()) {
    return fail(400, "Organization name is required.");
  }

  const firstname = schoolIdentity?.firstname ?? String(body.firstname || "").trim();
  const lastname = schoolIdentity?.lastname ?? String(body.lastname || "").trim();
  const organizationName = String(body.organizationName || "").trim();

  try {
    let existingUserQuery = User.where("email", "==", email);
    let institutionalQuery = null;
    if (usertype === "student") {
      institutionalQuery = User.where("usertype", "==", "student")
        .where("schoolCode", "==", schoolIdentity.schoolCode)
        .where("matricNumber", "==", schoolIdentity.matricNumber);
    } else if (usertype === "lecturer") {
      institutionalQuery = User.where("usertype", "==", "lecturer")
        .where("schoolCode", "==", schoolIdentity.schoolCode)
        .where("staffId", "==", schoolIdentity.staffId);
    }
    const rawIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const ip = rawIp ? rawIp.split(",")[0].trim() : "";
    const geo = geoip.lookup(ip);
    const location = !geo
      ? "Unknown Location"
      : geo.city
        ? `${geo.city}, ${geo.country}`
        : geo.country;

    const displayNameForGen =
      firstname || lastname || organizationName || "User";

    const [uid] = await Promise.all([
      Promise.resolve(generateUserUID(usertype)),
    ]);
    const isVerified = !!schoolIdentity;
    const queriesToRun = [
      existingUserQuery.limit(1).get(),
      !isSocial ? bcrypt.hash(password, 10) : Promise.resolve(null),
    ];
    if (institutionalQuery) {
      queriesToRun.push(institutionalQuery.limit(1).get());
    }
    const results = await Promise.all(queriesToRun);
    const emailSnapshot = results[0];
    const hashedPassword = results[1];
    // Was results[4] on a 3-item array, so this check never ran.
    const institutionalSnapshot = institutionalQuery ? results[2] : null;
    if (!emailSnapshot.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Email already in use.",
        );
      });
      return res.status(409).json({
        message: "An account with this email already exists.",
        success: false,
      });
    }

    if (institutionalSnapshot && !institutionalSnapshot.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Institutional ID already in use.",
        );
      });
      return res.status(409).json({
        message: "An account with this institutional ID already exists.",
        success: false,
      });
    }
    // Only whitelisted fields from the request; `...req.body` let a client
    // overwrite uid or set balances, suspension, credits, schoolCode, etc.
    const allowed = Object.fromEntries(
      SIGNUP_ALLOWED_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
    );
    const profilePic = Array.isArray(body.profilePic)
      ? body.profilePic.filter((u) => typeof u === "string" && u)
      : typeof body.profilePic === "string" && body.profilePic
        ? [body.profilePic]
        : schoolIdentity?.schoolAvatarUrl
          ? [schoolIdentity.schoolAvatarUrl]
          : [];
    const newUserObj = {
      ...allowed,
      uid,
      usertype,
      email,
      firstname,
      lastname,
      organizationName: usertype === "enterprise" ? organizationName : "",
      profilePic,
      password: hashedPassword,
      isVerified,
      providerId,
      currentIScore: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      tier: "free",
      hasSubscribed: false,
      twoFactorEnabled: false,
      isInstitutionAdmin: false,
      ...(schoolIdentity
        ? {
            schoolCode: schoolIdentity.schoolCode,
            schoolName: String(body.schoolName || "").trim() || null,
            department: schoolIdentity.department || null,
            schoolAvatarUrl: schoolIdentity.schoolAvatarUrl || null,
            ...(usertype === "student"
              ? {
                  matricNumber: schoolIdentity.matricNumber,
                  current_level: schoolIdentity.current_level || null,
                  isStillInSchool: schoolIdentity.isStillInSchool !== false,
                }
              : { staffId: schoolIdentity.staffId }),
          }
        : {}),
    };
    const defaultPreferencesData = {
      userId: uid,
      theme: "light",
      notifications: {
        auth: true,
        social: true,
        classroom: true,
        store: true,
        finance: true,
        profile: true,
        security: true,
      },
      channels: { push: true, email: true, socket: true },
      language: "en",
      quietHours: { enabled: false },
      updatedAt: new Date(),
    };
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const initialSession = {
      sessionId,
      userId: uid,
      deviceId,
      deviceName,
      ipAddress: ip,
      location,
      lastUsed: new Date(),
      createdAt: new Date(),
    };
    // Tokens before any write: they used to be read from index 4 of a
    // 4-item result, so `tokens` was undefined and every signup returned 500
    // after the user had already been saved (retrying then said "exists").
    const { accessToken, refreshToken } = await generateTokens({
      ...newUserObj,
      uid,
      usertype,
      email,
    });
    initialSession.refreshToken = refreshToken;
    // Every account gets a unique username (used for @mentions). The
    // reservation is created in the same batch as the user, so if someone
    // grabbed the name a moment ago the whole write fails and we retry with
    // a fresh one — no account is ever saved with a duplicate.
    for (let attempt = 0; ; attempt++) {
      newUserObj.username = await generateUsername(newUserObj);
      const batch = db.batch();
      batch.create(Usernames.doc(newUserObj.username), {
        uid,
        createdAt: new Date(),
      });
      batch.set(User.doc(uid), newUserObj);
      batch.set(userPrefs.doc(uid), defaultPreferencesData);
      batch.set(UserSessions.doc(sessionId), initialSession);
      try {
        await batch.commit();
        break;
      } catch (err) {
        // 6 = ALREADY_EXISTS (the username reservation).
        if (err?.code !== 6 || attempt >= 2) throw err;
      }
    }

    const safeUser = { ...newUserObj };
    delete safeUser.password;
    safeUser.theme = defaultPreferencesData.theme;
    safeUser.sessions = [initialSession];
    res.status(200).json({
      message: "User created successfully",
      success: true,
      user: safeUser,
      accessToken,
      refreshToken,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
      UserSessions.doc(sessionId)
        .update({ refreshToken })
        .catch((err) => console.error("Session token update error:", err));

      const welcomeName = firstname || organizationName || "there";
      createNotification({
        notificationId: generateNotificationId("signup"),
        recipientId: uid,
        isRead: false,
        category: "signup",
        actionType: "WELCOME_USER",
        payload: { userName: welcomeName },
        recipientEmail: email,
        sendEmail: true,
        sendPush: true,
        saveToDb: true,
      }).catch((err) =>
        console.error("Background welcome notification error:", err),
      );
    });
  } catch (error) {
    console.error("❌ Insert failed:", error.message);
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
      message: error.message || "Failed to save user",
      success: false,
    });
  }
};
export const switchToInstitutionAdmin = async (req, res) => {
  try {
    const userId = req.user?.uid || req.user?.id;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, error: "Unauthorized user context." });
    }

    const userQueryPromise = User.where("uid", "==", userId).limit(1).get();
    const adminDocRef = Admin.doc(userId);
    const adminDocPromise = adminDocRef.get();

    const [userSnapshot, adminDocSnapshot] = await Promise.all([
      userQueryPromise,
      adminDocPromise,
    ]);

    if (userSnapshot.empty) {
      return res
        .status(404)
        .json({ success: false, error: "User profile not found." });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    const canSwitch =
      userData.isInstitutionAdmin === true &&
      userData.isVerified === true &&
      userData.usertype === "enterprise";

    if (!canSwitch) {
      return res.status(403).json({
        success: false,
        error:
          "Unauthorized. You do not meet the requirements to switch to an institutional administrator dashboard.",
      });
    }

    let adminData;
    const adminUpdates = {};

    if (!adminDocSnapshot.exists) {
      adminData = {
        uid: userId,
        firstname: userData.organizationName || "School",
        lastname: userData.lastname || "Admin",
        email: userData.email,
        password: userData.password,
        adminType: "school_administrator",
        profilePic: userData.profilePic || [],
        country: userData.country || "Unknown",
        isVerified: true,
        schoolCode: userData.schoolCode || null,
        lastAccessed: new Date(),
        createdAt: new Date(),
      };
      await adminDocRef.set(adminData);
      adminData.id = userId;
    } else {
      adminData = {
        id: adminDocSnapshot.id,
        ...adminDocSnapshot.data(),
      };

      if (
        adminData.adminType !== "school_administrator" &&
        adminData.adminType !== "super_admin"
      ) {
        adminUpdates.adminType = "school_administrator";
      }
    }

    adminUpdates.lastAccessed = new Date();
    adminUpdates.updatedAt = new Date();

    const ip = (
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      ""
    )
      .split(",")[0]
      .trim();
    const geo = geoip.lookup(ip);
    const location = geo ? `${geo.city}, ${geo.country}` : "Unknown Location";
    const deviceId = req.body?.deviceId || "switch_device";
    const deviceName = req.body?.deviceName || "Web/Mobile Switch";

    const sessionDocId = `admsess_${userId}_${deviceId}`;
    const sessionDocRef = UserSessions.doc(sessionDocId);

    const sessionData = {
      userId: userId,
      deviceId,
      deviceName,
      ipAddress: ip,
      location,
      lastUsed: new Date(),
      updatedAt: new Date(),
    };

    const sessionCheckPromise = sessionDocRef.get();
    const tokensPromise = generateTokens(
      { ...adminData, ...adminUpdates },
      "admin",
    );

    const [sessionDoc, tokensResult] = await Promise.all([
      sessionCheckPromise,
      tokensPromise,
    ]);

    const { accessToken, refreshToken } = tokensResult;
    sessionData.refreshToken = refreshToken;

    if (!sessionDoc.exists) {
      sessionData.createdAt = new Date();
    }

    const sessionWritePromise = sessionDocRef.set(sessionData, { merge: true });
    const adminWritePromise = adminDocRef.set(adminUpdates, { merge: true });

    await Promise.all([sessionWritePromise, adminWritePromise]);
    res.status(200).json({
      success: true,
      message: "Successfully switched to school administrator profile.",
      admin: { ...adminData, ...adminUpdates, password: undefined },
      accessToken,
      refreshToken,
    });
    setImmediate(async () => {
      try {
        const allSessionsSnapshot = await UserSessions.where(
          "userId",
          "==",
          userId,
        ).get();
        const activeSessions = allSessionsSnapshot.docs.map((doc) =>
          doc.data(),
        );

        const safeAdmin = { ...adminData, ...adminUpdates };
        delete safeAdmin.password;
        safeAdmin.sessions = activeSessions;

        await verifyAndNotifyLogin(safeAdmin, req, "ADMIN_LOGIN_AUDIT");
      } catch (err) {
        console.error("Admin login audit/background task failed:", err);
      }
    });
  } catch (error) {
    console.error("Switch to Admin Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error during profile switch.",
    });
  }
};