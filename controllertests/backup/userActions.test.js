import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import { describe, beforeAll, test, expect } from "@jest/globals";
import request from "supertest";

const API_BASE_URL =
  process.env.BACKEND_URL || "https://icampus-backendscript.onrender.com/";

let sharedContext = {
  productId: "PR-260908-1756-_001-DT",
  secondProductId: "PR-260904-0001-_001-Q1",
  secondSellerId: "USER_001",
  orderId: "ORD-02A57A78",
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
      name: "Delete recovery email",
      method: "delete",
      path: () => `users/recovery-email`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        emailToDelete: "new.secondary@fupre.edu.ng",
      },
    },
    {
      name: "Revoke logged-in device session",
      method: "post",
      path: () => `users/revoke-session`,
      auth: true,
      idempotent: false,
      expected: 200,
      body: {
        deviceIdToRevoke: "9cb67e14404773b6",
      },
    },
    {
      name: "Delete user phone number",
      method: "delete",
      path: () => `users/phone-number`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        phoneNumber: "+1234567890",
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
    /*
    {
      name: "Register drop-off station",
      method: "post",
      path: () => `users/stations/register`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        name: "Green Earth Drop-Off",
        address: "45 Eco Lane, Cityville",
        latitude: 6.5244,
        longitude: 3.3792,
        images: ["https://example.com/image1.jpg"],
      },
    },
    {
      name: "Customize iTag details",
      method: "put",
      path: () => `users/update-itag`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        updates: {
          username: "chinedu_kiv",
          designOptions: {
            backgroundColor: "#eee",
          },
        },
      },
    },
    {
      name: "Search user using UID or query term",
      method: "get",
      path: () => `users/search?q=Alice&viewerRole=user&viewerTier=pro`,
      auth: true,
      expected: 200,
      body: null,
    },
    {
      name: "Handle unified course search lookup",
      method: "get",
      path: () => `users/courses/search?q=petr`,
      auth: true,
      expected: 200,
      body: null,
    },
    {
      name: "Handle unified resource search lookup",
      method: "get",
      path: () => `users/courses/resources/search?q=petro`,
      auth: true,
      expected: 200,
      body: null,
    },
    {
      name: "Refresh user details and generate new tokens",
      method: "get",
      path: () => `users/refresh-user-details`,
      auth: true,
      expected: 200,
      body: {},
    },
    {
      name: "Verify password in-app",
      method: "post",
      path: () => `users/password/verify`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        password: "secureNewPassword123",
      },
    },
    {
      name: "Mark single notification as read",
      method: "patch",
      path: () =>
        `users/notifications/${encodeURIComponent("auth-2609092134-5658")}/read`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {},
    },
    {
      name: "Mark all notifications as read",
      method: "patch",
      path: () => `users/notifications/mark-all-read`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {},
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
      name: "Send phone number OTP via WhatsApp/SMS",
      method: "post",
      path: () => `users/send-phone-otp`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        phoneNumber: "+2349122312493",
        channel: "whatsapp",
      },
    },
    {
      name: "Toggle block/unblock user",
      method: "post",
      path: () => `users/block/toggle`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        targetUserId: "USER_002",
      },
    },
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
    */
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
