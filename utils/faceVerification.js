// Face verification for attendance and proctored tests.
//
// Latency work lives here:
//  1. Reference photos are cached in memory (no re-download per check).
//  2. Models are raced ("hedged"): if the first hasn't answered within
//     FACE_HEDGE_MS, the next starts in parallel and the first good answer
//     wins. A failed attempt starts the next model at once. Every attempt
//     has its own timeout, so one stalled call can't hang the request.
//  3. Images are capped at medium resolution and the reply is a short,
//     schema-fixed JSON object.
//
// The decision stays on the server: the app only sends the selfie, and the
// reference photo comes from the student's own record.
import axios from "axios";
import { geminiModel, isGeminiTransientError } from "./gemini.js";

// ---------------------------------------------------------------------------
// Settings (override in .env)
// ---------------------------------------------------------------------------
const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const HEDGE_MS = () => num(process.env.FACE_HEDGE_MS, 2500);
const ATTEMPT_TIMEOUT_MS = () => num(process.env.FACE_ATTEMPT_TIMEOUT_MS, 6000);
const TOTAL_TIMEOUT_MS = () => num(process.env.FACE_TOTAL_TIMEOUT_MS, 12000);

/** Fastest first. Override with FACE_GEMINI_MODELS="a,b,c". */
export const faceModels = () => {
  const configured = process.env.FACE_GEMINI_MODELS?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [
    ...new Set([
      ...(configured?.length
        ? configured
        : ["gemini-2.5-flash-lite", "gemini-2.5-flash"]),
      geminiModel(),
    ]),
  ];
};

// ---------------------------------------------------------------------------
// Reference photo cache
// ---------------------------------------------------------------------------
const REF_TTL_MS = 6 * 60 * 60 * 1000;
const REF_MAX_BYTES = 60 * 1024 * 1024; // whole cache, per instance
const REF_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const refCache = new Map(); // url -> { data, mimeType, bytes, expiresAt }
const refInFlight = new Map(); // url -> Promise
let refCacheBytes = 0;

const evictRef = (url) => {
  const entry = refCache.get(url);
  if (!entry) return;
  refCacheBytes -= entry.bytes;
  refCache.delete(url);
};

export class ReferenceImageError extends Error {}

/** Base64 + MIME type of the reference photo, cached per instance. */
export const getReferenceImage = async (url) => {
  const cached = refCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    // Map keeps insertion order: re-insert to mark as recently used.
    refCache.delete(url);
    refCache.set(url, cached);
    return { ...cached, cacheHit: true };
  }
  if (cached) evictRef(url);
  if (refInFlight.has(url)) return refInFlight.get(url);

  const load = (async () => {
    let response;
    try {
      response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 8000,
        maxContentLength: REF_MAX_IMAGE_BYTES,
        maxRedirects: 3,
      });
    } catch (error) {
      throw new ReferenceImageError(error.message);
    }
    const contentType = String(response.headers["content-type"] || "");
    const entry = {
      data: Buffer.from(response.data).toString("base64"),
      mimeType: contentType.startsWith("image/")
        ? contentType.split(";")[0]
        : "image/jpeg",
      bytes: response.data.byteLength,
      expiresAt: Date.now() + REF_TTL_MS,
    };
    refCache.set(url, entry);
    refCacheBytes += entry.bytes;
    for (const oldest of refCache.keys()) {
      if (refCacheBytes <= REF_MAX_BYTES) break;
      evictRef(oldest);
    }
    return { ...entry, cacheHit: false };
  })();

  refInFlight.set(url, load);
  try {
    return await load;
  } finally {
    refInFlight.delete(url);
  }
};

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------
const FACE_RESULT_SCHEMA = {
  type: "object",
  properties: {
    verified: { type: "boolean" },
    faceCount: { type: "integer" },
    lookingAtScreen: { type: "boolean" },
    suspicious: { type: ["string", "null"] },
    reason: { type: "string" },
  },
  required: ["verified", "faceCount", "lookingAtScreen", "reason"],
};

const callModel = (ai, model, contents, signal) =>
  ai.models.generateContent({
    model,
    contents,
    config: {
      abortSignal: signal,
      responseMimeType: "application/json",
      responseJsonSchema: FACE_RESULT_SCHEMA,
      mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
      temperature: 0.1,
      maxOutputTokens: 200,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

const parseResult = (response) => {
  const text = response?.text?.replace(/```json|```/g, "").trim();
  if (!text) throw new Error("Empty face verification reply.");
  const parsed = JSON.parse(text);
  if (typeof parsed?.verified !== "boolean") {
    throw new Error("Face verification reply had no verdict.");
  }
  return parsed;
};

/**
 * Races the face models. Resolves with { result, model, attempts } or
 * rejects with the last error once every model failed or time ran out.
 */
export const compareFaces = (ai, contents) =>
  new Promise((resolve, reject) => {
    const models = faceModels();
    const controllers = [];
    const timers = [];
    let next = 0;
    let running = 0;
    let settled = false;
    let lastError = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      controllers.forEach((c) => c.abort());
      fn(value);
    };

    const failIfDone = () => {
      if (running === 0 && next >= models.length) {
        finish(reject, lastError || new Error("No face model answered."));
      }
    };

    const launch = () => {
      if (settled || next >= models.length) return;
      const model = models[next];
      next += 1;
      running += 1;
      const controller = new AbortController();
      controllers.push(controller);
      timers.push(setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS()));
      // Give the next model a head start if this one is slow.
      const hedgeTimer = setTimeout(launch, HEDGE_MS());
      timers.push(hedgeTimer);

      callModel(ai, model, contents, controller.signal)
        .then((response) =>
          finish(resolve, { result: parseResult(response), model, attempts: next }),
        )
        .catch((error) => {
          running -= 1;
          // Failing early launches the next model below instead.
          clearTimeout(hedgeTimer);
          if (settled) return;
          lastError = controller.signal.aborted
            ? Object.assign(new Error(`${model} timed out`), { status: 504 })
            : error;
          // A bad image fails on every model; don't burn the others.
          const retryable =
            controller.signal.aborted ||
            isGeminiTransientError(lastError) ||
            lastError instanceof SyntaxError ||
            /verdict|Empty face/.test(lastError?.message || "");
          if (!retryable) return finish(reject, lastError);
          launch();
          failIfDone();
        });
    };

    timers.push(
      setTimeout(
        () =>
          finish(
            reject,
            Object.assign(new Error("Face verification timed out."), {
              status: 504,
            }),
          ),
        TOTAL_TIMEOUT_MS(),
      ),
    );
    launch();
  });
