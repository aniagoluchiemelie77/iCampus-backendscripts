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
      name: "Create Lecture Schedule - Artificial Lift",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/${sharedContext.courseId}/lectures/createSchedule`,
      auth: true,
      idempotent: true,
      body: {
        courseId: sharedContext.courseId,
        date: "2026-10-23",
        startTime: "10:00",
        endTime: "12:00",
        location: "Petroleum Engineering Lab",
        topicName: "Artificial Lift Systems: Sucker Rod Pumping & Gas Lift",
        lectureType: "Physical",
        repeatWeeks: 2,
      },
      expected: 200,
    },
    {
      name: "Create Lecture Schedule - Multiphase Flow Online",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/${sharedContext.courseId}/lectures/createSchedule`,
      auth: true,
      idempotent: true,
      body: {
        courseId: sharedContext.courseId,
        date: "2026-10-15",
        startTime: "14:00",
        endTime: "16:00",
        location: "Virtual Classroom",
        topicName: "Multiphase Flow in Pipes and Pressure Drop Correlations",
        lectureType: "Online",
        streamUrl: "https://meet.petroleumschool.edu/multiphase-flow",
        repeatWeeks: 1,
      },
      expected: 200,
    },
    {
      name: "Create Lecture Schedule - Hydraulic Fracturing",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/${sharedContext.courseId}/lectures/createSchedule`,
      auth: true,
      idempotent: true,
      body: {
        courseId: sharedContext.courseId,
        date: "2026-10-12",
        startTime: "09:00",
        endTime: "11:30",
        location: "Petroleum Engineering Lab",
        topicName: "Hydraulic Fracturing Design and Proppant Selection",
        lectureType: "Physical",
        repeatWeeks: 2,
      },
      expected: 200,
    },
    {
      name: "Create Lecture Schedule - Sand Control",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/${sharedContext.courseId}/lectures/createSchedule`,
      auth: true,
      idempotent: true,
      body: {
        courseId: sharedContext.courseId,
        date: "2026-10-17",
        startTime: "13:00",
        endTime: "15:00",
        location: "Petroleum Engineering Lab",
        topicName: "Sand Control Management: Gravel Packing and Screen Design",
        lectureType: "Physical",
        repeatWeeks: 1,
      },
      expected: 200,
    },
    {
      name: "Create Lecture Schedule - Well Deliverability",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/${sharedContext.courseId}/lectures/createSchedule`,
      auth: true,
      idempotent: true,
      body: {
        courseId: sharedContext.courseId,
        date: "2026-10-22",
        startTime: "08:30",
        endTime: "10:30",
        location: "Petroleum Engineering Lab",
        topicName:
          "Well Deliverability and Inflow Performance Relationship (IPR)",
        lectureType: "Physical",
        repeatWeeks: 3,
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
        updatedTopic: "Artificial Lift Systems: Sucker Rod Pumping & Gas Lift",
        lectureId: "lecture_sample_01",
      },
      expected: 200,
    },
    {
      name: "Upload Course Material - Well Completion Manual",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/uploadMaterial/${sharedContext.courseId}`,
      auth: true,
      idempotent: true,
      body: {
        title: "Advanced Well Completion and Cementing Manual",
        materialUrl:
          "https://docs.google.com/document/d/1Qf156Fr2eZPI2Qt7unr7TmoRPjBchdZoIZAFf_0vgFg",
      },
      expected: 200,
    },
    {
      name: "Upload Course Material - Missing URL Validation Error",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/uploadMaterial/${sharedContext.courseId}`,
      auth: true,
      idempotent: true,
      body: {
        title: "Artificial Lift Systems Lecture Slides",
        materialUrl:
          "https://firebasestorage.googleapis.com/v0/b/petroleum-app.appspot.com/o/materials%2Fwell-completion-2026.pdf?alt=media&token=xyz",
      },
      expected: 400,
    },
    {
      name: "Delete Course Material - Well Completion Manual",
      method: "delete",
      path: () =>
        `users/lecturers/class/courses/deleteMaterial/${sharedContext.courseId}`,
      auth: true,
      idempotent: true,
      body: {
        materialUrl:
          "https://firebasestorage.googleapis.com/v0/b/petroleum-app.appspot.com/o/materials%2Fwell-completion-2026.pdf?alt=media&token=xyz",
      },
      expected: 200,
    },
    {
      name: "Create Course Assignment - Pressure Transient Analysis",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/${sharedContext.courseId}/assignments`,
      auth: true,
      idempotent: true,
      body: {
        title: "Well Test Analysis and Horner Plot Calculation",
        description:
          "Analyze the build-up pressure test data to determine reservoir permeability and skin factor using a semi-log Horner plot.",
        dueDate: "2026-10-25T23:59:59.000Z",
        submissionMethod: "Physical",
        lectureId: "lec-well-testing-01",
        submissionInfo:
          "Submit to your course rep at Petroleum Engineering Lab",
      },
      expected: 200,
    },
    {
      name: "Create Assessment - Well Performance & Artificial Lift Midterm",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/${sharedContext.courseId}/assessments`,
      auth: true,
      idempotent: true,
      body: {
        title: "Petroleum Production Engineering Midterm Assessment",
        assessmentType: "Test",
        duration: 90,
        totalMarks: 50,
        isPublished: true,
        status: "published",
        scheduledStart: "2026-11-15T09:00:00.000Z",
        dueDate: "2026-11-15T11:00:00.000Z",
        endTime: "2026-11-15T11:00:00.000Z",
        questions: [
          {
            id: "q1",
            type: "MCQ",
            questionText:
              "Which artificial lift method is most suitable for high-gas-liquid-ratio (GLR) wells with high productivity?",
            options: [
              "Sucker Rod Pumping (SRP)",
              "Continuous Gas Lift",
              "Progressive Cavity Pumping (PCP)",
              "Hydraulic Jet Pump",
            ],
            correctAnswer: "Continuous Gas Lift",
          },
          {
            id: "q2",
            type: "TrueFalse",
            questionText:
              "Skin factor resulting from formation damage increases well productivity index.",
            options: ["True", "False"],
            correctAnswer: "False",
          },
          {
            id: "q3",
            type: "ShortAnswer",
            questionText:
              "What plotting technique is commonly used in well test analysis to determine reservoir permeability and skin factor from pressure build-up data?",
            correctAnswer: "Horner plot",
          },
        ],
      },
      expected: 200,
    },
    /*
     {
      name: "Create Course Content (Add Topic)",
      method: "post",
      path: () =>
        `users/lecturers/class/courses/addCourseContent/${sharedContext.courseId}`,
      auth: true,
      idempotent: true,
      body: {
        topic: "Artificial Lift Systems: Sucker Rod Pumping & Gas Li",
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
        topic: "Multiphase Flow in Pipes and Pressure Drop Correlations",
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
        topic: "Hydraulic Fracturing Design and Proppant Selection",
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
        topic: "Sand Control Management: Gravel Packing and Screen Design",
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
        topic: "Well Deliverability and Inflow Performance Relationship (IPR)",
      },
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
describe("Student", () => {
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
      name: "Upload Course Details - Lecturer Course Allocation",
      method: "post",
      path: () => "users/course/extract-course-details-from-uploads",
      auth: true,
      idempotent: true,
      headers: {
        "Content-Type": "multipart/form-data",
      },
      files: [
        {
          fileUrl:
            "https://1drv.ms/b/c/41126d703d4436c4/IQDeNKdFijhEQ4XAqoWyL6YiAdfi_mVJaioJKZtiztyjfgc?e=BJSVTC",
        },
      ],
      body: {},
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