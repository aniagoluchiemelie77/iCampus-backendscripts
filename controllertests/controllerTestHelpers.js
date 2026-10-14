/**
 * controllerTestHelpers.js
 * ---------------------------------------------------------------------------
 * Shared, DRY helpers for the per-controller integration test suites.
 *
 * The existing tests each duplicated a ~50-line `beforeAll` that (a) wakes the
 * cold Render server, then (b) logs in. With ~14 suites that means up to 14
 * slow wake-ups + logins. This helper:
 *   - warms the backend ONCE per worker,
 *   - caches access tokens per test-account (so we still log in once per
 *     distinct account, but never re-login for the same account),
 *   - exposes a tiny request runner mirroring the existing
 *     `endpointsToTest` chain convention (auth header + Idempotency-Key).
 * ---------------------------------------------------------------------------
 */
import dotenv from "dotenv";
dotenv.config();
import crypto from "crypto";
import request from "supertest";
import { expect } from "@jest/globals";

export const API_BASE_URL =
  process.env.BACKEND_URL || "https://icampus-backendscript.onrender.com/";

// Long timeouts: the backend is a free-tier Render service that cold-starts.
export const WAKE_TIMEOUT = 180000;
export const LOGIN_TIMEOUT = 120000;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const tokenCache = new Map();
let wakePromise = null;

/**
 * Poke the backend root so a cold Render instance spins up. Safe to call many
 * times — it only ever fires one real request and shares the result.
 */
export function ensureAwake() {
  if (!wakePromise) {
    wakePromise = (async () => {
      try {
        await request(API_BASE_URL).get("").timeout(WAKE_TIMEOUT);
      } catch (e) {
        // Cold start / non-200 root is fine; login will still validate.
      }
      return true;
    })();
  }
  return wakePromise;
}

/**
 * Log in as a test account and return its accessToken. Tokens are cached per
 * account key so multiple suites share one login for the same credentials.
 *
 * @param {object} account  { identifier, password, key }
 */
export async function login(account) {
  const key =
    account.key || `${account.identifier}::${account.password}`;
  if (tokenCache.has(key)) return tokenCache.get(key);

  await ensureAwake();

  const res = await request(API_BASE_URL)
    .post("users/login")
    .set("User-Agent", CHROME_UA)
    .set("Accept", "application/json")
    .set("X-Test-Bypass", process.env.TEST_SECRET || "")
    .send({
      identifier: account.identifier,
      password: account.password,
      deviceId: account.deviceId || "9cb67e14404773b6",
      deviceName: account.deviceName || "Infinix Infinix X689C",
    })
    .timeout(LOGIN_TIMEOUT);

  if (res.statusCode !== 200 || !res.body?.accessToken) {
    throw new Error(
      `Login failed for ${key} -> status ${res.statusCode}: ${
        res.text || JSON.stringify(res.body)
      }`,
    );
  }
  tokenCache.set(key, res.body.accessToken);
  return res.body.accessToken;
}

// Pre-defined test accounts from .env
export const accounts = {
  user1: () => ({
    key: "user1",
    identifier: process.env.TEST_USER_EMAIL,
    password: process.env.TEST_USER_PASSWORD,
  }),
  user2: () => ({
    key: "user2",
    identifier: process.env.TEST_USER_EMAIL_SECOND,
    password: process.env.TEST_USER_PASSWORD_SECOND,
  }),
  adminUser: () => ({
    key: "adminUser",
    identifier: process.env.ADMIN_AND_USER_EMAIL,
    password: process.env.ADMIN_AND_USER_PASSWORD,
  }),
};

/**
 * Build a supertest request for a step descriptor, mirroring the existing
 * chain convention: apply auth + Idempotency-Key + body/file.
 *
 * @param {object} step   { method, path, auth?, body?, filePath?, idempotent?, query? }
 * @param {string} [token]
 * @returns {import('supertest').Test}
 */
export function buildRequest(step, token) {
  let req = request(API_BASE_URL)[step.method](step.path);

  if (token) req = req.set("Authorization", `Bearer ${token}`);
  if (step.headers) {
    for (const [k, v] of Object.entries(step.headers)) req = req.set(k, v);
  }
  if (step.body) req = req.send(step.body);
  if (step.filePath) req = req.attach("mediaFile", step.filePath);

  const shouldIdem =
    step.idempotent || ["post", "put", "patch", "delete"].includes(step.method);
  if (shouldIdem) req = req.set("Idempotency-Key", crypto.randomUUID());

  return req;
}

/**
 * Run a list of step descriptors sequentially (the "dependency chain" pattern
 * the existing tests use) and return [{ step, status, body, text, error }].
 * Does NOT assert — the caller decides expectations, which keeps index-dependent
 * or ownership-dependent endpoints flexible.
 */
export async function runChain(steps, token) {
  const results = [];
  for (const step of steps) {
    const path = typeof step.path === "function" ? step.path() : step.path;
    const req = buildRequest({ ...step, path }, token);
    let res;
    try {
      res = await req.timeout(step.timeout || 60000);
    } catch (e) {
      results.push({
        step: { ...step, path },
        status: 0,
        body: null,
        text: e.message,
        error: true,
      });
      continue;
    }
    results.push({
      step: { ...step, path },
      status: res.statusCode,
      body: res.body,
      text: res.text,
    });
  }
  return results;
}

/** Pretty one-line logger used by every suite. */
export function logResult({ step, status, text }) {
  const line = `${step.method.toUpperCase()} ${step.path} -> ${status}`;
  if (status === (step.expected ?? 200)) {
    console.log(`✅ ${line}`);
  } else {
    console.error(
      `❌ ${line} (expected ${step.expected ?? 200}) :: ${
        step.name || ""
      } :: ${
        typeof text === "string"
          ? text.slice(0, 300)
          : JSON.stringify(text)?.slice(0, 300)
      }`,
    );
  }
}

/**
 * Log every result, then assert each one matches its step.expected (default
 * 200). If a step sets `allowed: [200, 403, 404]`, the status must be one of
 * those — useful where the outcome depends on test-data ownership.
 */
export function assertChain(results) {
  // Log EVERY step first (full picture in one run), THEN assert, so an early
  // failure doesn't hide the diagnostics of the steps that follow.
  for (const r of results) logResult(r);

  const failures = results
    .filter((r) =>
      r.step.allowed
        ? !r.step.allowed.includes(r.status)
        : r.status !== (r.step.expected ?? 200),
    )
    .map(
      (r) =>
        `${r.step.method.toUpperCase()} ${r.step.name || r.step.path} -> ${
          r.status
        } (expected ${(r.step.allowed || [r.step.expected ?? 200]).join("|")})`,
    );

  expect(failures).toEqual([]);
}
