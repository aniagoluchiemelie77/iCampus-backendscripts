import dotenv from "dotenv";
dotenv.config();

import request from "supertest";

const API_BASE_URL = process.env.BACKEND_URL;

describe("Bulk API Controller Health & Status Audit", () => {
  let accessToken;

  // 1. Authenticate once before running the matrix
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

  // 2. Define your endpoints matrix (Route, Method, Expected Status, Requires Auth)
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
    // Add up to 200+ controllers here easily...
  ];

  // 3. Dynamically loop through them and log a clean results matrix
  test.each(endpointsToTest)(
    "[$method.toUpperCase()] /$path -> expects $expected",
    async ({ method, path, auth, expected }) => {
      let req = request(API_BASE_URL)[method](path);

      if (auth) {
        req.set("Authorization", `Bearer ${accessToken}`);
      }

      const response = await req.send();

      // If it's a 500 error, print the exact error payload so you can debug fast
      if (response.statusCode === 500) {
        console.error(`❌ [FAILURE] /${path} threw 500:`, response.body);
      }

      // Assert it matches what you expect (or adjust to check for non-500s)
      expect(response.statusCode).toBe(expected);
    },
    60000,
  );
});
