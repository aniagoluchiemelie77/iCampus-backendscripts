import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { User, Admin } from "../tableDeclarations.js";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "path";

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
    let uid;
    if (token.length > 500) {
      decoded = await admin.auth().verifyIdToken(token);
      uid = decoded.uid;
    } else {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      uid = decoded.id || decoded.uid;
    }
    const querySnapshot = await User.where("uid", "==", uid).limit(1).get();

    if (querySnapshot.empty) {
      return res
        .status(401)
        .json({ message: "User not found in iCampus records" });
    }

    const userDoc = querySnapshot.docs[0];
    const user = {
      id: userDoc.data().uid || uid,
      docId: userDoc.id,
      ...userDoc.data(),
    };

    req.user = user;
    req.user.id = user.uid || uid;
    next();
  } catch (error) {
    console.error("Auth Error:", error.message);
    res.status(401).json({ message: "Token invalid or expired" });
  }
};
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error:
      "Too many security-related attempts. Please try again in 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

export const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 25 },
});
export const verifyAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const querySnapshot = await Admin.where("uid", "==", req.user.uid)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      return res.status(403).json({
        error: "Access denied. Administrative privileges required.",
      });
    }

    const adminDoc = querySnapshot.docs[0];
    req.admin = {
      id: adminDoc.id,
      ...adminDoc.data(),
    };

    next();
  } catch (err) {
    console.error("Admin verification error:", err);
    res.status(500).json({ error: "Server error during authorization" });
  }
};