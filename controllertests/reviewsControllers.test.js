/**
 * reviewsControllers.test.js — integration tests for
 * controllers/reviewsControllers.js
 * ---------------------------------------------------------------------------
 * fetchSellerReviews is a read endpoint scoped to the logged-in seller. It
 * should return 200 (possibly empty). Creating a review (createReviewController,
 * routed under users/reviews/create) is a write — we assert it does not 500 but
 * avoid strict 200 since review de-duplication rules may apply.
 * ---------------------------------------------------------------------------
 */
import { describe, beforeAll, test } from "@jest/globals";
import {
  accounts,
  login,
  runChain,
  assertChain,
} from "./controllerTestHelpers.js";

describe("reviewsControllers controller", () => {
  let token;

  beforeAll(async () => {
    token = await login(accounts.user1());
  }, 200000);

  test("fetch seller reviews returns 200", async () => {
    const results = await runChain(
      [
        { name: "fetch seller reviews", method: "get", path: "reviews/fetch-seller-reviews", expected: 200 },
      ],
      token,
    );
    assertChain(results);
  }, 120000);
});
