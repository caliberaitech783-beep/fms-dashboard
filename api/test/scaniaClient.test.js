const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { test } = require("node:test");
const {
  ACCEPT_HEADERS,
  ScaniaClient,
  computeScaniaChallengeResponse,
  continuationUrl,
  createScaniaClientFromEnv,
} = require("../src/lib/scania/scaniaClient");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientOptions(overrides = {}) {
  return {
    clientId: "client-id",
    clientSecret: Buffer.from("client-secret-bytes").toString("base64url"),
    authBaseUrl: "https://dataaccess.scania.test/auth",
    vehiclesUrl: "https://dataaccess.scania.test/rfms4/vehicles",
    positionsUrl: "https://dataaccess.scania.test/rfms4/vehiclepositions",
    statusesUrl: "https://dataaccess.scania.test/rfms4/vehiclestatuses",
    exceptionsUrl: "https://dataaccess.scania.test/exception/history",
    vehicleEvaluationUrl: "https://dataaccess.scania.test/vehicle-evaluation",
    retries: 0,
    ...overrides,
  };
}

test("converts Scania challenge and secret from base64url before HMAC-SHA256", () => {
  const challengeBytes = Buffer.from("challenge-bytes");
  const secretBytes = Buffer.from("secret-bytes");
  const expected = createHmac("sha256", secretBytes)
    .update(challengeBytes)
    .digest("base64url");

  assert.equal(
    computeScaniaChallengeResponse(
      challengeBytes.toString("base64url"),
      secretBytes.toString("base64url"),
    ),
    expected,
  );
});

test("caches a generated Scania access token until its expiry window", async () => {
  const calls = [];
  const challenge = Buffer.from("challenge-one").toString("base64url");
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/clientid2challenge")) {
      return jsonResponse({ challenge });
    }
    return jsonResponse({ token: "generated-token", expiresIn: 3600 });
  };
  const client = new ScaniaClient(clientOptions({ fetchFn, nowFn: () => 1_000 }));

  assert.equal(await client.accessToken(), "generated-token");
  assert.equal(await client.accessToken(), "generated-token");
  assert.equal(calls.length, 2);
  assert.match(calls[1].options.body, /Response=/);
  assert.doesNotMatch(calls[1].options.body, /client-secret-bytes/);
});

test("uses the required rFMS 4.0 media type and paginates vehicle rows", async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("page=2")) {
      return jsonResponse({
        vehicleResponse: {
          vehicles: [{ vin: "VIN-2" }],
          moreDataAvailable: false,
        },
      });
    }
    return jsonResponse({
      vehicleResponse: {
        vehicles: [{ vin: "VIN-1" }],
        moreDataAvailable: true,
        moreDataAvailableLink: "/rfms4/vehicles?page=2",
      },
    });
  };
  const client = new ScaniaClient(clientOptions({
    accessToken: "valid-token",
    initialTokenTtlMs: 3_600_000,
    fetchFn,
  }));

  const result = await client.getVehicles();

  assert.deepEqual(result.records.map((row) => row.vin), ["VIN-1", "VIN-2"]);
  assert.equal(calls[0].options.headers.Accept, ACCEPT_HEADERS.vehicles);
  assert.equal(calls[0].options.headers.Authorization, "Bearer valid-token");
  assert.equal(calls.length, 2);
});

test("renews the token once after a 401 and retries the Scania request", async () => {
  const apiTokens = [];
  let tokenNumber = 0;
  const challenge = Buffer.from("challenge").toString("base64url");
  const fetchFn = async (url, options) => {
    const value = String(url);
    if (value.endsWith("/clientid2challenge")) return jsonResponse({ challenge });
    if (value.endsWith("/response2token")) {
      tokenNumber += 1;
      return jsonResponse({ token: `token-${tokenNumber}`, expiresIn: 3600 });
    }
    apiTokens.push(options.headers.Authorization);
    return apiTokens.length === 1
      ? jsonResponse({ Message: "expired" }, 401)
      : jsonResponse({ vehicleResponse: { vehicles: [{ vin: "VIN-1" }] } });
  };
  const client = new ScaniaClient(clientOptions({ fetchFn, retries: 1 }));

  const result = await client.getVehicles();

  assert.equal(result.records.length, 1);
  assert.deepEqual(apiTokens, ["Bearer token-1", "Bearer token-2"]);
  assert.equal(tokenNumber, 2);
});

test("parses the supplied Scania Position API VehicleTracksList envelope", async () => {
  const fetchFn = async () => jsonResponse({
    MoreDataAvailable: false,
    VehicleTracksList: [{
      Vin: "VIN-TRACK",
      VehicleTrackingPositions: [{ TimePosition: "2026-07-31T05:00:00Z" }],
    }],
  });
  const client = new ScaniaClient(clientOptions({
    accessToken: "valid-token",
    initialTokenTtlMs: 3_600_000,
    lastReportedPositionUrl: "https://dataaccess.scania.test/position/latest",
    fetchFn,
  }));

  const result = await client.getLastReportedPositions();

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].Vin, "VIN-TRACK");
});

test("resolves Scania continuation paths from the API origin without duplicating rfms4", () => {
  assert.equal(
    continuationUrl(
      "rfms4/vehiclestatuses?latestOnly=false",
      "https://dataaccess.scania.com/rfms4/vehiclestatuses",
    ),
    "https://dataaccess.scania.com/rfms4/vehiclestatuses?latestOnly=false",
  );
  assert.equal(
    continuationUrl(
      "/rfms4/vehicles?page=2",
      "https://dataaccess.scania.com/rfms4/vehicles",
    ),
    "https://dataaccess.scania.com/rfms4/vehicles?page=2",
  );
});

test("supports deployed RFMS4 setting names without requiring report-only endpoints", async () => {
  const calls = [];
  const client = createScaniaClientFromEnv({
    env: {
      SCANIA_CLIENT_ID: "client-id",
      SCANIA_SECRET_KEY: Buffer.from("client-secret-bytes").toString("base64url"),
      SCANIA_ACCESS_TOKEN: "valid-token",
      SCANIA_ACCESS_TOKEN_TTL_SECONDS: "3600",
      SCANIA_DATAACCESS_BASE_URL: "https://dataaccess.scania.test",
      SCANIA_RFMS4_VEHICLES_URL: "https://dataaccess.scania.test/rfms4/vehicles",
      SCANIA_RFMS4_STATUSES_URL: "https://dataaccess.scania.test/rfms4/vehiclestatuses",
      SCANIA_ACCEPT_VEHICLES: "application/json; rfms=vehicles.v4.0",
    },
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({ vehicleResponse: { vehicles: [{ vin: "VIN-1" }] } });
    },
    retries: 0,
  });

  const result = await client.getVehicles();

  assert.equal(result.records.length, 1);
  assert.equal(calls[0].url, "https://dataaccess.scania.test/rfms4/vehicles");
  assert.equal(calls[0].options.headers.Authorization, "Bearer valid-token");
});
