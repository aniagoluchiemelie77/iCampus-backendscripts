import dotenv from "dotenv";
dotenv.config();

import request from "supertest";
import { describe, beforeAll, test, expect } from "@jest/globals";

const API_BASE_URL = process.env.BACKEND_URL;

describe("Bulk API Controller Health & Status Audit", () => {
  let accessToken;
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
      name: "Request PIN Reset",
      method: "post",
      path: "user/request-pin-reset",
      auth: true,
      expected: 200,
    },
    {
      name: "Get User Profile",
      method: "get",
      path: "users/profile",
      auth: true,
      expected: 200,
    },
    {
      name: "Update Preferences",
      method: "put",
      path: "users/preferences",
      auth: true,
      expected: 200,
    },
    {
      name: "Fetch Notifications",
      method: "get",
      path: "notifications",
      auth: true,
      expected: 200,
    },
  ];
  test.each(endpointsToTest)(
    "%s %s %i",
    async ({ method, path, auth, expected: expectedStatus }) => {
      let req = request(API_BASE_URL)[method](path);

      if (auth) {
        req.set("Authorization", `Bearer ${accessToken}`);
      }

      const response = await req.send();
      console.log(`${method.toUpperCase()} ${path} ${response.statusCode}`);
      if (response.statusCode !== expectedStatus) {
        const errorDetails =
          response.body?.message ||
          response.body?.error ||
          response.text ||
          "No error body provided";
        console.error(
          `❌ [MISMATCH] /${path} expected ${expectedStatus}, got ${response.statusCode}. Backend message:`,
          errorDetails,
        );
      }

      expect(response.statusCode).toBe(expectedStatus);
    },
    60000,
  );
});
