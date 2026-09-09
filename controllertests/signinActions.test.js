import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import { describe, beforeAll, test, expect } from "@jest/globals";
import request from "supertest";

const API_BASE_URL = process.env.BACKEND_URL;
let sharedContext = {
  email: process.env.TEST_USER_EMAIL_THIRD,
  testSchoolId: "FUPRE001",
  matriculation_number: "C0ET/8305/2021",
  staff_id: "FUPRE-012-2026",
  admin_test_email: process.env.ADMIN_TEST_EMAIL,
  admin_test_password: process.env.ADMIN_TEST_PASSWORD,
};
describe("Admin actions, admin switch from user", () => {
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
        identifier: process.env.ADMIN_AND_USER_EMAIL,
        password: process.env.ADMIN_AND_USER_PASSWORD,
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
      name: "Switch to admin from user",
      method: "post",
      path: () => `users/switch-to-admin`,
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
/*
describe("Signup and onboarding actions, register new user, verify email, and set up profile", () => {
  let tempUserEmail;

  beforeAll(() => {
    tempUserEmail = `test_signup_${Date.now()}@icampus.test`;
  }, 30000);

  const endpointsToTest = [
    {
      name: "Register user",
      method: "post",
      path: () => `users/register`,
      auth: false,
      expected: 200,
      body: {
        usertype: "enterprise",
        email: "support@fupre.edu.ng",
        organizationName: "Federal University of Petroleum Resources, Effurun",
        website: "https://www.fupre.edu.ng",
        schoolCode: "FUPRE001",
        password: "fupreadmuserPassword012??",
        providerId: "password",
        deviceId: "device_test_01",
        deviceName: "Jest Headless Client",
        country: "Nigeria",
      },
    },
    {
      name: "Switch to institution admin",
      method: "post",
      path: () => `users/switch-to-admin`, // Adjust path to match your actual route
      auth: true,
      expected: 200,
      body: {
        deviceId: "device_test_01",
        deviceName: "Jest Headless Client",
      },
    },
    {
      name: "Successfully verify student record via external school endpoint simulation",
      method: "post",
      path: () => `verifyStudent/verify`,
      auth: false,
      expected: 200,
      body: {
        school_id: sharedContext.testSchoolId,
        matriculation_number: sharedContext.matriculation_number,
      },
    },
    {
      name: "Successfully verify lecturer record via external school endpoint simulation",
      method: "post",
      path: () => `verifyInstructor/verify-lecturer`,
      auth: false,
      expected: 200,
      body: {
        school_id: sharedContext.testSchoolId,
        staff_id: sharedContext.staff_id,
      },
    },
    {
      name: "Validate institution",
      method: "post",
      path: () => `users/institutions/validate`,
      auth: false,
      idempotent: true,
      expected: 200,
      body: {
        schoolName: "Federal University of Petroleum Resources, Effurun",
      },
    },
    {
      name: "Request email verification code",
      method: "post",
      path: () => `users/verifyEmail`,
      auth: false,
      idempotent: true,
      expected: 200,
      body: {
        email: "bahdmannatural@gmail.com",
      },
    },
    {
      name: "Request forgot password verification code",
      method: "post",
      path: () => `users/forgotPassword`,
      auth: false,
      idempotent: true,
      expected: 200,
      body: {
        email: sharedContext.email,
      },
    },
  ];

  test("Run sequential signup dependency chain", async () => {
    for (const step of endpointsToTest) {
      const resolvedPath =
        typeof step.path === "function" ? step.path() : step.path;

      let req = request(API_BASE_URL)[step.method](resolvedPath);
      if (step.body) {
        req.send(step.body);
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
describe("Signup and onboarding actions, admin login and onboarding actions", () => {
  const endpointsToTest = [
    {
      name: "Admin login",
      method: "post",
      path: () => `users/admin-login`,
      auth: false,
      expected: 200,
      body: {
        identifier: sharedContext.admin_test_email,
        password: sharedContext.admin_test_password,
        deviceId: "admin_dev_01",
        deviceName: "Jest Admin Console",
      },
    },
  ];

  test("Run sequential signup dependency chain", async () => {
    for (const step of endpointsToTest) {
      const resolvedPath =
        typeof step.path === "function" ? step.path() : step.path;

      let req = request(API_BASE_URL)[step.method](resolvedPath);
      if (step.auth && signupToken) {
        req.set("Authorization", `Bearer ${signupToken}`);
      }

      if (step.body) {
        req.send(step.body);
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
*/