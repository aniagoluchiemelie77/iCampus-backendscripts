/**
 * fetchActions.test.js — integration tests for controllers/fetchActions.js
 * ---------------------------------------------------------------------------
 * Uses the live backend (supertest) via the shared controllerTestHelpers.
 *
 * Endpoints are grouped:
 *   - expected 200 : read endpoints confirmed to work
 *   - allowed      : endpoints whose result depends on test-data ownership
 *                    (200 ok / 403 no access / 404 not found)
 *   - index-gated  : endpoints backed by a Firestore COMPOSITE INDEX. Until the
 *                    index exists these return 500. Run
 *                    `node controllertests/firestoreIndexProbe.mjs` to get the
 *                    click-to-create URLs. We assert allowed [200,403,404] so
 *                    the test goes GREEN once the index is created.
 * ---------------------------------------------------------------------------
 */
import { describe, beforeAll, test } from "@jest/globals";
import {
  accounts,
  login,
  runChain,
  assertChain,
} from "./controllerTestHelpers.js";

describe("fetchActions controller (read endpoints)", () => {
  let token;
  const ctx = {
    userId: "USER_001",
    courseId: "CRSE-RESE0320-261003",
    lectureId: "LECT-RESE0320-261003-1",
    notificationId: "store-2609081848-9661",
    transactionId: "TX-PAYM-260908-2044-7UW",
  };

  beforeAll(async () => {
    token = await login(accounts.user1());
  }, 200000);

  test("safe read endpoints return 200", async () => {
    const results = await runChain(
      [
        { name: "connections", method: "get", path: "users/fetch-connections", expected: 200 },
        { name: "user notifications", method: "get", path: "users/get-notifications", expected: 200 },
        { name: "active ads", method: "get", path: "users/ads/fetch-active", expected: 200 },
        { name: "preferences", method: "get", path: "users/preferences", expected: 200 },
        { name: "blocked users", method: "get", path: "users/blocked-list", expected: 200 },
        { name: "all users", method: "get", path: "users/fetch-all-users", expected: 200 },
        { name: "user sessions", method: "get", path: "users/fetch-sessions", expected: 200 },
        { name: "single notification", method: "get", path: `users/notifications/${ctx.notificationId}`, allowed: [200, 404] },
        // NOTE: `users/payments/banks/:countryCode` proxies Flutterwave's API and
        // passes through Flutterwave's status. Flutterwave isn't set up, so it
        // returns 401. It is intentionally SKIPPED here (payment-gateway dep).
      ],
      token,
    );
    assertChain(results);
  }, 120000);

  test("ownership-dependent read endpoints do not 500", async () => {
    const results = await runChain(
      [
        { name: "profile search", method: "get", path: `users/profile/search/${ctx.userId}`, allowed: [200, 404] },
        { name: "course details", method: "get", path: `users/courses/fetch-course-details/${ctx.courseId}`, allowed: [200, 404] },
        { name: "course assignments", method: "get", path: `users/courses/${ctx.courseId}/assignments`, allowed: [200, 404] },
        { name: "course lectures", method: "get", path: `users/courses/lectures/${ctx.lectureId}`, allowed: [200, 404] },
        { name: "all lectures by course", method: "get", path: `users/courses/${ctx.courseId}/fetch-all-lectures`, allowed: [200, 404] },
        { name: "ongoing lectures", method: "get", path: "users/lectures/ongoing", allowed: [200, 404] },
        { name: "transaction by id", method: "get", path: `user/transactions/fetch-transaction/${ctx.transactionId}`, allowed: [200, 404] },
      ],
      token,
    );
    assertChain(results);
  }, 120000);

  test("composite-index-gated endpoints resolve once index exists", async () => {
    const results = await runChain(
      [
        { name: "lecture exceptions (lecturer view)", method: "get", path: `users/exceptions/course/${ctx.courseId}`, allowed: [200, 403, 404] },
        { name: "exceptions for ongoing lecture", method: "get", path: `users/exceptions/lectures/${ctx.lectureId}`, allowed: [200, 403, 404] },
        { name: "lecture exceptions (role branch)", method: "get", path: `users/exceptions?courseId=${ctx.courseId}`, allowed: [200, 400, 403, 404] },
        { name: "student enrolled courses", method: "get", path: "users/student/class/courses/fetch-my-courses", allowed: [200, 403, 404] },
        { name: "lecturer enrolled courses", method: "get", path: "users/lecturers/class/courses/fetch-my-courses", allowed: [200, 403, 404] },
        { name: "all course assessments", method: "get", path: `users/lecturers/class/courses/${ctx.courseId}/assessments`, allowed: [200, 403, 404] },
      ],
      token,
    );
    assertChain(results);
  }, 120000);
});
