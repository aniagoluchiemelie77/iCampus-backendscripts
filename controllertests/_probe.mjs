/** Temporary probe to confirm exact status codes for corrected expectations. */
import dotenv from "dotenv";
dotenv.config();
import request from "supertest";
const BASE = process.env.BACKEND_URL;

async function hit(method, path, opts = {}) {
  let req = request(BASE)[method](path);
  if (opts.headers) for (const [k, v] of Object.entries(opts.headers)) req = req.set(k, v);
  if (opts.body) req = req.send(opts.body);
  try {
    const r = await req.timeout(60000);
    console.log(`${method.toUpperCase()} ${path} -> ${r.statusCode}`);
  } catch (e) {
    console.log(`${method.toUpperCase()} ${path} -> ERROR ${e.message}`);
  }
}

async function main() {
  // Login to get a token for the protected banks endpoint.
  const loginRes = await request(BASE)
    .post("users/login")
    .set("Accept", "application/json")
    .set("X-Test-Bypass", process.env.TEST_SECRET || "")
    .send({
      identifier: process.env.TEST_USER_EMAIL,
      password: process.env.TEST_USER_PASSWORD,
      deviceId: "9cb67e14404773b6",
      deviceName: "Infinix Infinix X689C",
    })
    .timeout(60000);
  const token = loginRes.body?.accessToken;
  console.log("login ->", loginRes.statusCode, token ? "token OK" : "NO token");

  await hit("get", "users/institutions?country=NG");
  await hit("post", "users/institutions/validate", { body: { schoolId: "FUPRE001" } });
  await hit("post", "users/verifyEmail", { body: { email: "alice@icampus.edu" } });
  await hit("post", "users/login", { body: { identifier: "nope@example.com", password: "wrongpass", deviceId: "testdevice", deviceName: "Test Device" } });
  await hit("post", "users/forgotPassword", { body: { email: "alice@icampus.edu" } });
  await hit("post", "users/refresh-token", { body: { refreshToken: "invalid.token.value" } });
  await hit("get", "v1/auth/mock-school/verify?matriculation_number=C0ET/8305/2021", { headers: { "x-icampus-api-key": "test_shared_secret_123" } });
  if (token) await hit("get", "users/payments/banks/NG", { headers: { Authorization: `Bearer ${token}` } });
  process.exit(0);
}
main();

