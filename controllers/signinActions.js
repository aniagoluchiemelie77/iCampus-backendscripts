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
import crypto from "crypto";
import geoip from "geoip-lite";
import {
  generateNotificationId,
  generateUniqueCardNumber,
  generateUserUID,
  generateTokens,
  generateCode,
  generateUniqueReferralCode,
  generateItagUsername,
} from "../utils/idGenerator.js";
import {
  verifyGoogleToken,
  verifyGithubToken,
} from "../api/foreignFetchApis.js";
import bcrypt from "bcrypt";
import { generateExpiryDate } from "../utils/dateHelper.js";
import jwt from "jsonwebtoken";
import { createNotification } from "../services/notification.js";
import { client } from "../workers/reditFile.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { verifyAndNotifyLogin } from "../utils/suspiciousActivityDetector.js";
import { addFlag } from "../utils/flagger.js";
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
const verificationCodes = {};

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

  try {
    let existingUserQuery = User.where("usertype", "==", usertype);

    if (usertype === "student" && matriculation_number && department) {
      existingUserQuery = existingUserQuery
        .where("matriculation_number", "==", matriculation_number)
        .where("department", "==", department);
    } else if (usertype === "lecturer" && staff_id && department) {
      existingUserQuery = existingUserQuery
        .where("staff_id", "==", staff_id)
        .where("department", "==", department);
    } else {
      existingUserQuery = User.where("email", "==", email);
    }

    const existingUserSnapshot = await existingUserQuery.limit(1).get();

    if (!existingUserSnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User already exists.",
      );
      return res
        .status(409)
        .json({ message: "User already exists.", success: false });
    }

    const uid = generateUserUID();
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress)
      .split(",")[0]
      .trim();
    const geo = geoip.lookup(ip);
    const location = geo ? `${geo.city}, ${geo.country}` : "Unknown Location";

    let hashedPassword = null;
    if (password && password !== "SOCIAL_AUTH") {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const itagusername = generateItagUsername(firstname, 5);
    const referralCode = await generateUniqueReferralCode(req.body);
    const isVerified =
      usertype === "student" || usertype === "lecturer" || providerId
        ? true
        : false;

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
    };
    delete newUserObj.passwordConfirm;
    await User.doc(uid).set(newUserObj);

    const iSCardEligible =
      usertype === "student" ||
      usertype === "lecturer" ||
      usertype === "otherUser";

    if (iSCardEligible) {
      const newCardNumber = await generateUniqueCardNumber();
      const expiryDate = await generateExpiryDate();
      const itagId = `itag_${uid}`;

      const newITagData = {
        userId: uid,
        username: itagusername,
        cardHolderName: `${firstname} ${lastname}`,
        cardNumber: newCardNumber,
        tier: "free",
        expiryDate,
        createdAt: new Date(),
      };
      await ITag.doc(itagId).set(newITagData);
    }
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
      channels: {
        push: true,
        email: true,
        socket: true,
      },
      language: "en",
      quietHours: { enabled: false },
      updatedAt: new Date(),
    };
    await userPrefs.doc(uid).set(defaultPreferencesData);

    const { accessToken, refreshToken } = await generateTokens({
      uid,
      usertype,
      email,
      ...newUserObj,
    });

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const initialSession = {
      sessionId,
      userId: uid,
      deviceId,
      deviceName,
      ipAddress: ip,
      location,
      refreshToken,
      lastUsed: new Date(),
      createdAt: new Date(),
    };

    await UserSessions.doc(sessionId).set(initialSession);
    const safeUser = { ...newUserObj };
    delete safeUser.password;
    delete safeUser.iCashPin;

    safeUser.theme = defaultPreferencesData.theme;
    const sessionsSnapshot = await UserSessions.where(
      "userId",
      "==",
      uid,
    ).get();
    safeUser.sessions = sessionsSnapshot.docs.map((doc) => doc.data());
    await createNotification({
      notificationId: generateNotificationId("signup"),
      recipientId: uid,
      category: "signup",
      actionType: "WELCOME_USER",
      title: "Welcome to iCampus!",
      message: `Hi ${firstname}, we're excited to have you here!`,
      payload: {
        userName: firstname,
      },
      recipientEmail: email,
      sendEmail: true,
      sendPush: true,
      saveToDb: true,
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(201).json({
      message: "User created successfully",
      success: true,
      user: safeUser,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("❌ Insert failed:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );

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

  const {
    identifier,
    password,
    deviceId,
    deviceName,
    socialProvider,
    idToken,
  } = req.body.credentials || req.body;

  try {
    const userSnapshot = await User.where("email", "==", identifier)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Account not found. Please sign up first.",
      );
      return res
        .status(404)
        .json({ error: "Account not found. Please sign up first." });
    }

    const userDocRef = userSnapshot.docs[0].ref;
    const user = {
      id: userSnapshot.docs[0].id,
      ...userSnapshot.docs[0].data(),
    };

    // 2. Validate Authentication Tokens or Password
    if (socialProvider === "google") {
      const isValid = await verifyGoogleToken(idToken, identifier);
      if (!isValid) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid Google token",
        );
        return res.status(401).json({ error: "Invalid Google token" });
      }
    } else if (socialProvider === "github") {
      const isValid = await verifyGithubToken(idToken, identifier);
      if (!isValid) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid GitHub token",
        );
        return res.status(401).json({ error: "Invalid GitHub token" });
      }
    } else {
      const isMatch = await bcrypt.compare(password, user.password || "");
      if (!isMatch) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid password",
        );
        return res.status(401).json({ error: "Invalid password" });
      }
    }

    if (socialProvider && user.providerId !== socialProvider) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        `This account was created using ${user.providerId || "a password"}. Please log in using that method.`,
      );
      return res.status(400).json({
        error: `This account was created using ${user.providerId || "a password"}. Please log in using that method.`,
      });
    }

    const { accessToken, refreshToken } = await generateTokens(user);
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress)
      .split(",")[0]
      .trim();
    const geo = geoip.lookup(ip);
    const location = geo ? `${geo.city}, ${geo.country}` : "Unknown Location";

    // 3. Handle Separated Session Logic
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

    if (!existingSessionQuery.empty) {
      const sessionDocRef = existingSessionQuery.docs[0].ref;
      await sessionDocRef.set(sessionData, { merge: true });
    } else {
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      sessionData.sessionId = sessionId;
      sessionData.createdAt = new Date();

      await UserSessions.doc(sessionId).set(sessionData);

      const now = new Date();
      const formattedDate = now.toLocaleDateString();
      const formattedTime = now.toLocaleTimeString();

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
          location: location,
          date: formattedDate,
          time: formattedTime,
          userId: user.uid,
        },
        message: `A login was detected from ${ip} in ${location}.`,
        sendEmail: true,
        saveToDb: true,
      });

      await addFlag(user.uid, "UNRECOGNIZED_LOCATION");
    }

    await verifyAndNotifyLogin(user, req, "USER_LOGIN_AUDIT");
    const preferencesDoc = await userPrefs.doc(user.uid).get();
    const preferences = preferencesDoc.exists ? preferencesDoc.data() : null;

    const allSessionsSnapshot = await UserSessions.where(
      "userId",
      "==",
      user.uid,
    ).get();
    const activeSessions = allSessionsSnapshot.docs.map((doc) => doc.data());

    // 5. Construct Safe User Response Payload
    const safeUser = { ...user };
    delete safeUser.password;
    delete safeUser.iCashPin;
    delete safeUser.userAccountDetails;

    safeUser.theme = preferences ? preferences.theme : "light";
    safeUser.sessions = activeSessions;

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      message: "Login successful",
      user: safeUser,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Login Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ error: error.message || "Login error" });
  }
};
export const AdminLogin = async (req, res) => {
  const { identifier, password, deviceId, deviceName } = req.body;

  try {
    const adminSnapshot = await Admin.where("email", "==", identifier)
      .limit(1)
      .get();

    if (adminSnapshot.empty) {
      return res.status(404).json({ error: "Admin credentials invalid." });
    }

    const adminDocRef = adminSnapshot.docs[0].ref;
    const admin = {
      id: adminSnapshot.docs[0].id,
      ...adminSnapshot.docs[0].data(),
    };
    const isMatch = await bcrypt.compare(password, admin.password || "");
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const { accessToken, refreshToken } = await generateTokens(admin);
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress)
      .split(",")[0]
      .trim();
    const geo = geoip.lookup(ip);
    const location = geo ? `${geo.city}, ${geo.country}` : "Unknown Location";

    const adminUid = admin.uid || admin.id;

    const sessionData = {
      adminId: adminUid,
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
      adminUid,
    )
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (!existingSessionQuery.empty) {
      const sessionDocRef = existingSessionQuery.docs[0].ref;
      await sessionDocRef.set(sessionData, { merge: true });
    } else {
      const sessionId = `admsess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      sessionData.sessionId = sessionId;
      sessionData.createdAt = new Date();

      await UserSessions.doc(sessionId).set(sessionData);
    }
    await adminDocRef.set(
      {
        lastAccessed: new Date(),
        updatedAt: new Date(),
      },
      { merge: true },
    );

    await verifyAndNotifyLogin(admin, req, "ADMIN_LOGIN_AUDIT");

    const allSessionsSnapshot = await UserSessions.where(
      "userId",
      "==",
      adminUid,
    ).get();
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
  } catch (error) {
    console.error("Admin Login Error:", error);
    res.status(500).json({ error: "Internal server error during login" });
  }
};
export const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(401).json({ message: "Refresh Token Required" });

  try {
    const sessionSnapshot = await UserSessions.where(
      "refreshToken",
      "==",
      refreshToken,
    )
      .limit(1)
      .get();

    if (sessionSnapshot.empty)
      return res.status(403).json({ message: "Invalid Refresh Token" });

    const sessionData = sessionSnapshot.docs[0].data();
    const userId = sessionData.userId;

    const userDoc = await User.doc(userId).get();
    if (!userDoc.exists)
      return res
        .status(403)
        .json({ message: "User not found for this session" });

    const user = userDoc.data();
    jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET,
      (err, decoded) => {
        if (err) return res.status(403).json({ message: "Token Expired" });

        const newAccessToken = jwt.sign(
          { id: user.uid || userId, email: user.email },
          process.env.JWT_SECRET,
          { expiresIn: "15m" },
        );

        res.json({ accessToken: newAccessToken });
      },
    );
  } catch (e) {
    console.error("Refresh Token Error:", e.message);
    res.status(500).json({ message: "Server Error" });
  }
};
export const fetchInstitutionByCountry = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchInstitutionByCountryController";
  const action = "fetchInstitutionByCountry";

  try {
    const { country } = req.query;

    if (!country) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Country is required",
      );
      return res.status(400).json({ message: "Country is required" });
    }

    const normalizedCountry = country.trim();
    const cacheKey = `institutions:${normalizedCountry}`;

    try {
      const cached = await client.get(cacheKey);
      if (cached) {
        logControllerPerformance(controllerName, action, startTime, "success");
        return res.json({ cached: true, ...JSON.parse(cached) });
      }
    } catch (err) {
      console.error("Redis Cache Error:", err.message);
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      );
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=universities+in+${encodeURIComponent(normalizedCountry)}&key=${apiKey}`;
    const response = await axios.get(url);

    if (
      response.data.status !== "OK" &&
      response.data.status !== "ZERO_RESULTS"
    ) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        response.data.status,
      );
      throw new Error(`Google API Error: ${response.data.status}`);
    }

    const institutions = response.data.results.map((item) => ({
      name: item.name,
      address: item.formatted_address,
      place_id: item.place_id,
      rating: item.rating || 0,
      user_ratings_total: item.user_ratings_total || 0,
      location: item.geometry.location,
      photos: item.photos ? item.photos[0].photo_reference : null,
      types: item.types,
    }));

    const responsePayload = {
      count: institutions.length,
      source: "google_places",
      institutions,
    };

    await client.setEx(cacheKey, 3600, JSON.stringify(responsePayload));
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.json(responsePayload);
  } catch (error) {
    console.error("Institutions fetch error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "School name required",
      );
      return res.status(400).json({ message: "School name required" });
    }

    const trimmedSchoolName = schoolName.trim();
    const targetNormalized = trimmedSchoolName.toLowerCase();
    const snapshot = await OperationalInstitutions.get();

    let institution = null;
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (
        data.schoolName &&
        data.schoolName.trim().toLowerCase() === targetNormalized
      ) {
        institution = { id: doc.id, ...data };
      }
    });

    if (!institution) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "iCampus not yet operational in this institution. Student/Lecturer verification is unavailable.",
      );
      return res.status(404).json({
        verified: false,
        message:
          "iCampus not yet operational in this institution. Student/Lecturer verification is unavailable.",
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Institution verified",
      schoolName: institution.schoolName,
      schoolCode: institution.schoolCode,
      verified: true,
      logo: institution.logo,
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
export const validateEmail = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "validateEmailController";
  const action = "validateEmail";

  try {
    const { email } = req.body;
    if (!email) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Email is required",
      );
      return res.status(400).json({ message: "Email is required" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const snapshot = await EmailVerification.where("email", "==", email)
      .limit(1)
      .get();

    const verificationPayload = {
      email,
      code: hashedCode,
      expiresAt,
      updatedAt: new Date(),
    };

    if (!snapshot.empty) {
      // Update existing document
      const docRef = snapshot.docs[0].ref;
      await docRef.set(verificationPayload, { merge: true });
    } else {
      // Create a new document with an auto-generated or email-hashed ID
      const docId = `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      verificationPayload.createdAt = new Date();
      await EmailVerification.doc(docId).set(verificationPayload);
    }

    const notificationJob = {
      notificationId: generateNotificationId("auth"),
      recipientEmail: email,
      category: "security",
      actionType: "EMAIL_VERIFICATION",
      title: "Verify your Email",
      message: `Your verification code is ${code}. It expires in 15 minutes.`,
      payload: { code },
      sendEmail: true,
      sendPush: false,
      saveToDb: false,
    };

    await createNotification(notificationJob);

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Verification code sent",
      codeSent: true,
    });
  } catch (error) {
    console.error("Email verification error:", error.message);
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
export const verifyEmailUsingCode = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyEmailUsingCodeController";
  const action = "verifyEmailUsingCode";

  try {
    const { email, code } = req.body;
    if (!email || !code) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Email and code are required",
      );
      return res.status(400).json({ message: "Email and code are required" });
    }

    const hashedCode = crypto.createHash("sha256").update(code).digest("hex");
    const now = new Date();

    const snapshot = await EmailVerification.where("email", "==", email)
      .where("code", "==", hashedCode)
      .limit(1)
      .get();

    if (snapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "No verification request found",
      );
      return res
        .status(404)
        .json({ message: "No verification request found", verified: false });
    }

    const docRef = snapshot.docs[0].ref;
    const record = snapshot.docs[0].data();

    const expiresAt = record.expiresAt.toDate
      ? record.expiresAt.toDate()
      : new Date(record.expiresAt);

    if (expiresAt < now) {
      await docRef.delete();

      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Verification code has expired",
      );
      return res
        .status(400)
        .json({ message: "Verification code has expired", verified: false });
    }
    await docRef.delete();

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Email verified successfully",
      verified: true,
      email,
    });
  } catch (error) {
    console.error("verifyEmailCode error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ message: "Server error", verified: false });
  }
};
export const forgotPassword = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "forgotPasswordController";
  const action = "forgotPassword";

  try {
    const { email } = req.body;
    const userSnapshot = await User.where("email", "==", email).limit(1).get();
    if (userSnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const userDoc = userSnapshot.docs[0];
    const user = { id: userDoc.id, ...userDoc.data() };

    const existingRecordSnapshot = await EmailVerification.where(
      "email",
      "==",
      email,
    )
      .limit(1)
      .get();

    if (!existingRecordSnapshot.empty) {
      const existingRecord = existingRecordSnapshot.docs[0].data();
      const updatedAtValue = existingRecord.updatedAt
        ? existingRecord.updatedAt.toDate
          ? existingRecord.updatedAt.toDate().getTime()
          : new Date(existingRecord.updatedAt).getTime()
        : 0;

      const timeSinceLastSent = Date.now() - updatedAtValue;
      if (timeSinceLastSent < 60000) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Please wait before requesting another code.",
        );
        return res.status(429).json({
          message: "Please wait before requesting another code.",
        });
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
      email,
      code: hashedCode,
      expiresAt,
      updatedAt: new Date(),
    };

    if (!existingRecordSnapshot.empty) {
      const docRef = existingRecordSnapshot.docs[0].ref;
      await docRef.set(verificationPayload, { merge: true });
    } else {
      const docId = `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      verificationPayload.createdAt = new Date();
      await EmailVerification.doc(docId).set(verificationPayload);
    }
    await createNotification({
      notificationId: generateNotificationId("security"),
      recipientId: user.uid || user.id,
      recipientEmail: email,
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
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      message: "Verification code sent, check your email",
      email,
    });
  } catch (error) {
    console.error("Forgot Password Error:", error.message);
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
export const changePassword = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "changePasswordController";
  const action = "changePassword";
  const { email, password, confirmPassword } = req.body;

  const verificationSnapshot = await EmailVerification.where(
    "email",
    "==",
    email,
  )
    .limit(1)
    .get();
  const record = !verificationSnapshot.empty
    ? verificationSnapshot.docs[0].data()
    : null;

  if (!record || !record.verified) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Email not verified for password reset",
    );
    return res
      .status(403)
      .json({ message: "Email not verified for password reset" });
  }

  if (!password || !confirmPassword || password !== confirmPassword) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Passwords do not match or are missing",
    );
    return res
      .status(400)
      .json({ message: "Passwords do not match or are missing" });
  }

  try {
    const rawIp =
      req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
    const ip = rawIp.split(",")[0].trim();
    const geo = geoip.lookup(ip);
    const currentCountry = geo ? geo.country : "Unknown";

    const userSnapshot = await User.where("email", "==", email).limit(1).get();
    if (userSnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const userDocRef = userSnapshot.docs[0].ref;
    const userData = userSnapshot.docs[0].data();
    const userId = userData.uid || userSnapshot.docs[0].id;
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

    const hashedPassword = await bcrypt.hash(password, 10);

    await userDocRef.set(
      {
        password: hashedPassword,
        updatedAt: new Date(),
      },
      { merge: true },
    );

    const batch = UserSessions.firestore.batch();
    sessionsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    if (!verificationSnapshot.empty) {
      await verificationSnapshot.docs[0].ref.delete();
    }

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

    await createNotification({
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
    });

    notifyAdmins(
      { role: ["super_admin", "support"] },
      {
        notificationId: generateNotificationId("admin_notification"),
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
    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Password change error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Internal server error" });
  }
};
export const verifyStudent = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyStudentController";
  const action = "verifyStudent";
  const { school_id, matriculation_number } = req.body;

  try {
    const schoolConfigSnapshot = await SchoolConfiguration.where(
      "schoolId",
      "==",
      school_id,
    )
      .limit(1)
      .get();

    if (schoolConfigSnapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "iCampus is not active at this institution.",
      );
      return res
        .status(400)
        .json({ message: "iCampus is not active at this institution." });
    }

    const schoolConfig = schoolConfigSnapshot.docs[0].data();

    if (!schoolConfig.isOperational) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "iCampus is not active at this institution.",
      );
      return res
        .status(400)
        .json({ message: "iCampus is not active at this institution." });
    }
    const schoolApiResponse = await fetch(
      schoolConfig.externalApiConfig.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-iCampus-API-Key": schoolConfig.externalApiConfig.sharedSecret,
        },
        body: JSON.stringify({
          student_id: matriculation_number,
          role: "student",
        }),
      },
    );

    if (!schoolApiResponse.ok) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Student record not found in school directory.",
      );
      return res
        .status(404)
        .json({ message: "Student record not found in school directory." });
    }

    const schoolStudent = await schoolApiResponse.json();
    logControllerPerformance(controllerName, action, startTime, "success");

    return res.json({
      firstname: schoolStudent.first_name,
      lastname: schoolStudent.last_name,
      department: schoolStudent.faculty_dept,
      current_level: schoolStudent.level,
      schoolAvatarUrl: schoolStudent.profile_picture_url,
      isStillInSchool: schoolStudent.isStillInSchool,
      matricNumber: matriculation_number,
      isVerified: true,
    });
  } catch (err) {
    console.error("External institutional verification failed:", err.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    return res
      .status(500)
      .json({ message: "Unable to reach school verification system." });
  }
};
export const verifyLecturer = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifyLecturerController";
  const action = "verifyLecturer";
  const { school_id, staff_id: incomingStaffId } = req.body;

  if (!school_id || !incomingStaffId) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Missing required fields",
    );
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
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "iCampus is not operational or active at this institution.",
      );
      return res.status(400).json({
        message: "iCampus is not operational or active at this institution.",
        verified: false,
      });
    }

    const schoolConfig = schoolConfigSnapshot.docs[0].data();

    if (!schoolConfig.isOperational) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "iCampus is not operational or active at this institution.",
      );
      return res.status(400).json({
        message: "iCampus is not operational or active at this institution.",
        verified: false,
      });
    }
    const portalResponse = await fetch(
      schoolConfig.externalApiConfig.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-iCampus-API-Key": schoolConfig.externalApiConfig.sharedSecret,
        },
        body: JSON.stringify({
          staff_id: incomingStaffId,
          role: "lecturer",
        }),
      },
    );

    if (!portalResponse.ok) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Instructor credentials not found in school records",
      );
      return res.status(404).json({
        message: "Instructor credentials not found in school records",
      });
    }

    const externalLecturer = await portalResponse.json();
    const lecturerData = {
      firstname: externalLecturer.first_name,
      lastname: externalLecturer.last_name,
      department: externalLecturer.department,
      staff_id: externalLecturer.staff_id,
    };

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.json({
      firstname: lecturerData.firstname,
      lastname: lecturerData.lastname,
      department: lecturerData.department,
      staff_id: lecturerData.staff_id,
      isVerified: true,
    });
  } catch (err) {
    console.error("Lecturer Verification error:", err.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    return res
      .status(500)
      .json({ message: "Server error during verification", verified: false });
  }
};