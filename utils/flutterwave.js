import crypto from "crypto";

const FLW_BASE_URL = "https://api.flutterwave.com/v3";

/** Thrown for payment problems the client should see (with an HTTP status). */
export class PaymentError extends Error {
  constructor(message, status = 400, code = "PAYMENT_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// FLUTTERWAVE_CLIENT_SECRET is the name used in .env; FLW_SECRET_KEY was used
// by the old checkout controller, so both are accepted.
export const flutterwaveSecret = () =>
  process.env.FLUTTERWAVE_CLIENT_SECRET || process.env.FLW_SECRET_KEY || "";

export const isFlutterwaveConfigured = () => !!flutterwaveSecret();

export async function flwRequest(path, { method = "GET", body } = {}) {
  const secret = flutterwaveSecret();
  if (!secret) {
    throw new PaymentError(
      "Payments are not available yet. Please try again later.",
      503,
      "PAYMENTS_NOT_CONFIGURED",
    );
  }
  const response = await fetch(`${FLW_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, data };
}

/**
 * Looks a transaction up on Flutterwave by its numeric id. Never trust what
 * the app says about a payment; this is the only source of truth.
 */
export async function verifyFlwTransaction(transactionId) {
  if (!/^\d+$/.test(String(transactionId || ""))) {
    throw new PaymentError("Invalid payment transaction id.", 400);
  }
  const { ok, data } = await flwRequest(
    `/transactions/${transactionId}/verify`,
  );
  if (!ok || data?.status !== "success" || !data?.data) {
    throw new PaymentError(
      data?.message || "Could not verify the payment with Flutterwave.",
      400,
    );
  }
  return data.data;
}

export async function refundFlwTransaction(transactionId, amount) {
  return flwRequest(`/transactions/${transactionId}/refund`, {
    method: "POST",
    body: amount ? { amount } : {},
  });
}

/** Constant-time comparison of the `verif-hash` header with FLW_WEBHOOK_HASH. */
export function isValidWebhookSignature(signature) {
  const secretHash = process.env.FLW_WEBHOOK_HASH;
  if (!secretHash || typeof signature !== "string") return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(secretHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Rounds up to 2 decimals so the customer is never charged below the price. */
export const roundUpMoney = (value) =>
  Math.ceil((Number(value) || 0) * 100 - 1e-6) / 100;

export const roundMoney = (value) =>
  Math.round((Number(value) || 0) * 100) / 100;
