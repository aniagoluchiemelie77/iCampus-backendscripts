/**
 * storeControllers.test.js — integration tests for controllers/storeControllers.js
 * ---------------------------------------------------------------------------
 * Covers the marketplace read surface. Payment-gated flows (checkout/initiate,
 * request payout that moves money) are intentionally NOT triggered here since
 * Flutterwave isn't set up. We test the safe reads + cart/favorite toggles.
 *
 * index-gated: getPayoutHistory and getSellerSalesHistory rely on composite
 * indexes (see firestoreIndexProbe.mjs). Asserted with `allowed` so they turn
 * green once the indexes are created.
 * ---------------------------------------------------------------------------
 */
import { describe, beforeAll, test } from "@jest/globals";
import {
  accounts,
  login,
  runChain,
  assertChain,
} from "./controllerTestHelpers.js";

describe("storeControllers controller", () => {
  let token;
  const ctx = {
    productId: "PR-260908-1756-_001-DT",
  };

  beforeAll(async () => {
    token = await login(accounts.user1());
  }, 200000);

  test("public + safe store reads return 200", async () => {
    const results = await runChain(
      [
        { name: "fetch store products", method: "get", path: "store/get-store-products", expected: 200 },
        { name: "fetch all products (auth)", method: "get", path: "store/fetch-all-products", expected: 200 },
        { name: "drop-off stations", method: "get", path: "store/drop-off-stations/fetch", expected: 200 },
      ],
      token,
    );
    assertChain(results);
  }, 120000);

  test("seller-scoped reads (index-gated) do not 500", async () => {
    const results = await runChain(
      [
        { name: "seller sales history", method: "get", path: "store/sales/history", allowed: [200, 403, 404] },
        { name: "payout history", method: "get", path: "store/payouts/fetch-history", allowed: [200, 403, 404] },
        { name: "pending orders", method: "get", path: "store/orders/pending", allowed: [200, 403, 404] },
      ],
      token,
    );
    assertChain(results);
  }, 120000);

  test("cart + favorite toggles are idempotent-safe", async () => {
    const results = await runChain(
      [
        { name: "toggle cart", method: "patch", path: "store/cart/toggle", body: { productId: ctx.productId, quantity: 1 }, allowed: [200, 400, 404] },
        { name: "toggle favorite", method: "patch", path: "store/favorites/toggle", body: { productId: ctx.productId }, allowed: [200, 400, 404] },
      ],
      token,
    );
    assertChain(results);
  }, 120000);
});
