const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { VolvoRfmsClient } = require("../src/lib/volvo/volvoRfmsClient");
const { buildDriverStandstillRows } = require("../src/lib/volvo/driverStandstillReport");
const {
  consolidateVehicleEvents,
  driverIdFromEvent,
  parseVehicleStatusResponse,
  stableEventKey,
} = require("../src/lib/volvo/vehicleStatusNormalizer");

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "src", "fixtures", "volvo-vehicle-status-sample.json"),
  "utf8",
));

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(body),
  };
}

function event(overrides = {}) {
  return {
    vin: "VIN-1",
    triggerType: { triggerType: "TIMER", context: "RFMS" },
    createdDateTime: "2026-07-15T05:00:00Z",
    receivedDateTime: "2026-07-15T05:00:01Z",
    ...overrides,
  };
}

test("parses the uploaded lower-camel Volvo fixture and consolidates duplicate VIN events", () => {
  const parsed = parseVehicleStatusResponse(fixture);
  const consolidated = consolidateVehicleEvents(parsed.events, new Map(), {
    now: new Date("2026-07-15T05:33:45Z"),
  });

  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.moreDataAvailable, false);
  assert.equal(parsed.requestServerDateTime, "2026-07-17T05:01:00.000Z");
  assert.equal(consolidated.vehicles.length, 1);
  assert.equal(new Set(consolidated.vehicles.map((vehicle) => vehicle.vin)).size, 1);
});

test("keeps the last snapshot, accumulated data, location and driver when a newer event omits them", () => {
  const first = event({
    hrTotalVehicleDistance: 250000,
    totalEngineHours: 42,
    engineTotalFuelUsed: 125000,
    snapshotData: {
      wheelBasedSpeed: 12,
      fuelLevel1: 45,
      gnssPosition: { latitude: 20.1, longitude: 79.1, positionDateTime: "2026-07-15T05:00:00Z" },
    },
    accumulatedData: {
      durationWheelbaseSpeedOverZero: 3600,
      durationWheelbaseSpeedZero: 120,
      fuelWheelbaseSpeedOverZero: 100000,
      fuelWheelbaseSpeedZero: 2500,
    },
    driver1Id: { oemDriverIdentification: { oemDriverIdentification: "DRIVER-1234" } },
  });
  const second = event({
    triggerType: { triggerType: "TIMER", context: "RFMS" },
    createdDateTime: "2026-07-15T05:10:00Z",
    receivedDateTime: "2026-07-15T05:10:01Z",
    hrTotalVehicleDistance: 100000,
  });
  const vehicle = consolidateVehicleEvents([first, second], new Map(), {
    now: new Date("2026-07-15T05:11:00Z"),
  }).vehicles[0];

  assert.equal(vehicle.eventTime, "2026-07-15T05:10:00Z");
  assert.equal(vehicle.speedKph, 12);
  assert.equal(vehicle.fuelPercent, 45);
  assert.equal(vehicle.latitude, 20.1);
  assert.equal(vehicle.engineHours, 42);
  assert.equal(vehicle.totalFuelLitres, 125);
  assert.equal(vehicle.lifetimeStandstillSeconds, 120);
  assert.equal(vehicle.lifetimeRunningSeconds, 3600);
  assert.equal(vehicle.lifetimeRunningFuelLitres, 100);
  assert.equal(vehicle.maskedDriverId, "****1234");
});

test("extracts OEM and tachograph driver identities and ignores empty identities", () => {
  assert.equal(driverIdFromEvent(event({
    driver1Id: { oemDriverIdentification: { oemDriverIdentification: "OEM-99" } },
  })), "OEM-99");
  assert.equal(driverIdFromEvent(event({
    driver1Id: { tachoDriverIdentification: { driverIdentification: "TACHO-88" } },
  })), "TACHO-88");
  assert.equal(driverIdFromEvent(event({
    driver1Id: { tachoDriverIdentification: { driverIdentification: "" } },
  })), null);
});

test("tracks movement, low-speed standstill and a later ignition-off transition", () => {
  const moving = event({
    triggerType: { triggerType: "IGNITION_ON" },
    snapshotData: { wheelBasedSpeed: 14 },
  });
  const stopped = event({
    createdDateTime: "2026-07-15T05:05:00Z",
    receivedDateTime: "2026-07-15T05:05:01Z",
    snapshotData: { wheelBasedSpeed: 2.9 },
  });
  const initial = consolidateVehicleEvents([moving, stopped], new Map(), {
    now: new Date("2026-07-15T05:06:00Z"),
    standstillSpeedKph: 3,
  });
  assert.equal(initial.vehicles[0].movementState, "STANDSTILL");
  assert.equal(initial.vehicles[0].currentStandstillStartedAt, "2026-07-15T05:05:00Z");
  assert.equal(initial.vehicles[0].currentStandstillSeconds, 60);

  const ignitionOff = event({
    triggerType: { triggerType: "IGNITION_OFF" },
    createdDateTime: "2026-07-15T05:07:00Z",
    receivedDateTime: "2026-07-15T05:07:01Z",
  });
  const final = consolidateVehicleEvents([ignitionOff], initial.states, {
    now: new Date("2026-07-15T05:08:00Z"),
    standstillSpeedKph: 3,
  });
  assert.equal(final.vehicles[0].movementState, "PARKED");
  assert.equal(final.vehicles[0].currentStandstillStartedAt, null);
});

test("derives running and idle states from accumulated counters when speed snapshots are unavailable", () => {
  const initial = consolidateVehicleEvents([event({
    triggerType: { triggerType: "IGNITION_ON" },
    accumulatedData: {
      durationWheelbaseSpeedOverZero: 1000,
      durationWheelbaseSpeedZero: 500,
    },
  })], new Map(), {
    now: new Date("2026-07-15T05:01:00Z"),
  });

  const running = consolidateVehicleEvents([event({
    createdDateTime: "2026-07-15T05:10:00Z",
    receivedDateTime: "2026-07-15T05:10:01Z",
    accumulatedData: {
      durationWheelbaseSpeedOverZero: 1540,
      durationWheelbaseSpeedZero: 560,
    },
  })], initial.states, {
    now: new Date("2026-07-15T05:11:00Z"),
  });
  assert.equal(running.vehicles[0].movementState, "MOVING");

  const idle = consolidateVehicleEvents([event({
    createdDateTime: "2026-07-15T05:20:00Z",
    receivedDateTime: "2026-07-15T05:20:01Z",
    accumulatedData: {
      durationWheelbaseSpeedOverZero: 1600,
      durationWheelbaseSpeedZero: 1100,
    },
  })], running.states, {
    now: new Date("2026-07-15T05:21:00Z"),
  });
  assert.equal(idle.vehicles[0].movementState, "STANDSTILL");
  assert.equal(idle.vehicles[0].currentStandstillStartedAt, "2026-07-15T05:20:00Z");
});

test("converts Volvo units safely and marks old status data stale", () => {
  const vehicle = consolidateVehicleEvents([event({
    hrTotalVehicleDistance: 123456000,
    totalEngineHours: 5000,
    engineTotalFuelUsed: 9876000,
    grossCombinationVehicleWeight: 32000,
  })], new Map(), {
    now: new Date("2026-07-15T07:00:00Z"),
    staleAfterMinutes: 90,
  }).vehicles[0];

  assert.equal(vehicle.odometerKm, 123456);
  assert.equal(vehicle.engineHours, 5000);
  assert.equal(vehicle.totalFuelLitres, 9876);
  assert.equal(vehicle.grossWeightKg, 32000);
  assert.equal(vehicle.isStale, true);
});

test("creates stable duplicate-prevention keys", () => {
  const value = event();
  assert.equal(stableEventKey(value), stableEventKey({ ...value }));
  assert.notEqual(stableEventKey(value), stableEventKey({ ...value, receivedDateTime: "2026-07-15T05:00:02Z" }));
});

test("starts a new accumulated-counter baseline after a reset", () => {
  const makeStatus = (createdDateTime, runningSeconds, distanceMetres) => event({
    createdDateTime,
    receivedDateTime: createdDateTime,
    hrTotalVehicleDistance: distanceMetres,
    totalEngineHours: runningSeconds / 3600,
    engineTotalFuelUsed: runningSeconds * 100,
    accumulatedData: {
      durationWheelbaseSpeedOverZero: runningSeconds,
      durationWheelbaseSpeedZero: 0,
    },
  });
  const rows = buildDriverStandstillRows({
    vehicles: [{ trackerId: "VIN-1", vehicleNumber: "V1", siteName: "Gauri" }],
    statuses: [
      makeStatus("2026-07-15T05:00:00Z", 1000, 100000),
      makeStatus("2026-07-15T05:10:00Z", 10, 1000),
      makeStatus("2026-07-15T05:20:00Z", 20, 2000),
    ],
    shiftStart: "2026-07-15T05:00:00Z",
    shiftEnd: "2026-07-15T13:00:00Z",
    shiftName: "A",
    driverMap: new Map(),
    now: new Date("2026-07-15T06:00:00Z"),
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalTime, "0:00");
  assert.equal(rows[0].drivingKm, 1);
});

test("paginates lower-camel latest status responses using lastVin", async () => {
  const urls = [];
  const payloads = [
    {
      vehicleStatusResponse: { vehicleStatuses: [event({ vin: "VIN-1" })] },
      moreDataAvailable: true,
      requestServerDateTime: "2026-07-15T05:00:00Z",
    },
    {
      vehicleStatusResponse: { vehicleStatuses: [event({ vin: "VIN-2" })] },
      moreDataAvailable: false,
      requestServerDateTime: "2026-07-15T05:01:00Z",
    },
  ];
  const client = new VolvoRfmsClient({
    baseUrl: "https://volvo.example.test/rfms",
    username: "user",
    password: "password",
    retries: 0,
    fetchFn: async (url) => {
      urls.push(String(url));
      return response(200, payloads.shift());
    },
  });
  const batch = await client.fetchLatestVehicleStatusBatch({ contentFilter: null });

  assert.equal(batch.events.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get("lastVin"), "VIN-1");
  assert.equal(batch.requestServerDateTime, "2026-07-15T05:01:00Z");
});

test("keeps valid latest pages when Volvo omits the final status array", async () => {
  const payloads = [
    {
      VehicleStatus: [event({ vin: "VIN-1" })],
      MoreDataAvailable: true,
      RequestServerDateTime: "2026-07-15T05:00:00Z",
    },
    {
      MoreDataAvailable: true,
      RequestServerDateTime: "2026-07-15T05:01:00Z",
    },
  ];
  const client = new VolvoRfmsClient({
    baseUrl: "https://volvo.example.test/rfms",
    username: "test-user",
    password: "test-password",
    fetchFn: async () => new Response(JSON.stringify(payloads.shift()), { status: 200 }),
  });

  const batch = await client.fetchLatestVehicleStatusBatch({ contentFilter: null });

  assert.equal(batch.events.length, 1);
  assert.equal(batch.pageCount, 2);
  assert.equal(batch.moreDataAvailable, true);
});

test("honours Retry-After for HTTP 429 and does not retry HTTP 401 or 403", async () => {
  const delays = [];
  let calls = 0;
  const retryClient = new VolvoRfmsClient({
    baseUrl: "https://volvo.example.test/rfms",
    username: "user",
    password: "password",
    retries: 1,
    sleepFn: async (milliseconds) => delays.push(milliseconds),
    fetchFn: async () => {
      calls += 1;
      return calls === 1
        ? response(429, {}, { "retry-after": "2" })
        : response(200, { Vehicle: [], MoreDataAvailable: false });
    },
  });
  await retryClient.fetchAllVehicles();
  assert.deepEqual(delays, [2000]);
  assert.equal(calls, 2);

  for (const status of [401, 403]) {
    let authCalls = 0;
    const authClient = new VolvoRfmsClient({
      baseUrl: "https://volvo.example.test/rfms",
      username: "user",
      password: "password",
      retries: 3,
      fetchFn: async () => {
        authCalls += 1;
        return response(status, {});
      },
    });
    await assert.rejects(() => authClient.fetchAllVehicles(), (error) => error.statusCode === status);
    assert.equal(authCalls, 1);
  }
});

test("aborts a timed-out Volvo request without leaking credentials", async () => {
  const client = new VolvoRfmsClient({
    baseUrl: "https://volvo.example.test/rfms",
    username: "timeout-user",
    password: "timeout-password",
    timeoutMs: 5,
    retries: 0,
    fetchFn: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  await assert.rejects(() => client.fetchAllVehicles(), (error) => {
    assert.equal(error.statusCode, 504);
    assert.equal(error.message.includes("timeout-password"), false);
    return true;
  });
});
