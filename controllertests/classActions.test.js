import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import { describe, beforeAll, test, expect } from "@jest/globals";
import request from "supertest";

const API_BASE_URL = process.env.BACKEND_URL;
let sharedContext = {
  courseId: "CRSE-PROD0414-260828",
  pollPostId: "PST-260901-2232-X80P",
  commentId: "c4howqkg5",
};

describe("Lecturer", () => {
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
        identifier: process.env.TEST_USER_EMAIL_SECOND,
        password: process.env.TEST_USER_PASSWORD_SECOND,
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
      name: "Create Lecture Schedule",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/${sharedContext.courseId}/lectures/createSchedule`,
      auth: true,
      idempotent: true,
      body: {
        courseId: sharedContext.courseId,
        date: "2026-06-01",
        startTime: "09:00",
        endTime: "11:00",
        location: "Room 402",
        topicName: "Cementation and Well Completion Introduction",
        lectureType: "Physical",
        repeatWeeks: 2,
      },
      expected: 200,
    },
    {
      name: "Create Course Content (Add Topic)",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/addCourseContent/${sharedContext.courseId}`,
      auth: true,
      idempotent: true,
      body: {
        topic: "Cementation and Well Completion Introduction",
        lectureId: "lecture_sample_01",
      },
      expected: 200,
    },
    {
      name: "Edit Course Content (Update Topic)",
      method: "put",
      path: () =>
        `users/lecturers/class/courses/editCourseContent/${sharedContext.courseId}`,
      auth: true,
      idempotent: true,
      body: {
        index: 0,
        updatedTopic: "Advanced Data Structures & Algorithms",
        lectureId: "lecture_sample_01",
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