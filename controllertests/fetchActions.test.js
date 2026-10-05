import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import { describe, beforeAll, test, expect } from "@jest/globals";
import request from "supertest";

const API_BASE_URL = process.env.BACKEND_URL;
let sharedContext = {
  notificationId: "security-2609100119-8569",
  targetUserId: "USER_003",
  courseId: "CRSE-RESE0320-261003",
  lectureId: "LECT-RESE0320-261003-1",
  transactionId: "TX-PAYM-260908-1848-2TW",
};

describe("First User, delete his/her post and like third user's comment", () => {
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
        identifier: process.env.TEST_USER_EMAIL,
        password: process.env.TEST_USER_PASSWORD,
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
      name: "Fetch All Exceptions For Ongoing Lecture",
      method: "get",
      path: () => `users/exceptions/lectures/${sharedContext.lectureId}`,
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Course Details",
      method: "get",
      path: () =>
        `users/courses/fetch-course-details/${sharedContext.courseId}`,
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Student Lectures Timeline",
      method: "get",
      path: "users/student/class/lectures/timeline",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch All Course Assessments",
      method: "get",
      path: () =>
        `users/lecturers/class/courses/${sharedContext.courseId}/assessments`,
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch All Lectures By Course ID",
      method: "get",
      path: () => `users/courses/${sharedContext.courseId}/fetch-all-lectures`,
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Lecturer Lectures Timeline",
      method: "get",
      path: "users/lecturers/class/lectures/timeline",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Get Transaction By ID",
      method: "get",
      path: () =>
        `user/transactions/fetch-transaction/${sharedContext.transactionId}`,
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Lecturer Enrolled Courses",
      method: "get",
      path: "users/lecturers/class/courses/fetch-my-courses",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Get User Preferences",
      method: "get",
      path: "users/preferences",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Students Enrolled Courses - Default Params",
      method: "get",
      path: "users/student/class/courses/fetch-my-courses",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Students Enrolled Courses - With Filters",
      method: "get",
      path: "users/student/class/courses/fetch-my-courses?semester=First&session=2025/2026",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Students Enrolled Courses - 'All' Filters",
      method: "get",
      path: "users/student/class/courses/fetch-my-courses?semester=All&session=All",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Students Enrolled Courses - Paginated",
      method: "get",
      path: "users/student/class/courses/fetch-my-courses?page=2&limit=10",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Get Ads",
      method: "get",
      path: "users/ads/fetch-active",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Single Notification",
      method: "get",
      path: () => `users/notifications/${sharedContext.notificationId}`,
      auth: true,
      idempotent: false,
      expected: 200,
    },
    /*
    {
      name: "Fetch User Connections",
      method: "get",
      path: "users/fetch-connections",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch User Notifications",
      method: "get",
      path: "users/get-notifications",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Profile Information",
      method: "get",
      path: () => `users/profile/search/${sharedContext.targetUserId}`,
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Blocked Users",
      method: "get",
      path: "users/blocked-list",
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Lecture Exceptions",
      method: "get",
      path: () => `users/exceptions?courseId=${sharedContext.courseId}`,
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Course Assignments",
      method: "get",
      path: () => `users/courses/${sharedContext.courseId}/assignments`,
      auth: true,
      idempotent: false,
      expected: 200,
    },
    {
      name: "Fetch Ongoing Lectures",
      method: "get",
      path: "users/lectures/ongoing",
      auth: true,
      idempotent: true,
      expected: 200,
    },
    {
      name: "Fetch Course Details For Ongoing Lecture",
      method: "get",
      path: () => `users/course/ongoing-lecture/${sharedContext.courseId}`,
      auth: true,
      idempotent: false,
      expected: 200,
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