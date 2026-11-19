import {
  BEACON_WINDOW_SECONDS,
  beaconCodeFor,
  createBeaconSecret,
  isFreshBeaconCode,
  issueIdentityProof,
  verifyIdentityProof,
} from "../utils/attendanceSecurity.js";

process.env.ATTENDANCE_PROOF_SECRET = "test-proof-secret";

describe("rotating beacon codes", () => {
  const secret = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const lectureId = "lecture-123";
  const now = 1_800_000_000_000;
  const windowNow = Math.floor(now / 1000 / BEACON_WINDOW_SECONDS);

  test("codes are 6 upper-case base36 characters", () => {
    expect(beaconCodeFor(secret, lectureId, windowNow)).toMatch(/^[0-9A-Z]{6}$/);
  });

  test("matches the mobile app's crypto-js output (fixed vector)", () => {
    // crypto-js in the app (src/utils/attendance.ts) gives the same for these inputs.
    expect(beaconCodeFor(secret, lectureId, 60000000)).toBe("YJPDCZ");
  });

  test("accepts the current code, with or without the iC prefix", () => {
    const code = beaconCodeFor(secret, lectureId, windowNow);
    expect(isFreshBeaconCode([code], { secret, lectureId, nowMs: now })).toBe(true);
    expect(isFreshBeaconCode([`iC${code}`], { secret, lectureId, nowMs: now })).toBe(true);
  });

  test("accepts a code from a minute ago, rejects one from five minutes ago", () => {
    const recent = beaconCodeFor(secret, lectureId, windowNow - 2);
    const stale = beaconCodeFor(secret, lectureId, windowNow - 10);
    expect(isFreshBeaconCode([recent], { secret, lectureId, nowMs: now })).toBe(true);
    expect(isFreshBeaconCode([stale], { secret, lectureId, nowMs: now })).toBe(false);
  });

  test("rejects another lecture's or another session's code", () => {
    const otherLecture = beaconCodeFor(secret, "lecture-999", windowNow);
    const otherSecret = beaconCodeFor(createBeaconSecret(), lectureId, windowNow);
    expect(isFreshBeaconCode([otherLecture], { secret, lectureId, nowMs: now })).toBe(false);
    expect(isFreshBeaconCode([otherSecret], { secret, lectureId, nowMs: now })).toBe(false);
  });

  test("ignores junk input", () => {
    expect(isFreshBeaconCode(undefined, { secret, lectureId })).toBe(false);
    expect(isFreshBeaconCode([123, null, "x"], { secret, lectureId })).toBe(false);
  });
});

describe("identity proofs", () => {
  test("valid for the same student and lecture", () => {
    const token = issueIdentityProof({ uid: "u1", lectureId: "L1", method: "selfie", liveness: "passed" });
    expect(verifyIdentityProof(token, { uid: "u1", lectureId: "L1" })?.method).toBe("selfie");
  });

  test("rejected for another student or lecture", () => {
    const token = issueIdentityProof({ uid: "u1", lectureId: "L1", method: "selfie" });
    expect(verifyIdentityProof(token, { uid: "u2", lectureId: "L1" })).toBeNull();
    expect(verifyIdentityProof(token, { uid: "u1", lectureId: "L2" })).toBeNull();
  });

  test("rejected when tampered with or missing", () => {
    const token = issueIdentityProof({ uid: "u1", method: "selfie" });
    expect(verifyIdentityProof(`${token}x`, { uid: "u1", lectureId: "L1" })).toBeNull();
    expect(verifyIdentityProof(undefined, { uid: "u1", lectureId: "L1" })).toBeNull();
  });
});
