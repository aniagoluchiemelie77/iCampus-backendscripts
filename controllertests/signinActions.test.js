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
        usertype: "student",
        email: "chineduOkafor23@gmail.com",
        firstname: "Chinedu",
        lastname: "Okafor",
        department: "Computer Science",
        matriculation_number: "COS/1002/2026",
        schoolCode: "FUPRE001",
        schoolName: "Federal University of Petroleum Resources, Effurun",
        current_level: "100",
        password: "SecurePassword123!",
        providerId: "password",
        deviceId: "device_test_01",
        deviceName: "Jest Headless Client",
      },
    },
    /*
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
    },
    */
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
