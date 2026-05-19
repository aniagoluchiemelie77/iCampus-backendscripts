import jwt from "jsonwebtoken";
import admin from "firebase-admin";
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
import { User, UserRecords } from "../tableDeclarations.js";
import rateLimit from "express-rate-limit";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});
export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.query.token) {
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ message: "Not authorized: Token missing" });
  }
  try {
    let decoded;
    if (token.length > 500) {
      decoded = await admin.auth().verifyIdToken(token);
      var uid = decoded.uid;
    } else {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      var uid = decoded.id || decoded.uid;
    }
    const user = await User.findOne({ uid: uid });
    if (!user) {
      return res
        .status(401)
        .json({ message: "User not found in iCampus records" });
    }
    req.user = user;
    req.user.id = user.uid;
    next();
  } catch (error) {
    console.error("Auth Error:", error.message);
    res.status(401).json({ message: "Token invalid or expired" });
  }
};
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    error:
      "Too many security-related attempts. Please try again in 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
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

const CATEGORY_MAX_PRICES = {
  file: 2000, // Maximum 2,000 iCash for notes/PDFs
  course: 15000, // Maximum 15,000 iCash for premium masterclasses
  physical: 50000, // Maximum 50,000 iCash for heavy gear/electronics
};
productSchema.pre("save", function (next) {
  const price = this.price;
  const type = this.productType;

  // Rule 1: Check against hard ecosystem category limits
  const maxAllowed = CATEGORY_MAX_PRICES[type];
  if (maxAllowed && price > maxAllowed) {
    return next(
      new Error(
        `Price exploitation protection: Maximum limit for type '${type}' is ${maxAllowed} iCash.`,
      ),
    );
  }

  // Rule 2: Anti-scalping protection for flipped secondary assets
  if (this.isResale && this.originalPurchasePrice) {
    const maxMarkupMultiplier = 1.3; // Maximum 30% price inflation allowed
    const absoluteCeiling = this.originalPurchasePrice * maxMarkupMultiplier;

    if (price > absoluteCeiling) {
      return next(
        new Error(
          `Anti-scalping block: Resale prices cannot be inflated by more than 30%. Maximum allowed price for this item is ${absoluteCeiling.toFixed(2)} iCash.`,
        ),
      );
    }
  }

  next();
});