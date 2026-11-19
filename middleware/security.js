import crypto from "crypto";
import helmet from "helmet";

/**
 * HTTP hardening shared by Express and Socket.IO. Everything here is driven by
 * environment variables so production can be locked down without code changes
 * (see SECURITY.md for the full deployment checklist).
 *
 *   ALLOWED_ORIGINS        Comma-separated browser origins allowed by CORS,
 *                          e.g. "https://useicampus.io,https://admin.useicampus.io".
 *                          Requests with no Origin header (the mobile app,
 *                          server-to-server webhooks) are always allowed.
 *   ORIGIN_SHARED_SECRET   Value Cloudflare injects as the X-Origin-Auth header
 *                          (Transform Rule). When set, requests without it are
 *                          rejected, so nobody can skip the WAF by calling the
 *                          *.onrender.com / *.appspot.com URL directly.
 */

const parseOrigins = () =>
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

/** Shared by Express `cors()` and the Socket.IO server. */
export const corsOrigin = (origin, callback) => {
  const allowed = parseOrigins();
  // No Origin header: native app or server-to-server call. No allowlist
  // configured: keep the old permissive behaviour (logged once at boot).
  if (!origin || allowed.length === 0) return callback(null, true);
  if (allowed.includes(origin.replace(/\/+$/, ""))) return callback(null, true);
  return callback(null, false);
};

export const warnIfCorsOpen = () => {
  if (parseOrigins().length === 0) {
    console.warn(
      "[SECURITY] ALLOWED_ORIGINS is not set: any website can call this API from a browser. Set it in production.",
    );
  }
  if (!process.env.ORIGIN_SHARED_SECRET) {
    console.warn(
      "[SECURITY] ORIGIN_SHARED_SECRET is not set: the origin accepts traffic that bypassed Cloudflare.",
    );
  }
};

export const securityHeaders = () =>
  helmet({
    // A JSON API: nothing here should ever be framed or render HTML/scripts.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    // Two years, subdomains included. Only add `preload` once every
    // subdomain is HTTPS-only (it is hard to undo).
    strictTransportSecurity: {
      maxAge: 63072000,
      includeSubDomains: true,
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  });

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/**
 * Rejects requests that did not come through Cloudflare. Health checks from
 * the hosting platform hit `/healthz`, which stays open.
 */
export const requireEdgeOrigin = (req, res, next) => {
  const secret = process.env.ORIGIN_SHARED_SECRET;
  if (!secret || req.path === "/healthz") return next();
  const presented = req.headers["x-origin-auth"];
  if (presented && safeEqual(presented, secret)) return next();
  return res.status(403).json({ error: "Forbidden" });
};

/** Same check for the Socket.IO handshake (it does not pass through Express). */
export const socketCameThroughEdge = (handshakeHeaders = {}) => {
  const secret = process.env.ORIGIN_SHARED_SECRET;
  if (!secret) return true;
  const presented = handshakeHeaders["x-origin-auth"];
  return !!presented && safeEqual(presented, secret);
};

// Query parameters that must never reach the logs.
const SENSITIVE_QUERY = /([?&](?:token|access_token|refresh_token|code|signature|key|apikey|api_key|password|otp)=)[^&]*/gi;

export const redactUrl = (url = "") => url.replace(SENSITIVE_QUERY, "$1[redacted]");

export const requestLogger = (req, res, next) => {
  console.log(`🔗 ${req.method} ${redactUrl(req.originalUrl || req.url)}`);
  next();
};

/**
 * Final error handler: 4xx messages are meant for the client; 5xx details
 * (stack traces, library internals, sometimes query fragments) are logged but
 * never returned.
 */
export const errorHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON request body" });
  }
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large" });
  }
  const status = Number(error?.status) || 500;
  console.error("Unhandled Express error:", error);
  return res.status(status).json({
    error: status < 500 && error?.message ? error.message : "Internal server error",
  });
};
