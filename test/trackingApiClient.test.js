const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TrackingApiClient } = require("../src/lib/tracking/trackingApiClient");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

test("sends records with basic auth and returns response id", async () => {
  const calls = [];
  const client = new TrackingApiClient({
    baseUrl: "https://tracking.example.test/records",
    username: "api-user",
    password: "api-password",
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { id: "abc-123" });
    },
    logger: { info() {} },
  });

  const response = await client.upsertRecord({ firmName: "Sample" });

  assert.equal(response.responseId, "abc-123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://tracking.example.test/records");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from("api-user:api-password").toString("base64")}`);
});

test("retries retryable API failures", async () => {
  let attempts = 0;
  const client = new TrackingApiClient({
    baseUrl: "https://tracking.example.test/records",
    username: "api-user",
    password: "api-password",
    fetchFn: async () => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse(500, { error: "temporary" })
        : jsonResponse(200, { recordId: "record-2" });
    },
    logger: { info() {} },
  });

  const response = await client.upsertRecord({ firmName: "Sample" });

  assert.equal(response.responseId, "record-2");
  assert.equal(attempts, 2);
});

test("masks secrets from thrown transport errors", async () => {
  const password = "very-sensitive-test-password";
  const basic = Buffer.from(`api-user:${password}`).toString("base64");
  const client = new TrackingApiClient({
    baseUrl: "https://tracking.example.test/records",
    username: "api-user",
    password,
    retries: 0,
    fetchFn: async () => {
      throw new Error(`transport failure ${password} ${basic}`);
    },
    logger: { info() {} },
  });

  await assert.rejects(
    () => client.upsertRecord({ firmName: "Sample" }),
    (error) => {
      assert.equal(error.message.includes(password), false);
      assert.equal(error.message.includes(basic), false);
      assert.equal(error.message.includes("[masked]"), true);
      return true;
    },
  );
});

