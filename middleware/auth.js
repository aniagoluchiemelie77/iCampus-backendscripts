import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { User, Admin } from "../tableDeclarations.js";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "path";
import { db } from "../config/firebaseAdmin.js";
const IDEMPOTENCY_COLLECTION = "idempotency_keys";

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

    return next();
  } catch (err) {
    console.error("Admin verification error:", err);
    return res.status(500).json({ error: "Server error during authorization" });
  }
};
export const idempotencyMiddleware = async (req, res, next) => {
  const idempotencyKey =
    req.headers["idempotency-key"] || req.headers["x-idempotency-key"];

  if (!idempotencyKey) {
    return next();
  }

  const keyDocRef = db.collection(IDEMPOTENCY_COLLECTION).doc(idempotencyKey);

  try {
    const doc = await keyDocRef.get();

    if (doc.exists) {
      const data = doc.data();
      if (data.status === "PROCESSING") {
        return res.status(409).json({
          error:
            "A request with this idempotency key is already being processed. Please wait.",
        });
      }
      if (data.status === "COMPLETED") {
        console.log(`[Idempotency] Cache hit for key: ${idempotencyKey}`);
        return res.status(data.statusCode).json(data.responseBody);
      }
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await keyDocRef.set({
      status: "PROCESSING",
      createdAt: new Date(),
      expiresAt: expiresAt,
    });

    const originalJson = res.json.bind(res);

    res.json = async (body) => {
      const statusCode = res.statusCode;
      setImmediate(async () => {
        try {
          await keyDocRef.set({
            status: "COMPLETED",
            statusCode: statusCode,
            responseBody: body,
            completedAt: new Date(),
            expiresAt: expiresAt,
          });
        } catch (cacheError) {
          console.error("[Idempotency] Failed to cache response:", cacheError);
        }
      });
      return originalJson(body);
    };

    return next();
  } catch (error) {
    console.error("[Idempotency Middleware Error]:", error);
    return next();
  }
};
export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.query?.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized: Token missing" });
  }

  try {
    let decoded;
    let uid;
    let tableType = "user";

    if (token.length > 500) {
      decoded = await admin.auth().verifyIdToken(token);
      uid = decoded.uid;
    } else {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      uid = decoded.id || decoded.uid;
      tableType = decoded.role || "user";
    }

    const collectionName = tableType === "admin" ? "admins" : "users";
    const querySnapshot = await db
      .collection(collectionName)
      .where("uid", "==", uid)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      return res.status(401).json({ message: "User not found in records" });
    }

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data();

    req.user = {
      id: userData.uid || uid,
      uid: userData.uid || uid,
      docId: userDoc.id,
      role: tableType,
      ...userData,
    };

    return next();
  } catch (error) {
    console.error("Auth Error:", error.message);
    return res.status(401).json({ message: "Token invalid or expired" });
  }
};
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error:
      "Too many security-related attempts. Please try again in 15 minutes.",
  },
  validate: { xForwardedForHeader: false },
});