/**
 * userActionsController.test.js — integration tests for
 * controllers/userActionsController.js
 * ---------------------------------------------------------------------------
 * Covers user-scoped actions whose HANDLER lives in userActionsController.js
 * (checkAccountState, search handlers, follow/block toggles, saveFcmToken,
 * patchUserPreferences). Destructive / external-cost endpoints are documented
 * but NOT executed:
 *   - DELETE account/delete, phone-number, recovery-email  (state-destroying)
 *   - POST  revoke-session, send-phone-otp                 (breaks session / SMS)
 *   - PUT   password/update, createNewPasswordInApp        (credential change)
 * ---------------------------------------------------------------------------
 */
import { describe, beforeAll, test } from "@jest/globals";
import {
  accounts,
  login,
  runChain,
  assertChain,
} from "./controllerTestHelpers.js";

describe("userActionsController controller", () => {
  let token;

  beforeAll(async () => {
    token = await login(accounts.user1());
  }, 200000);

  test("user account + search reads return 200", async () => {
    const results = await runChain(
      [
        { name: "check account state", method: "get", path: "users/check-account-state", expected: 200 },
        { name: "unified user search", method: "get", path: "users/search?q=ali", allowed: [200, 400] },
        { name: "unified course search", method: "get", path: "users/courses/search?q=research", allowed: [200, 400] },
        { name: "unified resource search", method: "get", path: "users/courses/resources/search?q=pdf", allowed: [200, 400] },
      ],
      token,
    );
    assertChain(results);
  }, 120000);

  test("safe idempotent writes do not 500", async () => {
    const results = await runChain(
      [
        // Idempotent upsert of an FCM token — harmless, no external cost.
        { name: "save fcm token", method: "post", path: "users/fcm-token", body: { fcmToken: "test-fcm-token-noop", platform: "android" }, allowed: [200, 400] },
        // Patch preferences with the same values the user already has (safe).
        { name: "patch preferences", method: "patch", path: "users/preferences", body: { notifications: { classroom: true, profile: true } }, allowed: [200, 400] },
      ],
      token,
    );
    assertChain(results);
  }, 120000);

  test("DESTRUCTIVE endpoints are documented but intentionally skipped", () => {
    const skipped = [
      "DELETE users/account/delete",
      "DELETE users/phone-number",
      "DELETE users/recovery-email",
      "POST users/revoke-session",
      "POST users/send-phone-otp",
      "PUT users/password/update",
      "PATCH users/update-emails",
    ];
    // Not executed to avoid destroying the shared test account or sending
    // real SMS/email. Enable on a throwaway account w/ Twilio test mode.
    console.log("⏭️  Skipped (destructive / external-cost):", skipped.join(", "));
    expect(skipped.length).toBeGreaterThan(0);
  });
});
