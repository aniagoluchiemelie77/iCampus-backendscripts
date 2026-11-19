import crypto from "crypto";
import jwt from "jsonwebtoken";

/**
 * Two server-checked proofs for Bluetooth attendance:
 *
 * 1. Identity proof. After a selfie matches the student's school photo, the
 *    face-verification endpoint returns a short-lived signed token. The
 *    attendance socket event must carry it, so a client can no longer just
 *    claim "identity confirmed".
 *
 * 2. Rotating beacon code. When a lecturer opens attendance, the server gives
 *    their phone a random per-session secret. The phone advertises
 *    "iC" + a 6-character code derived from that secret and the current
 *    30-second window (TOTP-style) and changes it every window. Students send
 *    the codes they heard; the server recomputes them. A broadcast that was
 *    recorded and replayed to a classmate outside the hall stops working
 *    within about two minutes.
 *
 * The code format must match src/utils/attendance.ts in the mobile app.
 */

export const BEACON_WINDOW_SECONDS = 30;
// Accept codes from this many windows back: scanning, the liveness check and
// the face match can take a minute or so between hearing a code and submitting.
const BEACON_PAST_WINDOWS = 3;
// And one ahead, for a lecturer phone whose clock runs slightly fast.
const BEACON_FUTURE_WINDOWS = 1;

const IDENTITY_PROOF_TTL_SECONDS = 5 * 60;
const IDENTITY_PROOF_PURPOSE = "attendance-identity";

const proofSecret = () => {
  const secret = process.env.ATTENDANCE_PROOF_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("ATTENDANCE_PROOF_SECRET (or JWT_SECRET) is not set.");
  return secret;
};

export const issueIdentityProof = ({ uid, lectureId, method, liveness }) =>
  jwt.sign(
    {
      purpose: IDENTITY_PROOF_PURPOSE,
      method,
      liveness: liveness || null,
      ...(lectureId ? { lectureId: String(lectureId) } : {}),
    },
    proofSecret(),
    {
      algorithm: "HS256",
      subject: String(uid),
      expiresIn: IDENTITY_PROOF_TTL_SECONDS,
    },
  );

/** Returns the decoded proof, or null if it is missing, expired or not for this student/lecture. */
export const verifyIdentityProof = (token, { uid, lectureId }) => {
  if (!token || typeof token !== "string") return null;
  try {
    const decoded = jwt.verify(token, proofSecret(), { algorithms: ["HS256"] });
    if (decoded.purpose !== IDENTITY_PROOF_PURPOSE) return null;
    if (decoded.sub !== String(uid)) return null;
    if (decoded.lectureId && decoded.lectureId !== String(lectureId)) return null;
    return decoded;
  } catch {
    return null;
  }
};

export const createBeaconSecret = () => crypto.randomBytes(16).toString("hex");

export const beaconCodeFor = (secret, lectureId, window) => {
  const hex = crypto
    .createHmac("sha256", secret)
    .update(`${lectureId}:${window}`)
    .digest("hex");
  return parseInt(hex.slice(0, 8), 16).toString(36).toUpperCase().padStart(6, "0").slice(-6);
};

const currentWindow = (nowMs = Date.now(), windowSeconds = BEACON_WINDOW_SECONDS) =>
  Math.floor(nowMs / 1000 / windowSeconds);

/** True when any heard beacon name ("iCXXXXXX" or the bare code) is current for this session. */
export const isFreshBeaconCode = (
  heard,
  { secret, lectureId, windowSeconds = BEACON_WINDOW_SECONDS, nowMs = Date.now() },
) => {
  if (!secret || !Array.isArray(heard) || heard.length === 0) return false;
  const codes = new Set(
    heard
      .slice(0, 20)
      .filter((value) => typeof value === "string")
      .map((value) => value.trim().toUpperCase().replace(/^IC/, ""))
      .filter((value) => /^[0-9A-Z]{6}$/.test(value)),
  );
  if (codes.size === 0) return false;
  const now = currentWindow(nowMs, windowSeconds);
  for (let w = now - BEACON_PAST_WINDOWS; w <= now + BEACON_FUTURE_WINDOWS; w++) {
    if (codes.has(beaconCodeFor(secret, lectureId, w))) return true;
  }
  return false;
};
