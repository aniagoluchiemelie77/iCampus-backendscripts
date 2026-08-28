import dotenv from 'dotenv';
dotenv.config();

import request from 'supertest';

const API_BASE_URL = process.env.BACKEND_URL;

if (!API_BASE_URL) {
  throw new Error("BACKEND_URL is not defined in your environment variables (.env)");
}

describe('Live Render API Integration Tests', () => {
  let accessToken;

  beforeAll(async () => {
    const loginResponse = await request(API_BASE_URL)
      .post('users/login')
      .send({
        identifier: process.env.TEST_USER_EMAIL,
        password: process.env.TEST_USER_PASSWORD,
      });

    if (loginResponse.statusCode !== 200 || !loginResponse.body.accessToken) {
      throw new Error(`Failed to authenticate test user: ${JSON.stringify(loginResponse.body)}`);
    }

    accessToken = loginResponse.body.accessToken;
  }, 60000);

  test('POST user/request-pin-reset with idempotency key', async () => {
    const uniqueKey = `test-key-${Date.now()}`;

    const firstResponse = await request(API_BASE_URL)
      .post('user/request-pin-reset')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('idempotency-key', uniqueKey)
      .send();

    expect(firstResponse.statusCode).toBe(200);
  }, 60000);
});