import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import { describe, beforeAll, test, expect } from "@jest/globals";
import request from "supertest";

const API_BASE_URL = process.env.BACKEND_URL;
let sharedContext = {};

describe("Sequential Media post actions API controller status audit", () => {
  let accessToken;
  beforeAll(async () => {
    console.log("Waking up Render backend server...");
    try {
      await request(API_BASE_URL).get("").timeout(100000);
    } catch (e) {}

    const loginResponse = await request(API_BASE_URL)
      .post("users/login")
      .send({
        identifier: process.env.TEST_USER_EMAIL,
        password: process.env.TEST_USER_PASSWORD,
      })
      .timeout(150000);

    if (loginResponse.statusCode !== 200 || !loginResponse.body.accessToken) {
      throw new Error(
        `Authentication failed: ${JSON.stringify(loginResponse.body)}`,
      );
    }
    accessToken = loginResponse.body.accessToken;
  }, 150000);

  const endpointsToTest = [
    {
      name: "Create Post",
      method: "post",
      path: "posts/create",
      auth: true,
      idempotent: true,
      body: {
        content: "Summer holiday in Brazil, \n #summer.",
        postType: "media",
        isSubscriptionContent: false,
        media: {
          mediaType: "image",
          url: [
            "https://res.cloudinary.com/dbdw3zftx/image/upload/v1749821237/samples/landscapes/girl-urban-view.jpg",
            "https://res.cloudinary.com/dbdw3zftx/image/upload/v1749821238/samples/landscapes/beach-boat.jpg",
          ],
        },
      },
      expected: 200,
      onSuccess: (res) => {
        sharedContext.postId = res.body.data?.postId || res.body.postId;
      },
    },
    {
      name: "Fetch Post Details",
      method: "get",
      path: () => `posts/${sharedContext.postId}`,
      auth: true,
      idempotent: true,
      expected: 200,
    },
    {
      name: "Edit Post",
      method: "put",
      path: () => `posts/${sharedContext.postId}/update`,
      auth: true,
      idempotent: true,
      body: {
        content:
          "Checking out this details of my holiday in Australia, \n #Enoying the Holiday",
        postType: "media",
        isSubscriptionContent: false,
        media: {
          mediaType: "image",
          url: [
            "https://res.cloudinary.com/dbdw3zftx/image/upload/v1749821237/samples/landscapes/girl-urban-view.jpg",
          ],
        },
      },
      expected: 200,
    },
  ];

  test("Run sequential dependency chain", async () => {
    for (const step of endpointsToTest) {
      const resolvedPath =
        typeof step.path === "function" ? step.path() : step.path;

      let req = request(API_BASE_URL)[step.method](resolvedPath);

      if (step.auth) {
        req.set("Authorization", `Bearer ${accessToken}`);
      }

      if (step.body) {
        req.send(step.body);
      }

      if (step.filePath) {
        req.attach("mediaFile", step.filePath);
      }

      if (
        step.idempotent ||
        ["post", "put", "patch", "delete"].includes(step.method)
      ) {
        req.set("Idempotency-Key", crypto.randomUUID());
      }

      const response = await req;

      console.log(
        `${step.method.toUpperCase()} ${resolvedPath} ${response.statusCode}`,
      );

      if (response.statusCode !== step.expected) {
        const errorDetails =
          response.body?.message ||
          response.body?.error ||
          response.text ||
          "No error body provided";
        console.error(
          `❌ [MISMATCH] /${resolvedPath} expected ${step.expected}, got ${response.statusCode}. Backend message:`,
          errorDetails,
        );
      }

      if (response.statusCode === step.expected && step.onSuccess) {
        step.onSuccess(response);
      }

      expect(response.statusCode).toBe(step.expected);
    }
  }, 120000);
});

describe("Second User: create poll, (repost, comment, like, bookmark first user's post)", () => {
  let accessToken;

  beforeAll(async () => {
    console.log("Waking up Render backend server...");
    try {
      await request(API_BASE_URL).get("").timeout(100000);
    } catch (e) {}

    const loginResponse = await request(API_BASE_URL)
      .post("users/login")
      .send({
        identifier: process.env.TEST_USER_EMAIL_SECOND,
        password: process.env.TEST_USER_PASSWORD_SECOND,
      })
      .timeout(150000);

    if (loginResponse.statusCode !== 200 || !loginResponse.body.accessToken) {
      throw new Error(
        `Authentication failed: ${JSON.stringify(loginResponse.body)}`,
      );
    }
    accessToken = loginResponse.body.accessToken;
  }, 150000);

  const endpointsToTest = [
    {
      name: "Create Post",
      method: "post",
      path: "posts/create",
      auth: true,
      idempotent: true,
      body: {
        content:
          "Which programming language do you prefer for building backend microservices?",
        postType: "poll",
        isSubscriptionContent: false,
        poll: {
          options: [
            {
              optionId: "opt_node123",
              text: "Node.js (JavaScript/TypeScript)",
            },
            { optionId: "opt_py456", text: "Python (FastAPI/Django)" },
            { optionId: "opt_go789", text: "Go (Golang)" },
          ],
          expiresAt: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      },
      expected: 200,
      onSuccess: (res) => {
        sharedContext.pollPostId = res.body.data?.postId || res.body.postId;
      },
    },
    {
      name: "Like Post",
      method: "post",
      path: () => `posts/${sharedContext.postId}/like`,
      auth: true,
      idempotent: true,
      expected: 200,
    },
    {
      name: "Bookmark Post",
      method: "patch",
      path: () => `posts/${sharedContext.postId}/bookmark`,
      auth: true,
      idempotent: true,
      expected: 200,
    },
    {
      name: "Increment Impression",
      method: "patch",
      path: () => `posts/${sharedContext.postId}/impression`,
      auth: true,
      idempotent: true,
      expected: 200,
    },
    {
      name: "Comment on Post",
      method: "post",
      path: () => `posts/${sharedContext.postId}/comment`,
      auth: true,
      body: {
        comment: "See Enjoyment... Enjoy my dear",
      },
      idempotent: true,
      expected: 200,
      onSuccess: (res) => {
        sharedContext.commentId = res.body.id || res.body.commentId;
      },
    },
    {
      name: "Repost",
      method: "post",
      path: "posts/repost",
      auth: true,
      idempotent: true,
      body: {
        originalPostId: sharedContext.postId,
      },
      expected: 200,
    },
  ];

  test("Run sequential dependency chain", async () => {
    for (const step of endpointsToTest) {
      const resolvedPath =
        typeof step.path === "function" ? step.path() : step.path;

      let req = request(API_BASE_URL)[step.method](resolvedPath);

      if (step.auth) {
        req.set("Authorization", `Bearer ${accessToken}`);
      }

      if (step.body) {
        req.send(step.body);
      }

      if (step.filePath) {
        req.attach("mediaFile", step.filePath);
      }

      if (
        step.idempotent ||
        ["post", "put", "patch", "delete"].includes(step.method)
      ) {
        req.set("Idempotency-Key", crypto.randomUUID());
      }

      const response = await req;

      console.log(
        `${step.method.toUpperCase()} ${resolvedPath} ${response.statusCode}`,
      );

      if (response.statusCode !== step.expected) {
        const errorDetails =
          response.body?.message ||
          response.body?.error ||
          response.text ||
          "No error body provided";
        console.error(
          `❌ [MISMATCH] /${resolvedPath} expected ${step.expected}, got ${response.statusCode}. Backend message:`,
          errorDetails,
        );
      }

      if (response.statusCode === step.expected && step.onSuccess) {
        step.onSuccess(response);
      }

      expect(response.statusCode).toBe(step.expected);
    }
  }, 120000);
});

describe("Third User, vote in second user's poll, search for post using a line from content", () => {
  let accessToken;

  beforeAll(async () => {
    console.log("Waking up Render backend server...");
    try {
      await request(API_BASE_URL).get("").timeout(100000);
    } catch (e) {}

    const loginResponse = await request(API_BASE_URL)
      .post("users/login")
      .send({
        identifier: process.env.TEST_USER_EMAIL_THIRD,
        password: process.env.TEST_USER_PASSWORD_THIRD,
      })
      .timeout(150000);

    if (loginResponse.statusCode !== 200 || !loginResponse.body.accessToken) {
      throw new Error(
        `Authentication failed: ${JSON.stringify(loginResponse.body)}`,
      );
    }
    accessToken = loginResponse.body.accessToken;
  }, 150000);

  const endpointsToTest = [
    {
      name: "Search Posts",
      method: "get",
      path: () => `posts/search?q=holiday`,
      auth: true,
      idempotent: true,
      expected: 200,
      onSuccess: (res) => {
        const found = res.body.posts.some(
          (p) => p.postId === sharedContext.postId,
        );
        console.log(
          `Search result contains created post (${sharedContext.postId}):`,
          found,
        );
      },
    },
    {
      name: "Poll vote",
      method: "patch",
      path: () => `posts/${sharedContext.pollPostId}/vote`,
      auth: true,
      idempotent: true,
      body: {
        postId: sharedContext.pollPostId,
        optionId: "opt_node123",
      },
      expected: 200,
    },
  ];

  test("Run sequential dependency chain", async () => {
    for (const step of endpointsToTest) {
      const resolvedPath =
        typeof step.path === "function" ? step.path() : step.path;

      let req = request(API_BASE_URL)[step.method](resolvedPath);

      if (step.auth) {
        req.set("Authorization", `Bearer ${accessToken}`);
      }

      if (step.body) {
        req.send(step.body);
      }

      if (step.filePath) {
        req.attach("mediaFile", step.filePath);
      }

      if (
        step.idempotent ||
        ["post", "put", "patch", "delete"].includes(step.method)
      ) {
        req.set("Idempotency-Key", crypto.randomUUID());
      }

      const response = await req;

      console.log(
        `${step.method.toUpperCase()} ${resolvedPath} ${response.statusCode}`,
      );

      if (response.statusCode !== step.expected) {
        const errorDetails =
          response.body?.message ||
          response.body?.error ||
          response.text ||
          "No error body provided";
        console.error(
          `❌ [MISMATCH] /${resolvedPath} expected ${step.expected}, got ${response.statusCode}. Backend message:`,
          errorDetails,
        );
      }

      if (response.statusCode === step.expected && step.onSuccess) {
        step.onSuccess(response);
      }

      expect(response.statusCode).toBe(step.expected);
    }
  }, 120000);
});