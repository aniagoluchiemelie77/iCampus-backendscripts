import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import { describe, beforeAll, test, expect } from "@jest/globals";
import request from "supertest";

const API_BASE_URL = process.env.BACKEND_URL;
let sharedContext = {
  productId: 'PR-260908-1756-_001-DT',
  sellerId: 'USER_001',
  secondProductId: 'PR-260904-0001-_001-Q1',
  secondSellerId: 'USER_001',
  orderIdHome: 'ORD-E2634854',
};

/*
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
      name: "Cancel pending order and refund buyer",
      method: "post",
      path: () => `store/orders/cancel`,
      auth: true,
      idempotent: false,
      expected: 200,
      body: {
        orderId: sharedContext.orderIdHome,
        reason: "Changed my mind about the purchase"
      }
    },
    {
      name: "Make an order of products",
      method: "post",
      path: () => `store/initialize-checkout`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        items: [
          {
            productId: sharedContext.productId,
            sellerId: sharedContext.sellerId,
            quantity: 5,
            deliveryMethod: "home_delivery",
            price: 10,
            color: "Black",
            size: "Standard"
          },
        ],  
        totals: {
          subtotal: 50,
          delivery: 1.2,
          grandTotal: 51.2
        },
        shippingContact: {
      address: "123 Main Street, Lagos",
      phone: "+2348012345678"
    }
      }
    },
    {
      name: "Clear Cart",
      method: "delete",
      path: () => `store/cart/delete-all`,
      auth: true,
      idempotent: true,
      expected: 200,
    },
    {
      name: "Clear Favorites",
      method: "delete",
      path: () => `store/favorites/delete-all`,
      auth: true,
      idempotent: true,
      expected: 200,
    },
    {
      name: "Bulk add items to user cart",
      method: "post",
        path: () => `store/favorites-to-cart/bulk-add`,
      auth: true,
      idempotent: false,
      expected: 200,
      body: {
        items: [
          {
            productId: sharedContext.productId,
            sellerId: sharedContext.sellerId,
            quantity: 2,
            color: "Black",
            size: "Standard"
          },
          {
            productId: sharedContext.secondProductId || "prod_test_secondary",
            sellerId: sharedContext.secondSellerId || "seller_xyz_secondary",
            quantity: 1,
            color: "Blue",
            size: "Large"
          }
        ]
      }
    },
    {
      name: "Get pending orders for buyer",
      method: "get",
      path: () => `store/orders/pending`,
      auth: true,
      idempotent: true,
      expected: 200
    },
    {
      name: "Toggle Product impression",
      method: "patch",
      path: () =>
        `store/product/toggle-impressions`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        productId: sharedContext.productId
      }
    },
    {
      name: "Add product to cart",
      method: "patch",
      path: () => `store/cart/toggle`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        productId: sharedContext.productId,
        action: 'add',
        selectedSize: 'Standard',
        selectedColor: 'Black',
        quantity: 2,
      }
    },
    {
      name: "Add product as favorite",
      method: "patch",
      path: () => `store/favorites/toggle`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        productId: sharedContext.productId,
      }
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
describe("Seller actions, complete order, mark as dropped off, get payout history, request payout", () => {
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
      name: "Get drop-off stations",
      method: "get",
      path: () => `store/drop-off-stations/fetch?lat=6.5244&lng=3.3792`,
      auth: true,
      idempotent: true,
      expected: 200
    },
    {
      name: "Delete product by ID for authenticated seller",
      method: "delete",
      path: () => `store/products/delete/${sharedContext.secondProductId}`,
      auth: true,
      idempotent: false,
      expected: 200
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
describe("First User, fetch all products, posts and courses ", () => {
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
      name: "Fetch Posts",
      method: "get",
      path: () => `posts/fetchPosts`,
      idempotent: true,
      auth: true,
      expected: 200,
      query: {
        limit: 10,
      },
    },
    {
      name: "Fetch Store Listings",
      method: "get",
      path: () => `store/get-store-products`,
      idempotent: true,
      auth: true,
      expected: 200,
      query: {
        limit: 10,
        category: "popular",
      },
    },
    {
      name: "Fetch Student Courses",
      method: "get",
      path: () => `users/student/class/courses/fetch-my-courses`,
      idempotent: true,
      auth: true,
      expected: 200,
      query: {
        semester: "First",
        session: "2025/2026",
        page: 1,
        limit: 10,
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
      if (step.query) {
        req.query(step.query);
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
describe("First User, create product", () => {
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
      name: "Create Product",
      method: "post",
      path: () => `store/products/create`,
      auth: true,
      idempotent: true,
      expected: 200,
      body: {
        title: "Wireless Bluetooth Earbuds",
        description: "High-quality wireless earbuds with deep bass and long battery life.",
        type: "physical",
        price: 10,
        niche: "Electronics",
        mediaUrls: JSON.stringify([
          "https://res.cloudinary.com/dbdw3zftx/image/upload/v1788888801/ea2_dtupca.jpg",
          "https://res.cloudinary.com/dbdw3zftx/image/upload/v1788888801/ea3_ozzked.jpg",
          "https://res.cloudinary.com/dbdw3zftx/image/upload/v1788888801/ea1_x99dzr.jpg"
        ]),
        weightKg: 0.2,
        inStock: 10,
        colors: JSON.stringify(["Black", "White"]),
        sizes: JSON.stringify(["Standard"]),
        sellerGateways: JSON.stringify(["home_delivery"]),
        dropOffAddress: JSON.stringify([])
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
*/