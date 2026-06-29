import {
  User,
  OperationalInstitutions,
  iTag,
  EmailVerification,
  SchoolConfiguration,
  userPrefs,
  Admin,
} from "../tableDeclarations.js";
import { getChannel } from "../rabbitmq.js";
import crypto from "crypto";
import geoip from "geoip-lite";
import {
  generateNotificationId,
  generateUniqueCardNumber,
  generateUserUID,
  generateTokens,
  generateCode,
  generateUniqueReferralCode,
} from "../utils/idGenerator.js";
import {
  verifyGoogleToken,
  verifyGithubToken,
} from "../api/foreignFetchApis.js";
import bcrypt from "bcrypt";
import { generateExpiryDate } from "../utils/dateHelper.js";
import jwt from "jsonwebtoken";
import { createNotification } from "../services/notificationService.js";
import { client } from "../workers/reditFile.js";
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
  const {
    usertype,
    email,
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
    let hashedPassword = null;
    if (password && password !== "SOCIAL_AUTH") {
      hashedPassword = await bcrypt.hash(password, 10);
    }
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
    const defaultPreferences = new userPrefs({
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
    });
    await defaultPreferences.save();
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
    safeUser.theme = defaultPreferences.theme;
    await createNotification({
      notificationId: generateNotificationId("signup"),
      recipientId: newUser.uid,
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
};
export const Login = async (req, res) => {
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
    if (!user)
      return res
        .status(404)
        .json({ error: "Account not found. Please sign up first." });
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
      if (!isMatch) return res.status(401).json({ error: "Invalid password" });
    }
    if (socialProvider && user.providerId !== socialProvider) {
      return res.status(400).json({
        error: `This account was created using ${user.providerId || "a password"}. Please log in using that method.`,
      });
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
    const existingSessionIndex = user.sessions.findIndex(
      (s) => s.deviceId === deviceId,
    );
    if (existingSessionIndex > -1) {
      user.sessions[existingSessionIndex] = sessionData;
    } else {
      user.sessions.push(sessionData);
      await createNotification({
        notificationId: generateNotificationId("security"),
        recipientId: user.uid,
        recipientEmail: user.email,
        recoveryEmails: user.recoveryEmails,
        category: "auth",
        actionType: "NEW_LOGIN",
        title: "Security Alert: New Login",
        payload: {
          userName: user.firstname,
          ipAddress: ip,
          location: location,
          date: formattedDate,
          time: formattedTime,
        },
        message: `A login was detected from ${ip} in ${location}.`,
        sendEmail: true,
        saveToDb: true,
      });
    }
    await user.save();
    const preferences = await userPrefs
      .findOne({
        userId: user.uid,
      })
      .lean();
    const {
      password: _,
      iCashPin: _,
      userAccountDetails: _,
      ...safeUser
    } = user.toObject();
    safeUser.theme = preferences ? preferences.theme : "light";
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
};
export const AdminLogin = async (req, res) => {
  const { identifier, password, deviceId, deviceName } = req.body;

  try {
    const admin = await Admin.findOne({ email: identifier });
    if (!admin)
      return res.status(404).json({ error: "Admin credentials invalid." });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const { accessToken, refreshToken } = await generateTokens(admin);

    // 4. Handle Session
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
    const existingSessionIndex = admin.sessions.findIndex(
      (s) => s.deviceId === deviceId,
    );

    if (existingSessionIndex > -1) {
      admin.sessions[existingSessionIndex] = sessionData;
    } else {
      admin.sessions.push(sessionData);
    }

    admin.lastAccessed = new Date();
    await admin.save();
    const { password: _, ...safeAdmin } = admin.toObject();

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
};
export const fetchInstitutionByCountry = async (req, res) => {
  try {
    const { country } = req.query;

    if (!country) {
      return res.status(400).json({ message: "Country is required" });
    }

    const normalizedCountry = country.trim();
    const cacheKey = `institutions:${normalizedCountry}`;

    try {
      const cached = await client.get(cacheKey);
      if (cached) {
        return res.json({ cached: true, ...JSON.parse(cached) });
      }
    } catch (err) {
      console.error("Redis Cache Error:", err);
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=universities+in+${encodeURIComponent(normalizedCountry)}&key=${apiKey}`;
    const response = await axios.get(url);

    if (
      response.data.status !== "OK" &&
      response.data.status !== "ZERO_RESULTS"
    ) {
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
    return res.json(responsePayload);
  } catch (error) {
    console.error("Institutions fetch error:", error.message);
    return res.status(500).json({ message: "Failed to retrieve institutions" });
  }
};
export const validateInstitution = async (req, res) => {
  try {
    const { schoolName } = req.body;
    if (!schoolName)
      return res.status(400).json({ message: "School name required" });
    const institution = await OperationalInstitutions.findOne({
      schoolName: { $regex: new RegExp(`^${schoolName.trim()}$`, "i") },
    }).lean();
    if (!institution) {
      return res.status(404).json({
        verified: false,
        message:
          "iCampus not yet operational in this institution. Student/Lecturer verification is unavailable.",
      });
    }
    return res.status(200).json({
      message: "Institution verified",
      schoolName: institution.schoolName,
      schoolCode: institution.schoolCode,
      verified: true,
      logo: institution.logo,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
export const validateEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await EmailVerification.findOneAndUpdate(
      { email },
      { code: hashedCode, expiresAt },
      { upsert: true, new: true },
    );
    const channel = getChannel();
    await channel.assertQueue("emailQueue");
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
};
export const verifyEmailUsingCode = async (req, res) => {
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
};
export const forgotPassword = async (req, res) => {
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
    await EmailVerification.findOneAndUpdate(
      { email },
      { code: hashedCode, expiresAt },
      { upsert: true, new: true },
    );
    await createNotification({
      notificationId: generateNotificationId("security"),
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
      sendEmail: true,
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
};
export const changePassword = async (req, res) => {
  const { email, password, confirmPassword } = req.body;
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
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.refreshTokens = [];
    await user.save();

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
        date: formattedDate,
        time: formattedTime,
      },
      sendEmailFlag: true,
      sendEmail: true,
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    });
    delete verificationCodes[email];
    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Password change error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
export const verifyStudent = async (req, res) => {
  const { school_id, matriculation_number } = req.body;

  try {
    const schoolConfig = await SchoolConfiguration.findOne({
      schoolId: school_id,
    });
    if (!schoolConfig || !schoolConfig.isOperational) {
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
      return res
        .status(404)
        .json({ message: "Student record not found via school directory." });
    }
    const schoolStudent = await schoolApiResponse.json();
    return res.json({
      firstname: schoolStudent.first_name,
      lastname: schoolStudent.last_name,
      department: schoolStudent.faculty_dept,
      current_level: schoolStudent.level,
      schoolAvatarUrl: schoolStudent.profile_picture_url,
      matricNumber: matriculation_number,
      isVerified: true,
    });
  } catch (err) {
    console.error("External institutional verification failed:", err);
    return res
      .status(500)
      .json({ message: "Unable to reach school verification system." });
  }
};
export const verifyLecturer = async (req, res) => {
  const { school_id, staff_id: incomingStaffId } = req.body;
  if (!school_id || !incomingStaffId) {
    return res
      .status(400)
      .json({ message: "Missing required fields", verified: false });
  }

  try {
    const schoolConfig = await SchoolConfiguration.findOne({
      schoolId: school_id,
    });

    if (!schoolConfig || !schoolConfig.isOperational) {
      return res.status(400).json({
        message: "iCampus is not operational or active at this institution.",
        verified: false,
      });
    }

    let lecturerData;
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
      return res
        .status(404)
        .json({ message: "Instructor credentials not found on portal" });
    }

    const externalLecturer = await portalResponse.json();
    lecturerData = {
      firstname: externalLecturer.first_name,
      lastname: externalLecturer.last_name,
      department: externalLecturer.department,
      staff_id: externalLecturer.staff_id,
    };

    return res.json({
      firstname: lecturerData.firstname,
      lastname: lecturerData.lastname,
      department: lecturerData.department,
      staff_id: lecturerData.staff_id,
      isVerified: true,
    });
  } catch (err) {
    console.error("Lecturer Verification error:", err);
    return res
      .status(500)
      .json({ message: "Server error during verification", verified: false });
  }
};