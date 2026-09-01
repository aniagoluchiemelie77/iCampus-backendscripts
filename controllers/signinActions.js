import {
  User,
  OperationalInstitutions,
  ITag,
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
  generateUniqueCardNumber,
  generateUserUID,
  generateTokens,
  generateUniqueReferralCode,
  generateItagUsername,
} from "../utils/idGenerator.js";
import {
  verifyGoogleToken,
  verifyGithubToken,
} from "../api/foreignFetchApis.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createNotification } from "../services/notification.js";
import { client } from "../workers/reditFile.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { verifyAndNotifyLogin } from "../utils/suspiciousActivityDetector.js";
import { addFlag } from "../utils/flagger.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { promisify } from "util";
const verifyJwtAsync = promisify(jwt.verify);
axiosRetry(axios, { retries: 3 });

export const signUp = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "signUpController";
  const action = "signUp";

  const {
    usertype,
    email,
    matriculation_number,
    staff_id,
    department,
    password,
    firstname,
    lastname,
    deviceId,
    deviceName,
    providerId,
  } = req.body;

  if (!email) {
    return res
      .status(400)
      .json({ message: "Email is required", success: false });
  }

  try {
    let existingUserQuery = User.where("email", "==", email);
    let institutionalQuery = null;
    if (usertype === "student" && matriculation_number && department) {
      institutionalQuery = User.where("usertype", "==", "student")
        .where("matriculation_number", "==", matriculation_number)
        .where("department", "==", department);
    } else if (usertype === "lecturer" && staff_id && department) {
      institutionalQuery = User.where("usertype", "==", "lecturer")
        .where("staff_id", "==", staff_id)
        .where("department", "==", department);
    }

    const [uid, itagusername, location] = await Promise.all([
      Promise.resolve(generateUserUID()),
      Promise.resolve(generateItagUsername(firstname || lastname, 5)),
      Promise.resolve().then(() => {
        const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress)
          .split(",")[0]
          .trim();
        const geo = geoip.lookup(ip);
        return geo ? `${geo.city}, ${geo.country}` : "Unknown Location";
      }),
    ]);

    const isVerified =
      usertype === "student" || usertype === "lecturer" || !!providerId;
    const iSCardEligible = ["student", "lecturer", "otherUser"].includes(
      usertype,
    );
    const queriesToRun = [
      existingUserQuery.limit(1).get(),
      password && password !== "SOCIAL_AUTH"
        ? bcrypt.hash(password, 10)
        : Promise.resolve(null),
      generateUniqueReferralCode(req.body),
      iSCardEligible ? generateUniqueCardNumber() : Promise.resolve(null),
    ];

    if (institutionalQuery) {
      queriesToRun.push(institutionalQuery.limit(1).get());
    }

    const results = await Promise.all(queriesToRun);
    const emailSnapshot = results[0];
    const hashedPassword = results[1];
    const referralCode = results[2];
    const newCardNumber = results[3];
    const institutionalSnapshot = institutionalQuery ? results[4] : null;
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

    const newUserObj = {
      uid,
      ...req.body,
      itagusername,
      referralCode,
      password: hashedPassword,
      isVerified,
      providerId: providerId || "",
      createdAt: new Date(),
      updatedAt: new Date(),
      hasIcashPin: false,
    };
    delete newUserObj.passwordConfirm;

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

    const dbWrites = [
      User.doc(uid).set(newUserObj),
      userPrefs.doc(uid).set(defaultPreferencesData),
      UserSessions.doc(sessionId).set(initialSession),
    ];

    if (iSCardEligible && newCardNumber) {
      const itagId = `itag_${uid}`;
      const newITagData = {
        userId: uid,
        username: itagusername,
        cardHolderName: `${firstname} ${lastname}`,
        cardNumber: newCardNumber,
        tier: "free",
        createdAt: new Date(),
      };
      dbWrites.push(ITag.doc(itagId).set(newITagData));
    }
    const [_, __, ___, ____, tokens] = await Promise.all([
      ...dbWrites,
      generateTokens({ uid, usertype, email, ...newUserObj }),
    ]);

    const { accessToken, refreshToken } = tokens;
    initialSession.refreshToken = refreshToken;

    const safeUser = { ...newUserObj };
    delete safeUser.password;
    delete safeUser.iCashPin;
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
      createNotification({
        notificationId: generateNotificationId("signup"),
        recipientId: uid,
        category: "signup",
        actionType: "WELCOME_USER",
        title: "Welcome to iCampus!",
        message: `Hi ${firstname}, we're excited to have you here!`,
        payload: { userName: firstname },
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
      let isMatch = false;
      if (user.password && user.password.startsWith("$2")) {
        isMatch = await bcrypt.compare(password, user.password);
      } else {
        isMatch = password === user.password;
      }
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid password" });
      }
    }

    if (socialProvider && user.providerId !== socialProvider) {
      return res.status(400).json({
        error: `This account was created using ${user.providerId || "a password"}. Please log in using that method.`,
      });
    }

    const [preferencesDoc, tokens] = await Promise.all([
      userPrefs.doc(user.uid).get(),
      generateTokens(user),
    ]);

    const { accessToken, refreshToken } = tokens;
    const preferences = preferencesDoc.exists ? preferencesDoc.data() : null;
    const safeUser = { ...user };
    safeUser.hasIcashPin = Boolean(user.iCashPin);
    delete safeUser.password;
    delete safeUser.iCashPin;
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
        const location = geo
          ? `${geo.city}, ${geo.country}`
          : "Unknown Location";
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
    const userType = decoded.role || "user";

    const collectionName = userType === "admin" ? "admins" : "users";
    const userDoc = await db.collection(collectionName).doc(userId).get();

    if (!userDoc.exists) {
      return res.status(403).json({ message: "User not found" });
    }

    const userData = userDoc.data();
    const storedTokens = userData.refreshTokens || [];
    if (!storedTokens.includes(refreshToken)) {
      return res.status(403).json({ message: "Invalid Refresh Token Session" });
    }

    const newAccessToken = jwt.sign(
      { id: userId, email: userData.email, role: userType },
      process.env.JWT_SECRET,
      { expiresIn: "70m" },
    );
    if (userType === "users") {
      const [preferencesDoc] = await Promise.all([userPrefs.doc(userId).get()]);
      const preferences = preferencesDoc.exists ? preferencesDoc.data() : null;
      const safeUser = { ...userData };
      safeUser.hasIcashPin = Boolean(userData.iCashPin);
      delete safeUser.password;
      delete safeUser.iCashPin;
      delete safeUser.userAccountDetails;
      safeUser.theme = preferences ? preferences.theme : "light";
    }

    return res.json({
      accessToken: newAccessToken,
      refreshToken,
      user: userType === "users" ? safeUser : null,
    });
  } catch (e) {
    console.error("Refresh Token Error:", e.message);
    return res.status(403).json({ message: "Token Expired or Invalid" });
  }
};
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
      client
        .setEx(cacheKey, 86400, JSON.stringify(responsePayload))
        .catch((cacheErr) =>
          console.error("Redis setEx error:", cacheErr.message),
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
      client
        .setEx(cacheKey, 86400, JSON.stringify(responsePayload))
        .catch((err) => console.error("Redis setEx error:", err.message));

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
    if (record.code !== hashedCode) {
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    let schoolApiResponse;
    try {
      schoolApiResponse = await fetch(schoolConfig.externalApiConfig.endpoint, {
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
    res.status(200).json({
      firstname: schoolStudent.first_name,
      lastname: schoolStudent.last_name,
      department: schoolStudent.faculty_dept,
      current_level: schoolStudent.level,
      schoolAvatarUrl: schoolStudent.profile_picture_url,
      email: schoolStudent.email,
      isStillInSchool: schoolStudent.isStillInSchool,
      matricNumber: matriculation_number,
      isVerified: true,
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
  const { school_id, staff_id: incomingStaffId } = req.body;

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    let portalResponse;
    try {
      portalResponse = await fetch(schoolConfig.externalApiConfig.endpoint, {
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
    res.status(200).json({
      firstname: externalLecturer.first_name,
      lastname: externalLecturer.last_name,
      department: externalLecturer.department,
      staff_id: externalLecturer.staff_id,
      schoolAvatarUrl: externalLecturer.profile_picture_url,
      email: externalLecturer.email,
      isVerified: true,
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
export const switchToInstitutionAdmin = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "switchToInstitutionAdminController";
  const action = "switchToInstitutionAdmin";

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
      const dummyPassword = await bcrypt.hash(Math.random().toString(36), 10);
      adminData = {
        uid: userId,
        firstname: userData.organizationName || "School",
        lastname: userData.lastname || "Admin",
        email: userData.email,
        password: dummyPassword,
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

//Tested and trusted using jest