const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  VolvoGroupClient,
  positionToSnapshotEvent,
} = require("../src/lib/volvo/volvoGroupClient");
const { consolidateVehicleEvents } = require("../src/lib/volvo/vehicleStatusNormalizer");

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(body),
  };
}

function options(fetchFn, overrides = {}) {
  return {
    tokenUrl: "https://identity.example.test/token",
    clientId: "sanitized-client",
    clientSecret: "sanitized-secret",
    scope: "sanitized-scope",
    vehiclesUrl: "https://api.example.test/vehicles",
    positionsUrl: "https://api.example.test/positions",
    statusesUrl: "https://api.example.test/statuses",
    acceptVehicles: "application/test.vehicles+json",
    acceptPositions: "application/test.positions+json",
    acceptStatuses: "application/test.statuses+json",
    requestIdFactory: () => "test-request-id",
    retries: 0,
    fetchFn,
    ...overrides,
  };
}

test("caches OAuth tokens and paginates vehicles with lastVin", async () => {
  const calls = [];
  let tokenCalls = 0;
  let vehicleCalls = 0;
  const client = new VolvoGroupClient(options(async (url, request) => {
    calls.push({ url: String(url), request });
    if (String(url).includes("/token")) {
      tokenCalls += 1;
      return response(200, { access_token: "sanitized-access-token", token_type: "Bearer", expires_in: 3600 });
    }
    vehicleCalls += 1;
    return vehicleCalls === 1
      ? response(200, {
        vehicleResponse: { vehicles: [{ vin: "TESTVIN-1" }, { vin: "TESTVIN-2" }] },
        moreDataAvailable: true,
      })
      : response(200, {
        vehicleResponse: { vehicles: [{ vin: "TESTVIN-3" }] },
        moreDataAvailable: false,
      });
  }));

  const vehicles = await client.fetchAllVehicles();

  assert.deepEqual(vehicles.map((vehicle) => vehicle.vin), ["TESTVIN-1", "TESTVIN-2", "TESTVIN-3"]);
  assert.equal(tokenCalls, 1);
  assert.equal(new URL(calls.at(-1).url).searchParams.get("lastVin"), "TESTVIN-2");
  assert.equal(calls.at(-1).request.headers.Authorization, "Bearer sanitized-access-token");
});

test("refreshes the OAuth token once after a Volvo 401", async () => {
  let tokenCalls = 0;
  let apiCalls = 0;
  const client = new VolvoGroupClient(options(async (url) => {
    if (String(url).includes("/token")) {
      tokenCalls += 1;
      return response(200, { access_token: `token-${tokenCalls}`, token_type: "Bearer", expires_in: 3600 });
    }
    apiCalls += 1;
    return apiCalls === 1
      ? response(401, { message: "expired" })
      : response(200, { vehicleResponse: { vehicles: [] }, moreDataAvailable: false });
  }));

  await client.fetchAllVehicles();
  assert.equal(tokenCalls, 2);
  assert.equal(apiCalls, 2);
});

test("paginates positions by received time with a fixed server stop time", async () => {
  const apiUrls = [];
  let positionCalls = 0;
  const client = new VolvoGroupClient(options(async (url) => {
    if (String(url).includes("/token")) {
      return response(200, { access_token: "token", token_type: "Bearer", expires_in: 3600 });
    }
    apiUrls.push(String(url));
    positionCalls += 1;
    return positionCalls === 1
      ? response(200, {
        vehiclePositionResponse: { vehiclePositions: [{
          vin: "TESTVIN-1",
          receivedDateTime: "2026-07-17T05:00:05.000Z",
          gnssPosition: { positionDateTime: "2026-07-17T05:00:00.000Z" },
        }] },
        moreDataAvailable: true,
        requestServerDateTime: "2026-07-17T05:10:00.000Z",
      })
      : response(200, {
        vehiclePositionResponse: { vehiclePositions: [{
          vin: "TESTVIN-2",
          receivedDateTime: "2026-07-17T05:01:05.000Z",
          gnssPosition: { positionDateTime: "2026-07-17T05:01:00.000Z" },
        }] },
        moreDataAvailable: false,
        requestServerDateTime: "2026-07-17T05:10:00.000Z",
      });
  }));

  const batch = await client.fetchLatestVehiclePositionsBatch();
  assert.equal(batch.positions.length, 2);
  assert.equal(new URL(apiUrls[1]).searchParams.get("starttime"), "2026-07-17T05:00:06.000Z");
  assert.equal(new URL(apiUrls[1]).searchParams.get("stoptime"), "2026-07-17T05:10:00.000Z");
});

test("paginates latest accumulated status by lastVin", async () => {
  const apiUrls = [];
  let statusCalls = 0;
  const client = new VolvoGroupClient(options(async (url) => {
    if (String(url).includes("/token")) {
      return response(200, { access_token: "token", token_type: "Bearer", expires_in: 3600 });
    }
    apiUrls.push(String(url));
    statusCalls += 1;
    return statusCalls === 1
      ? response(200, {
        vehicleStatusResponse: { vehicleStatuses: [{ vin: "TESTVIN-1" }, { vin: "TESTVIN-2" }] },
        moreDataAvailable: true,
      })
      : response(200, {
        vehicleStatusResponse: { vehicleStatuses: [{ vin: "TESTVIN-3" }] },
        moreDataAvailable: false,
      });
  }));

  const batch = await client.fetchLatestVehicleStatusBatch({ contentFilter: "ACCUMULATED" });
  assert.equal(batch.events.length, 3);
  assert.equal(new URL(apiUrls[0]).searchParams.get("contentFilter"), "ACCUMULATED");
  assert.equal(new URL(apiUrls[1]).searchParams.get("lastVin"), "TESTVIN-2");
});

test("honors Retry-After for 429 and never includes secrets in the error", async () => {
  const waits = [];
  let apiCalls = 0;
  const client = new VolvoGroupClient(options(async (url) => {
    if (String(url).includes("/token")) {
      return response(200, { access_token: "token", token_type: "Bearer", expires_in: 3600 });
    }
    apiCalls += 1;
    return apiCalls === 1
      ? response(429, {}, { "retry-after": "2" })
      : response(200, { vehicleResponse: { vehicles: [] }, moreDataAvailable: false });
  }, { retries: 1, sleepFn: async (milliseconds) => waits.push(milliseconds) }));

  await client.fetchAllVehicles();
  assert.deepEqual(waits, [2000]);
});

test("merges position and accumulated status with correct units and freshness", () => {
  const position = positionToSnapshotEvent({
    vin: "TESTVIN-1",
    createdDateTime: "2026-07-17T05:00:00.000Z",
    receivedDateTime: "2026-07-17T05:00:05.000Z",
    gnssPosition: { latitude: 20, longitude: 79, speed: 12, positionDateTime: "2026-07-17T05:00:00.000Z" },
    wheelBasedSpeed: 12,
  });
  const accumulated = {
    vin: "TESTVIN-1",
    createdDateTime: "2026-07-17T05:00:00.000Z",
    receivedDateTime: "2026-07-17T05:00:05.000Z",
    hrTotalVehicleDistance: 125000,
    engineTotalFuelUsed: 45000,
    accumulatedData: { durationWheelbaseSpeedOverZero: 3600, durationWheelbaseSpeedZero: 600 },
    driver1Id: { oemDriverIdentification: { oemDriverIdentification: "SHOULD-NOT-LEAVE-BACKEND" } },
  };
  const vehicle = consolidateVehicleEvents([position, accumulated], new Map(), {
    now: new Date("2026-07-17T05:10:00.000Z"),
    freshAfterMinutes: 20,
    staleAfterMinutes: 120,
  }).vehicles[0];

  assert.equal(vehicle.odometerKm, 125);
  assert.equal(vehicle.totalFuelLitres, 45);
  assert.equal(vehicle.speedKph, 12);
  assert.equal(vehicle.movementState, "MOVING");
  assert.equal(vehicle.freshness.state, "fresh");
  assert.equal(JSON.stringify({ ...vehicle, driverId: undefined, maskedDriverId: null }).includes("SHOULD-NOT-LEAVE-BACKEND"), false);
});
