import crypto from "crypto";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import { admin } from "../config/firebaseAdmin.js";
import { fetchExchangeRates } from "../utils/currency.js";
import {
  generateGeminiContent,
  isGeminiQuotaError,
  GEMINI_BUSY_MESSAGE,
} from "../utils/gemini.js";
import { ASSESSMENT_EXTRACTION_PROMPT } from "../utils/aiPrompts.js";

/**
 * Calls that used to run in the mobile app / admin portal with private keys
 * bundled into them (Gemini, GitHub client secret, Cloudinary unsigned preset,
 * exchange-rate and APIVerve keys). Anything shipped in an app bundle can be
 * extracted, so the keys now stay on the server and clients call these.
 */

// ---------------------------------------------------------------------------
// Cloudinary: short-lived signed upload parameters
// ---------------------------------------------------------------------------
// Folders a client may upload into (what the app and admin portal use).
// Anything else is rejected.
const UPLOAD_FOLDERS = new Set([
  "uploads",
  "profile-images",
  "review-attachments",
  "product-thumbnails",
  "chat-attachments",
]);
// Posts go to posts/<uid>; only the signed-in user's own folder.
const isAllowedFolder = (folder, uid) =>
  UPLOAD_FOLDERS.has(folder) || (!!uid && folder === `posts/${uid}`);
const IMAGE_FORMATS = "jpg,jpeg,png,webp,heic,heif,gif";
const VIDEO_FORMATS = "mp4,mov,webm,m4v,3gp";
const DOC_FORMATS = "pdf,doc,docx,ppt,pptx,xls,xlsx,txt,csv,zip";

const signCloudinaryParams = (params, apiSecret) => {
  const toSign = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
};

export const createCloudinaryUploadSignature = (req, res) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(503).json({ error: "Uploads are not configured on the server." });
  }

  const { folder = "uploads", resourceType = "image" } = req.body || {};
  const uid = req.user?.uid;
  // Signup uploads the profile photo before the account exists: anonymous
  // callers may only upload an image to "uploads" (and are IP rate-limited).
  if (!uid && !(folder === "uploads" && resourceType === "image")) {
    return res.status(401).json({ error: "Sign in to upload files." });
  }
  if (!isAllowedFolder(folder, uid)) {
    return res.status(400).json({ error: "Uploads to this folder are not allowed." });
  }
  const formats =
    resourceType === "video"
      ? VIDEO_FORMATS
      : resourceType === "raw"
        ? DOC_FORMATS
        : resourceType === "auto"
          ? [IMAGE_FORMATS, VIDEO_FORMATS, DOC_FORMATS].join(",")
          : IMAGE_FORMATS;

  // Cloudinary rejects signatures older than one hour; the client uploads
  // straight away. Per-file size limits live on the signed upload preset
  // (CLOUDINARY_SIGNED_UPLOAD_PRESET), which Cloudinary enforces.
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${timestamp}-${crypto.randomBytes(6).toString("hex")}`;
  const params = {
    allowed_formats: formats,
    folder,
    public_id: publicId,
    timestamp,
    upload_preset: process.env.CLOUDINARY_SIGNED_UPLOAD_PRESET || undefined,
  };
  return res.json({
    cloudName,
    apiKey,
    signature: signCloudinaryParams(params, apiSecret),
    ...params,
  });
};

// ---------------------------------------------------------------------------
// GitHub OAuth: code exchange (the client secret must not ship in the app)
// ---------------------------------------------------------------------------
export const exchangeGithubCode = async (req, res) => {
  const { code, codeVerifier, redirectUri } = req.body || {};
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Missing authorization code." });
  }
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return res.status(503).json({ error: "GitHub sign-in is not configured." });
  }
  try {
    const { data } = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      },
      { headers: { Accept: "application/json" }, timeout: 10000 },
    );
    if (!data?.access_token) {
      return res.status(401).json({ error: "GitHub sign-in failed. Please try again." });
    }
    return res.json({ accessToken: data.access_token, scope: data.scope });
  } catch (error) {
    console.error("[GITHUB_OAUTH] exchange failed:", error.message);
    return res.status(502).json({ error: "Could not reach GitHub. Please try again." });
  }
};

// ---------------------------------------------------------------------------
// Exchange rates and card BIN lookup
// ---------------------------------------------------------------------------
export const getExchangeRates = async (req, res) => {
  try {
    const rates = await fetchExchangeRates();
    res.set("Cache-Control", "private, max-age=3600");
    return res.json({ base: "USD", conversion_rates: rates });
  } catch (error) {
    return res.status(502).json({ error: "Exchange rates are unavailable right now." });
  }
};

export const lookupCardBin = async (req, res) => {
  const bin = String(req.params.bin || "");
  // Only the first 6–8 digits: never accept (or log) a full card number.
  if (!/^\d{6,8}$/.test(bin)) {
    return res.status(400).json({ error: "Send the first 6 to 8 digits of the card." });
  }
  try {
    const binlist = await axios
      .get(`https://lookup.binlist.net/${bin}`, { timeout: 5000 })
      .catch(() => null);
    if (binlist?.data) return res.json(binlist.data);
    if (!process.env.VERVE_SEARCH_API_KEY) return res.status(404).json({ error: "Card not found." });
    const verve = await axios.get(`https://api.apiverve.com/v1/binlookup?bin=${bin}`, {
      headers: { "x-api-key": process.env.VERVE_SEARCH_API_KEY },
      timeout: 5000,
    });
    return res.json(verve.data);
  } catch (error) {
    return res.status(404).json({ error: "Card not found." });
  }
};

// ---------------------------------------------------------------------------
// AI: assessment question extraction (was called from the app with a bundled
// Gemini key). Lecturers only; files arrive via multer (memory, PDF/images).
// ---------------------------------------------------------------------------
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

export const extractAssessmentQuestions = async (req, res) => {
  if (req.user?.usertype !== "lecturer") {
    return res.status(403).json({ error: "Only lecturers can import question papers." });
  }
  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) return res.status(400).json({ error: "Attach at least one file." });
  const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
  if (total > MAX_INLINE_BYTES) {
    return res.status(413).json({
      error: "These files are too large together. Use fewer pages or compress the PDF (max ~18MB).",
    });
  }

  const parts = files.map((file) => ({
    inlineData: { mimeType: file.mimetype, data: file.buffer.toString("base64") },
  }));
  parts.push({ text: ASSESSMENT_EXTRACTION_PROMPT });

  try {
    const response = await generateGeminiContent(ai, {
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const text = (response.text || "").replace(/```json|```/g, "").trim();
    if (!text) return res.status(422).json({ error: "No questions could be read from these files." });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "The extractor returned an unreadable result. Please try again." });
    }
    const questions = Array.isArray(parsed) ? parsed : parsed?.questions;
    return res.json({ questions: Array.isArray(questions) ? questions : [] });
  } catch (error) {
    if (isGeminiQuotaError(error)) return res.status(503).json({ error: GEMINI_BUSY_MESSAGE });
    console.error("[AI_EXTRACT] failed:", error.message);
    return res.status(502).json({ error: "Could not reach the extraction service." });
  }
};

// ---------------------------------------------------------------------------
// Firebase custom token: lets the app sign in to Firebase Auth so Storage /
// Firestore security rules can require request.auth and check the tenant.
// ---------------------------------------------------------------------------
export const createFirebaseCustomToken = async (req, res) => {
  try {
    // Custom claims are what security rules read as request.auth.token.*.
    const token = await admin.auth().createCustomToken(String(req.user.uid), {
      schoolCode: req.user.schoolCode || null,
      usertype: req.user.usertype || null,
    });
    return res.json({ token });
  } catch (error) {
    console.error("[FIREBASE_TOKEN] failed:", error.message);
    return res.status(500).json({ error: "Could not start a secure upload session." });
  }
};
