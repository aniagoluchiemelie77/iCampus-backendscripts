import jwt from "jsonwebtoken";

// Short-lived signed proof that a signup step really happened on the server
// (school directory lookup, email code). signUp only trusts identity fields
// that come out of one of these, so the verification can't be skipped by
// calling /users/register directly.
const PROOF_TTL = "45m";

export const issueSignupProof = (kind, claims) =>
  jwt.sign({ ...claims, kind, purpose: "signup_proof" }, process.env.JWT_SECRET, {
    expiresIn: PROOF_TTL,
  });

/** Returns the claims, or null when missing/invalid/expired/wrong kind. */
export const readSignupProof = (token, kind) => {
  if (!token || typeof token !== "string") return null;
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (claims?.purpose !== "signup_proof" || claims?.kind !== kind) return null;
    return claims;
  } catch {
    return null;
  }
};
