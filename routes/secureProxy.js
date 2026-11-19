import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import multer from "multer";
import { protect } from "../middleware/auth.js";
import {
  createCloudinaryUploadSignature,
  createFirebaseCustomToken,
  exchangeGithubCode,
  extractAssessmentQuestions,
  getExchangeRates,
  lookupCardBin,
} from "../controllers/secureProxyControllers.js";

/** Server-side stand-ins for calls that used to need keys inside the apps. */
const router = Router();

// Question papers: PDFs, photos of pages and plain-text files, kept in memory.
const QUESTION_PAPER_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|text\/plain)$/i;
const questionPaperUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (QUESTION_PAPER_TYPES.test(file.mimetype)) return cb(null, true);
    const error = new Error("Only PDF, image or text files are supported.");
    error.status = 415;
    return cb(error);
  },
});

const perUser = (windowMs, max) =>
  rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req.ip),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down and try again shortly." },
  });

const githubLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in a few minutes." },
});

// Sign-in happens before the user has a session, so this one is not `protect`ed.
router.post("/github/exchange", githubLimiter, exchangeGithubCode);

// Signed-in users, or anonymous signup photo uploads (see the controller).
const protectIfToken = (req, res, next) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? protect(req, res, next)
    : anonymousUploadLimiter(req, res, next);
const anonymousUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many uploads. Try again in a few minutes." },
});

router.post(
  "/uploads/cloudinary-signature",
  protectIfToken,
  perUser(60 * 1000, 30),
  createCloudinaryUploadSignature,
);
router.post("/firebase-token", protect, perUser(60 * 1000, 10), createFirebaseCustomToken);
router.get("/exchange-rates", protect, perUser(60 * 1000, 30), getExchangeRates);
router.get("/cards/bin/:bin", protect, perUser(60 * 1000, 10), lookupCardBin);
router.post(
  "/ai/extract-assessment-questions",
  protect,
  perUser(60 * 60 * 1000, 30),
  questionPaperUpload.array("files", 5),
  extractAssessmentQuestions,
);

export default router;
