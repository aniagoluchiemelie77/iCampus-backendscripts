// Admin activity trail: what each administrator changed, sent or exported.
// Super admins read it from the Access Control screens.
import { setImmediate } from "timers";
import { AdminActivityLog } from "../tableDeclarations.js";

const fullName = (a) => [a?.firstname, a?.lastname].filter(Boolean).join(" ").trim() || "Administrator";
const ipOf = (req) =>
  String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();

/** Records one action. Never blocks or fails the request. */
export const recordAdminActivity = (req, action, details = {}) => {
  const actor = req.admin;
  if (!actor?.uid) return;
  setImmediate(() => {
    AdminActivityLog.add({
      actorUid: actor.uid,
      actorName: fullName(actor),
      actorType: actor.adminType || null,
      schoolCode: actor.schoolCode || null,
      action,
      method: req.method,
      path: req.originalUrl?.split("?")[0] || null,
      details,
      ipAddress: ipOf(req),
      createdAt: new Date(),
    }).catch((err) => console.error("Admin activity log error:", err.message));
  });
};

// "POST /admins/ads/create" → "ads create"; ids are dropped so similar
// actions group together in the feed.
const describe = (req) =>
  (req.originalUrl || "")
    .split("?")[0]
    .replace(/^\/admins\/?/, "")
    .split("/")
    .filter((part) => part && !/\d/.test(part) && part.length < 40)
    .join(" ")
    .replace(/-/g, " ") || "request";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Logged by their controllers with richer details.
const SELF_LOGGED = [/\/exports?$/, /\/export$/];

/**
 * Router middleware: logs every successful write an admin makes. Runs on
 * "finish", by which time verifyAdmin has set req.admin.
 */
export const adminActivityMiddleware = (req, res, next) => {
  if (MUTATING.has(req.method) && !SELF_LOGGED.some((re) => re.test(req.path))) {
    res.on("finish", () => {
      if (res.statusCode < 400) {
        recordAdminActivity(req, describe(req), { status: res.statusCode, params: req.params || {} });
      }
    });
  }
  next();
};
