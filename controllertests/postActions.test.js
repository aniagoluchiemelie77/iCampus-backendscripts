import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config();

import { describe, beforeAll, test, expect } from "@jest/globals";
import request from "supertest";

const API_BASE_URL = process.env.BACKEND_URL;

describe("Sequential Media post actions API controller status audit", () => {
  let accessToken;
  let sharedContext = {};

  beforeAll(async () => {
    const loginResponse = await request(API_BASE_URL).post("users/login").send({
      identifier: process.env.TEST_USER_EMAIL,
      password: process.env.TEST_USER_PASSWORD,
    });
    if (loginResponse.statusCode !== 200 || !loginResponse.body.accessToken) {
      throw new Error(
        `Authentication failed: ${JSON.stringify(loginResponse.body)}`,
      );
    }
    accessToken = loginResponse.body.accessToken;
  }, 60000);

  const endpointsToTest = [
    {
      name: "Create Post",
      method: "post",
      path: "posts/create",
      auth: true,
      idempotent: true,
      body: {
        content:
          "Checking out this incredible view during my holiday! Let me know what you think.",
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
    {
      name: "Delete Post",
      method: "delete",
      path: () => `posts/${sharedContext.postId}/delete`,
      auth: true,
      idempotent: true,
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
      if (endpoint.filePath) {
        req.attach("mediaFile", endpoint.filePath);
      }
      if (
        step.idempotent ||
        ["post", "put", "patch", "delete"].includes(step.method)
      ) {
        req.set("Idempotency-Key", crypto.randomUUID());
      }

      const response = await req.send();

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

      // Execute custom success hook to store IDs if present
      if (response.statusCode === step.expected && step.onSuccess) {
        step.onSuccess(response);
      }

      expect(response.statusCode).toBe(step.expected);
    }
  }, 120000);
});
