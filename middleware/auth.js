import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
import {User, UserRecords} from '../tableDeclarations.js'; 
import rateLimit from 'express-rate-limit';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Access denied.' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};
export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token missing" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};
export const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 15 minutes
  max: 5, 
  message: {
    error: "Too many login attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true, 
  legacyHeaders: false, 
});
export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.query.token) {
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token provided" });
  }

  try {
    let decoded;
    if (token.length > 500) { 
      decoded = await admin.auth().verifyIdToken(token);
      req.user = { uid: decoded.uid, email: decoded.email };
    } else {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { uid: decoded.id }; 
    }
   const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(401).json({ message: "User not found in iCampus records" });
    req.user = user; 
    next();
  } catch (error) {
    console.error("Auth Error:", error.message);
    res.status(401).json({ message: "Token is invalid or expired" });
  }
};
export const emailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: {
    error: "Too many requests, try again later.",
  },
});
export const addUserRecord = async (userId, type, status, message) => {
  const now = new Date();
  const refDate = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const refTime = now.toTimeString().split(" ")[0]; // HH:MM:SS

  await UserRecords.updateOne(
    { userId },
    {
      $push: {
        records: {
          type,
          status,
          message,
          refDate,
          refTime,
        },
      },
    },
    { upsert: true },
  );
};
