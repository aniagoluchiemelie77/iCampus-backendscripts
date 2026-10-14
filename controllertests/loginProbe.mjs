/**
 * loginProbe.mjs
 * Confirms the test login returns an accessToken and samples a few GET
 * endpoints so we know the supertest integration suite is viable.
 * Run: node controllertests/loginProbe.mjs
 */
import dotenv from "dotenv";
dotenv.config();
import request from "supertest";

const API_BASE_URL = process.env.BACKEND_URL;

async function login(identifier, password) {
  const res = await request(API_BASE_URL)
    .post("users/login")
    .set("Accept", "application/json")
    .set("X-Test-Bypass", process.env.TEST_SECRET || "")
    .send({
      identifier,
      password,
      deviceId: "9cb67e14404773b6",
      deviceName: "Infinix Infinix X689C",
    })
    .timeout(60000);
  return res;
}

async function main() {
  console.log("API_BASE_URL:", API_BASE_URL);

  const userRes = await login(
    process.env.TEST_USER_EMAIL,
    process.env.TEST_USER_PASSWORD,
  );
  console.log(
    `\n[USER LOGIN] status=${userRes.statusCode} token=${
      userRes.body?.accessToken ? "YES" : "NO"
    }`,
  );
  if (userRes.statusCode !== 200 || !userRes.body?.accessToken) {
    console.error("USER LOGIN BODY:", userRes.text);
  }
  const token = userRes.body?.accessToken;

  const adminRes = await login(
    process.env.ADMIN_AND_USER_EMAIL,
    process.env.ADMIN_AND_USER_PASSWORD,
  );
  console.log(
    `[ADMIN LOGIN] status=${adminRes.statusCode} token=${
      adminRes.body?.accessToken ? "YES" : "NO"
    }`,
  );
  if (adminRes.statusCode !== 200 || !adminRes.body?.accessToken) {
    console.error("ADMIN LOGIN BODY:", adminRes.text);
  }
  const adminToken = adminRes.body?.accessToken;

  // Sample some GET endpoints with the user token.
  const gets = [
    "users/fetch-connections",
    "users/blocked-list",
    "users/preferences",
    "users/ads/fetch-active",
    "users/get-notifications",
    "store/get-store-products",
    "users/fetch-all-users",
  ];
  if (token) {
    console.log("\n[GET SAMPLES]");
    for (const path of gets) {
      try {
        const r = await request(API_BASE_URL)
          .get(path)
          .set("Authorization", `Bearer ${token}`)
          .timeout(60000);
        console.log(`  GET ${path} -> ${r.statusCode}`);
      } catch (e) {
        console.log(`  GET ${path} -> ERROR ${e.message}`);
      }
    }
  }

  if (adminToken) {
    console.log("\n[ADMIN GET SAMPLES]");
    for (const path of [
      "admins/get-overview",
      "admins/get-institutions",
      "support/tickets/fetch-all",
    ]) {
      try {
        const r = await request(API_BASE_URL)
          .get(path)
          .set("Authorization", `Bearer ${adminToken}`)
          .timeout(60000);
        console.log(`  GET ${path} -> ${r.statusCode}`);
      } catch (e) {
        console.log(`  GET ${path} -> ERROR ${e.message}`);
      }
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Probe crashed:", e);
  process.exit(1);
});
