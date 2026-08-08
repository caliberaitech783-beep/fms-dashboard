const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CaseApiError,
  fetchCaseEquipment,
  normalizeBaseUrl,
  validateEquipmentPayload,
} = require("../src/lib/case/caseClient");

const testEnv = {
  CASE_BASE_URL: "https://api-data.cnh.com/v1",
  CASE_ACCESS_TOKEN: "test-access-token",
  CASE_SUBSCRIPTION_KEY: "test-subscription-key",
  CASE_REQUEST_TIMEOUT_MS: "100",
};

test("uses the exact Postman equipment path and backend-only authentication headers", async () => {
  let captured;
  const payload = { equipment: [{ vin: "TEST-VIN", devices: [] }] };
  const result = await fetchCaseEquipment({
    env: testEnv,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      };
    },
  });

  assert.deepEqual(result, payload);
  assert.equal(captured.url, "https://api-data.cnh.com/v1/equipment");
  assert.equal(captured.init.method, "GET");
  assert.equal(captured.init.headers.Accept, "application/json");
  assert.equal(captured.init.headers.Authorization, "Bearer test-access-token");
  assert.equal(captured.init.headers["Ocp-Apim-Subscription-Key"], "test-subscription-key");
});

test("classifies upstream authentication failures without including credentials", async () => {
  await assert.rejects(
    fetchCaseEquipment({
      env: testEnv,
      fetchImpl: async () => ({ ok: false, status: 401 }),
    }),
    (error) => {
      assert.ok(error instanceof CaseApiError);
      assert.equal(error.kind, "authentication");
      assert.equal(error.upstreamStatus, 401);
      assert.equal(error.message.includes(testEnv.CASE_ACCESS_TOKEN), false);
      assert.equal(error.message.includes(testEnv.CASE_SUBSCRIPTION_KEY), false);
      return true;
    },
  );
});

test("rejects invalid JSON and invalid equipment response shapes", async () => {
  await assert.rejects(
    fetchCaseEquipment({
      env: testEnv,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "not-json" }),
    }),
    (error) => error instanceof CaseApiError && error.kind === "invalid_json",
  );
  assert.throws(
    () => validateEquipmentPayload({ records: [] }),
    (error) => error instanceof CaseApiError && error.kind === "mapping",
  );
});

test("normalizes the duplicated protocol in the supplied dotenv base URL", () => {
  assert.equal(
    normalizeBaseUrl("https:https://api-data.cnh.com/v1"),
    "https://api-data.cnh.com/v1",
  );
});

test("does not duplicate the equipment path when CASE_BASE_URL is the complete endpoint", async () => {
  let requestedUrl;
  await fetchCaseEquipment({
    env: {
      ...testEnv,
      CASE_BASE_URL: "https:https://api-data.cnh.com/v1/equipment",
    },
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ equipment: [] }),
      };
    },
  });
  assert.equal(requestedUrl, "https://api-data.cnh.com/v1/equipment");
});

test("accepts the supplied Postman bearerToken and Subscription aliases", async () => {
  let requestHeaders;
  await fetchCaseEquipment({
    env: {
      CASE_BASE_URL: "https://api-data.cnh.com/v1/equipment",
      CASE_ACCESS_TOKEN: "stale-access-token",
      bearerToken: "current-postman-token",
      Subscription: "current-postman-subscription",
    },
    fetchImpl: async (_url, init) => {
      requestHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ equipment: [] }),
      };
    },
  });
  assert.equal(requestHeaders.Authorization, "Bearer current-postman-token");
  assert.equal(requestHeaders["Ocp-Apim-Subscription-Key"], "current-postman-subscription");
});
