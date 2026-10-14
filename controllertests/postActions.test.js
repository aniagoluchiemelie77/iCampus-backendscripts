/**
 * postActions.test.js — integration tests for controllers/postActions.js
 * ---------------------------------------------------------------------------
 * Covers post read + safe interaction endpoints. `fetchPosts` short-circuits
 * (returns empty) per the current controller code, so we assert 200 + empty.
 * Destructive post mutations are avoided; toggles use `allowed` since they
 * depend on whether the test user already liked/bookmarked.
 * ---------------------------------------------------------------------------
 */
import { describe, beforeAll, test } from "@jest/globals";
import {
  accounts,
  login,
  runChain,
  assertChain,
} from "./controllerTestHelpers.js";

describe("postActions controller", () => {
  let token;
  const ctx = {
    postId: "PST-260901-2232-733D",
    pollPostId: "PST-260901-2232-X80P",
    commentId: "c4howqkg5",
  };

  beforeAll(async () => {
    token = await login(accounts.user1());
  }, 200000);

  test("post reads + search respond", async () => {
    const results = await runChain(
      [
        { name: "fetch posts feed", method: "get", path: "posts/fetchPosts", expected: 200 },
        { name: "search posts", method: "get", path: "posts/search?q=campus", allowed: [200, 400] },
        { name: "fetch single post", method: "get", path: `posts/${ctx.postId}`, allowed: [200, 404] },
      ],
      token,
    );
    assertChain(results);
  }, 120000);

  test("interaction toggles do not 500 (ownership-dependent)", async () => {
    const results = await runChain(
      [
        { name: "toggle like", method: "post", path: `posts/${ctx.postId}/like`, allowed: [200, 404] },
        { name: "toggle bookmark", method: "patch", path: `posts/${ctx.postId}/bookmark`, allowed: [200, 404] },
        { name: "increment impressions", method: "patch", path: `posts/${ctx.postId}/impression`, allowed: [200, 404] },
        { name: "toggle comment like", method: "post", path: `posts/${ctx.postId}/comments/${ctx.commentId}/like`, allowed: [200, 404] },
        { name: "poll vote", method: "patch", path: `posts/${ctx.pollPostId}/vote`, body: { optionId: 0 }, allowed: [200, 400, 404] },
      ],
      token,
    );
    assertChain(results);
  }, 120000);
});
