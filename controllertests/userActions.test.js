import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import { describe, beforeAll, test, expect } from "@jest/globals";
import request from "supertest";

const API_BASE_URL = process.env.BACKEND_URL;
let sharedContext = {
  productId: 'PR-260908-1756-_001-DT',
  secondProductId: 'PR-260904-0001-_001-Q1',
  secondSellerId: 'USER_001',
  orderId: 'ORD-02A57A78',
};

describe("Buyer actions, log impression on product, toggle add to cart, toggle add as favorite, create an order for first user's product", () => {
  let accessToken;

  beforeAll(async () => {
    console.log("Waking up Render backend server...");
    try {
      await request(API_BASE_URL).get("").timeout(100000);
    } catch (e) {}

    const loginResponse = await request(API_BASE_URL)
      .post("users/login")
      .set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      )
      .set("Accept", "application/json")
      .set("X-Test-Bypass", process.env.TEST_SECRET || "")
      .send({
        identifier: process.env.NEW_USER_EMAIL,
        password: process.env.NEW_USER_PASSWORD,
        deviceId: "9cb67e14404773b6",
        deviceName: "Infinix Infinix X689C",
      })
      .timeout(150000);

    if (loginResponse.statusCode !== 200 || !loginResponse.body.accessToken) {
      console.error("Login Debug Status:", loginResponse.statusCode);
      console.error("Login Debug Body:", loginResponse.text);
      throw new Error(
        `Authentication failed: ${JSON.stringify(loginResponse.body)}`,
      );
    }
    accessToken = loginResponse.body.accessToken;
  }, 150000);

  const endpointsToTest = [
    {
      name: "Update password in-app",
      method: "put",
      path: () => `users/password/update`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        newPassword: "secureNewPassword123",
      },
    },
    {
      name: "Update primary or secondary email",
      method: "patch",
      path: () => `users/update-emails`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        email: "new.secondary@fupre.edu.ng",
        type: "secondary",
      },
    },
    {
      name: "Patch user preferences",
      method: "patch",
      path: () => `users/preferences`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        notifications: {
          classroom: false,
          profile: false,
        },
      },
    },
    {
      name: "Setup iCash PIN",
      method: "post",
      path: () => `user/setup-icash-pin`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        pin: "123456",
      },
    },
    {
      name: "Verify iCash PIN",
      method: "post",
      path: () => `user/verify-icash-pin`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        pin: "123456",
      },
    },
    {
      name: "Request iCash PIN reset OTP",
      method: "post",
      path: () => `user/request-pin-reset`,
      auth: true,
      idempotent: true,
      expected: 200,
    },
    {
      name: "Reset iCash PIN",
      method: "post",
      path: () => `user/reset-icash-pin`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        otp: "123456",
        newPin: "654321",
      },
    },
    {
      name: "Toggle following status of user",
      method: "post",
      path: () => `users/follow/toggle`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        followingId: "USER_001",
      },
    },
    {
      name: "Update user profile",
      method: "patch",
      path: () => `users/update-profile`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        username: "Mastakraft",
        headline: "Software developer | Founder | Tech Ethusiast.",
      },
    },
    {
      name: "Verify iTag username availability",
      method: "get",
      path: (val = "chinedu") => `users/check-itag/${val}`,
      auth: true,
      idempotent: false,
      expected: 200,
      body: null,
    },
    {
      name: "Check account state",
      method: "get",
      path: () => `users/check-account-state`,
      auth: true,
      idempotent: false,
      expected: 200,
      body: null,
    },
    {
      name: "Send AI chat message",
      method: "post",
      path: () => `users/ai/chat`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        message: "How do I reset my password?",
        context: {
          type: "support",
          data: {},
        },
        history: [],
      },
    },
    {
      name: "Delete user account",
      method: "delete",
      path: () => `users/account/delete`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        reason: "No longer utilizing the platform services.",
      },
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
