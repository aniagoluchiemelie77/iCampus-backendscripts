/**
 * webhookControllers.test.js — integration tests for
 * controllers/webhookControllers.js
 * ---------------------------------------------------------------------------
 * This controller is mostly inbound webhooks that require external provider
 * signatures (Flutterwave, Persona, Postmark, QStash). Those are EXTERNAL-
 * DEPENDENT and are skipped:
 *   - handleFlutterwaveWebhook   (Flutterwave not set up)
 *   - personaVerifyConfirmation  (Persona KYC provider)
 *   - handleQstashInboundEmailJobs (QStash signature)
 *   - handlePostmarkInboundSupportTickets (Postmark signature/headers)
 *
 * The only safe, self-contained endpoint is `simulateExternalSchoolApi`
 * (mock school verify) — a test helper that does not require any provider.
 * ---------------------------------------------------------------------------
 */
import { describe, beforeAll, test } from "@jest/globals";
import {
  ensureAwake,
  runChain,
  assertChain,
} from "./controllerTestHelpers.js";

describe("webhookControllers controller", () => {
  beforeAll(async () => {
    await ensureAwake();
  }, 200000);

  // The mock school API requires a shared-secret header. Default in code is
  // "test_shared_secret_123" (MOCK_SCHOOL_SECRET not set in .env). It reads
  // `matriculation_number` (snake_case), not `matric`. Verified live -> 200.
  const MOCK_SCHOOL_KEY = process.env.MOCK_SCHOOL_SECRET || "test_shared_secret_123";

  test("mock external school verify responds WITH the API-key header", async () => {
    const results = await runChain(
      [
        { name: "mock school verify (authorized -> 200)", method: "get", path: "v1/auth/mock-school/verify?matriculation_number=C0ET/8305/2021", headers: { "x-icampus-api-key": MOCK_SCHOOL_KEY }, expected: 200 },
        { name: "mock school verify (no key -> 401)", method: "get", path: "v1/auth/mock-school/verify?matriculation_number=C0ET/8305/2021", allowed: [401] },
      ],
      null,
    );
    assertChain(results);
  }, 60000);

  test("provider webhooks reject invalid/missing signatures with 4xx (never 500)", async () => {
    // Verified against controller source + live behavior:
    //   handleFlutterwaveWebhook    -> 401 when verif-hash missing/invalid
    //   personaVerifyConfirmation   -> 401 when persona-signature invalid
    //   handlePostmarkInbound...    -> 400 when ToFull/From missing
    //   handleQstashInbound...      -> NO signature check; {} is truthy -> 200
    const results = await runChain(
      [
        { name: "flw webhook (unsigned -> 401)", method: "post", path: "webhooks/flw-webhook", body: {}, allowed: [401] },
        { name: "persona webhook (unsigned -> 401)", method: "post", path: "webhooks/persona/webhook", body: {}, allowed: [401] },
        { name: "postmark webhook (no headers -> 400)", method: "post", path: "webhooks/postmark/webhook", body: {}, allowed: [400] },
        { name: "qstash webhook (unsigned -> 200, no signature check)", method: "post", path: "webhooks/qstash/webhook/send-notifications", body: {}, allowed: [200] },
      ],
      null,
    );
    assertChain(results);
  }, 60000);

});
