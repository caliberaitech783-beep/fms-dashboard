const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  VEHICLES_ACCEPT,
  VEHICLE_STATUSES_ACCEPT,
  VolvoRfmsClient,
  classifyVolvoVehicleStatus,
  findVolvoSiteAssignment,
  normalizeVolvoTelemetry,
  normalizeVolvoVehicle,
  parseVolvoSiteMap,
} = require("../src/lib/volvo/volvoRfmsClient");
const {
  fetchFleetHistory,
  fetchReportHistory,
  fetchReportHistoryCandidates,
  fetchVehicleScopedHistory,
  reportHistoryStrategy,
} = require("../src/lib/volvo/driverStandstillReport");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

test("uses RFMS Basic authentication and the v2.1 vehicles media type", async () => {
  const calls = [];
  const client = new VolvoRfmsClient({
    baseUrl: "https://volvo.example.test/rfms",
    username: "test-user",
    password: "test-password",
    retries: 0,
    requestIdFactory: () => "request-1",
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, { Vehicle: [], MoreDataAvailable: false });
    },
  });

  await client.fetchAllVehicles();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Accept, VEHICLES_ACCEPT);
  assert.equal(
    calls[0].options.headers.Authorization,
    `Basic ${Buffer.from("test-user:test-password").toString("base64")}`,
  );
  assert.match(calls[0].url, /requestId=request-1/);
});

test("paginates the vehicle list using the last VIN", async () => {
  const urls = [];
  const responses = [
    { Vehicle: [{ VIN: "VIN-1" }, { VIN: "VIN-2" }], MoreDataAvailable: true },
    { Vehicle: [{ VIN: "VIN-3" }], MoreDataAvailable: false },
  ];
  const client = new VolvoRfmsClient({
    baseUrl: "https://volvo.example.test/rfms",
    username: "test-user",
    password: "test-password",
    retries: 0,
    requestIdFactory: () => "request-2",
    fetchFn: async (url) => {
      urls.push(String(url));
      return jsonResponse(200, responses.shift());
    },
  });

  const vehicles = await client.fetchAllVehicles();

  assert.deepEqual(vehicles.map((vehicle) => vehicle.VIN), ["VIN-1", "VIN-2", "VIN-3"]);
  assert.equal(new URL(urls[1]).searchParams.get("lastVin"), "VIN-2");
});

test("paginates latest status records with the accumulated content filter", async () => {
  const calls = [];
  const responses = [
    { VehicleStatus: [{ Vin: "VIN-1" }, { Vin: "VIN-2" }], MoreDataAvailable: true },
    { VehicleStatus: [{ Vin: "VIN-3" }], MoreDataAvailable: false },
  ];
  const client = new VolvoRfmsClient({
    baseUrl: "https://volvo.example.test/rfms",
    username: "test-user",
    password: "test-password",
    retries: 0,
    requestIdFactory: () => "status-request",
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, responses.shift());
    },
  });

  const statuses = await client.fetchLatestVehicleStatuses();

  assert.deepEqual(statuses.map((status) => status.Vin), ["VIN-1", "VIN-2", "VIN-3"]);
  assert.equal(calls[0].options.headers.Accept, VEHICLE_STATUSES_ACCEPT);
  assert.equal(new URL(calls[0].url).searchParams.get("latestOnly"), "true");
  assert.equal(new URL(calls[0].url).searchParams.get("contentFilter"), "ACCUMULATED");
  assert.equal(new URL(calls[1].url).searchParams.get("lastVin"), "VIN-2");
});

test("paginates historical status records using the received-time cursor", async () => {
  const calls = [];
  const responses = [
    {
      VehicleStatus: [{
        Vin: "VIN-1",
        CreatedDateTime: "2026-07-14T00:00:00Z",
        ReceivedDateTime: "2026-07-14T00:00:05Z",
      }],
      MoreDataAvailable: true,
    },
    {
      VehicleStatus: [{
        Vin: "VIN-2",
        CreatedDateTime: "2026-07-14T00:01:00Z",
        ReceivedDateTime: "2026-07-14T00:01:05Z",
      }],
      MoreDataAvailable: false,
    },
  ];
  const client = new VolvoRfmsClient({
    baseUrl: "https://volvo.example.test/rfms",
    username: "test-user",
    password: "test-password",
    retries: 0,
    requestIdFactory: () => "history-request",
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, responses.shift());
    },
  });

  const statuses = await client.fetchHistoricalVehicleStatuses({
    startTime: "2026-07-13T23:00:00Z",
    stopTime: "2026-07-14T01:00:00Z",
  });

  assert.deepEqual(statuses.map((status) => status.Vin), ["VIN-1", "VIN-2"]);
  assert.equal(calls[0].options.headers.Accept, VEHICLE_STATUSES_ACCEPT);
  assert.equal(new URL(calls[0].url).searchParams.get("contentFilter"), "ACCUMULATED");
  assert.equal(new URL(calls[0].url).searchParams.has("latestOnly"), false);
  assert.equal(new URL(calls[1].url).searchParams.get("starttime"), "2026-07-14T00:00:06.000Z");
});

test("fetches report history only for the selected vehicle VINs", async () => {
  const calls = [];
  const activeRequests = { current: 0, maximum: 0 };
  const client = {
    async fetchHistoricalVehicleStatuses(options) {
      calls.push(options);
      activeRequests.current += 1;
      activeRequests.maximum = Math.max(activeRequests.maximum, activeRequests.current);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests.current -= 1;
      return [{
        Vin: options.vin,
        CreatedDateTime: "2026-07-17T00:00:00Z",
        ReceivedDateTime: "2026-07-17T00:00:05Z",
      }];
    },
  };

  const events = await fetchVehicleScopedHistory(client, [
    { trackerId: "VIN-1" },
    { trackerId: "VIN-2" },
    { trackerId: "VIN-1" },
    { trackerId: "VIN-3" },
  ], {
    startTime: "2026-07-16T23:00:00Z",
    stopTime: "2026-07-17T08:00:00Z",
    maxPages: 10,
    concurrency: 2,
  });

  assert.deepEqual(calls.map((call) => call.vin).sort(), ["VIN-1", "VIN-2", "VIN-3"]);
  assert.equal(activeRequests.maximum, 2);
  assert.equal(events.length, 3);
  assert.ok(calls.every((call) => call.startTime === "2026-07-16T23:00:00Z"));
});

test("fetches a report period in one fleet-scoped Volvo history query", async () => {
  const calls = [];
  const client = {
    async fetchHistoricalVehicleStatuses(options) {
      calls.push(options);
      return [
        { Vin: "VIN-1", CreatedDateTime: "2026-08-13T00:00:00Z" },
        { Vin: "VIN-2", CreatedDateTime: "2026-08-13T00:01:00Z" },
      ];
    },
  };

  const statuses = await fetchFleetHistory(client, [
    { trackerId: "VIN-1" },
    { trackerId: "VIN-2" },
  ], {
    startTime: "2026-08-12T22:40:00.000Z",
    stopTime: "2026-08-13T05:05:00.000Z",
    maxPages: 120,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].vin, undefined);
  assert.deepEqual(statuses.map((status) => status.Vin), ["VIN-1", "VIN-2"]);
});

test("uses supported per-VIN history directly for a small site such as Dhoptala", async () => {
  const calls = [];
  const client = {
    async fetchHistoricalVehicleStatuses(options) {
      calls.push(options);
      if (!options.vin) throw new Error("Fleet history must not be requested for a small site");
      return [{ Vin: options.vin, CreatedDateTime: "2026-08-13T08:00:00Z" }];
    },
  };
  const vehicles = Array.from({ length: 12 }, (_, index) => ({ trackerId: `VIN-${index + 1}` }));

  const statuses = await fetchReportHistory(client, vehicles, {
    concurrency: 3,
    continueOnError: false,
    vehicleRequestThreshold: 20,
    startTime: "2026-08-13T06:30:00.000Z",
    stopTime: "2026-08-13T09:45:00.000Z",
  });

  assert.equal(calls.length, 12);
  assert.ok(calls.every((call) => call.vin));
  assert.equal(statuses.length, 12);
});

test("falls back to selected VINs when a large-site fleet query is unavailable", async () => {
  const calls = [];
  const client = {
    async fetchHistoricalVehicleStatuses(options) {
      calls.push(options);
      if (!options.vin) throw new Error("Fleet history is unavailable");
      return [{ Vin: options.vin, CreatedDateTime: "2026-08-13T08:00:00Z" }];
    },
  };
  const vehicles = [
    { trackerId: "VIN-1" },
    { trackerId: "VIN-2" },
    { trackerId: "VIN-3" },
  ];

  const statuses = await fetchReportHistory(client, vehicles, {
    concurrency: 3,
    continueOnError: false,
    vehicleRequestThreshold: 2,
    startTime: "2026-08-13T06:30:00.000Z",
    stopTime: "2026-08-13T09:45:00.000Z",
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].vin, undefined);
  assert.deepEqual(statuses.map((status) => status.Vin), ["VIN-1", "VIN-2", "VIN-3"]);
});

test("queries Majri fallback days separately instead of one combined 33-hour request", async () => {
  const calls = [];
  const client = {
    async fetchHistoricalVehicleStatuses(options) {
      calls.push(options);
      return [{ Vin: options.vin, CreatedDateTime: "2026-08-14T01:00:00Z" }];
    },
  };
  const windows = [{
    date: "2026-08-14",
    window: {
      shiftStart: "2026-08-14T04:00:00+05:30",
      shiftEnd: "2026-08-14T12:00:00+05:30",
    },
  }, {
    date: "2026-08-13",
    window: {
      shiftStart: "2026-08-13T04:00:00+05:30",
      shiftEnd: "2026-08-13T12:00:00+05:30",
    },
  }];

  const result = await fetchReportHistoryCandidates(client, [{ trackerId: "VIN-MAJRI-1" }], {
    candidates: windows,
    buildRows: (statuses) => statuses.length ? [{ vehicle: "V 1" }] : [],
    continueOnError: false,
    now: new Date("2026-08-14T12:02:00+05:30"),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].startTime, "2026-08-13T21:30:00.000Z");
  assert.equal(calls[0].stopTime, "2026-08-14T06:35:00.000Z");
  assert.equal(result.candidate.date, "2026-08-14");
});

test("requests the prior Majri shift only when the current shift has no rows", async () => {
  const calls = [];
  const client = {
    async fetchHistoricalVehicleStatuses(options) {
      calls.push(options);
      return [{ Vin: options.vin, CreatedDateTime: options.startTime }];
    },
  };
  const candidates = [{
    date: "2026-08-14",
    window: {
      shiftStart: "2026-08-14T04:00:00+05:30",
      shiftEnd: "2026-08-14T12:00:00+05:30",
    },
  }, {
    date: "2026-08-13",
    window: {
      shiftStart: "2026-08-13T04:00:00+05:30",
      shiftEnd: "2026-08-13T12:00:00+05:30",
    },
  }];

  const result = await fetchReportHistoryCandidates(client, [{ trackerId: "VIN-MAJRI-1" }], {
    candidates,
    buildRows: (_statuses, reportWindow) => (
      reportWindow.shiftStart.startsWith("2026-08-13") ? [{ vehicle: "V 1" }] : []
    ),
    continueOnError: false,
    now: new Date("2026-08-14T12:02:00+05:30"),
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].startTime, "2026-08-12T21:30:00.000Z");
  assert.equal(calls[1].stopTime, "2026-08-13T06:35:00.000Z");
  assert.equal(result.candidate.date, "2026-08-13");
  assert.equal(result.candidateIndex, 1);
});

test("uses selected-VIN history with bounded higher concurrency for Majri", async () => {
  const strategy = reportHistoryStrategy("WCL / Majri OCM", {
    concurrency: 6,
    vehicleRequestThreshold: 20,
    majriConcurrency: 12,
  });
  const calls = [];
  const client = {
    async fetchHistoricalVehicleStatuses(options) {
      calls.push(options);
      assert.ok(options.vin, "Majri must not start an all-fleet history query");
      return [{ Vin: options.vin, CreatedDateTime: "2026-08-14T01:00:00Z" }];
    },
  };
  const vehicles = Array.from({ length: 25 }, (_, index) => ({ trackerId: `MAJRI-${index + 1}` }));

  const statuses = await fetchReportHistory(client, vehicles, {
    ...strategy,
    continueOnError: false,
    startTime: "2026-08-13T21:30:00.000Z",
    stopTime: "2026-08-14T06:35:00.000Z",
  });

  assert.equal(strategy.concurrency, 12);
  assert.equal(strategy.vehicleRequestThreshold, Number.MAX_SAFE_INTEGER);
  assert.equal(calls.length, 25);
  assert.equal(statuses.length, 25);
});

test("keeps the configured fleet-history strategy for non-Majri sites", () => {
  assert.deepEqual(reportHistoryStrategy("Dhoptala OCM", {
    concurrency: 6,
    vehicleRequestThreshold: 20,
    majriConcurrency: 12,
  }), {
    concurrency: 6,
    vehicleRequestThreshold: 20,
  });
});

test("does not start slow per-vehicle queries when fleet report history fails", async () => {
  const calls = [];
  const client = {
    async fetchHistoricalVehicleStatuses(options) {
      calls.push(options);
      throw new Error("Fleet history is unavailable");
    },
  };

  await assert.rejects(
    fetchFleetHistory(client, [{ trackerId: "VIN-1" }], {
      fallbackToVehicleRequests: false,
      startTime: "2026-08-12T22:40:00.000Z",
      stopTime: "2026-08-13T05:05:00.000Z",
    }),
    /Fleet history is unavailable/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].vin, undefined);
});

test("falls back to per-vehicle queries when fleet history is unavailable", async () => {
  const calls = [];
  const client = {
    async fetchHistoricalVehicleStatuses(options) {
      calls.push(options);
      if (!options.vin) throw new Error("Fleet history is not supported");
      return [{ Vin: options.vin, CreatedDateTime: "2026-08-13T00:00:00Z" }];
    },
  };

  const statuses = await fetchFleetHistory(client, [
    { trackerId: "VIN-1" },
    { trackerId: "VIN-2" },
  ], {
    concurrency: 2,
    continueOnError: false,
    startTime: "2026-08-12T22:40:00.000Z",
    stopTime: "2026-08-13T05:05:00.000Z",
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(statuses.map((status) => status.Vin), ["VIN-1", "VIN-2"]);
});

test("masks Volvo credentials from transport failures", async () => {
  const password = "sensitive-password";
  const client = new VolvoRfmsClient({
    baseUrl: "https://volvo.example.test/rfms",
    username: "sensitive-user",
    password,
    retries: 0,
    fetchFn: async () => {
      throw new Error(`transport failure ${password}`);
    },
  });

  await assert.rejects(() => client.fetchAllVehicles(), (error) => {
    assert.equal(error.message.includes(password), false);
    assert.equal(error.message.includes("[masked]"), true);
    return true;
  });
});

test("normalizes Volvo RFMS vehicle master data with live status", () => {
  const vehicle = normalizeVolvoVehicle({
    VIN: "YV2TEST1234567890",
    CustomerVehicleName: "V117",
    Brand: "VOLVO TRUCKS",
    Type: "TRUCK",
    Model: "FM (4)",
  }, {
    Vin: "YV2TEST1234567890",
    CreatedDateTime: "2026-07-14T08:00:00.000Z",
    TriggerType: { TriggerType: "TIMER" },
  }, {
    now: new Date("2026-07-14T08:30:00.000Z"),
    maxAgeMinutes: 120,
  });

  assert.equal(vehicle.id, "volvo-rfms-YV2TEST1234567890");
  assert.equal(vehicle.vehicleNumber, "V117");
  assert.equal(vehicle.company, "Volvo");
  assert.equal(vehicle.modelNumber, "FM (4)");
  assert.equal(vehicle.source, "VOLVO_RFMS_LIVE");
  assert.equal(vehicle.status, "running");
});

test("classifies explicit shutdown and stale Volvo reports", () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  assert.equal(classifyVolvoVehicleStatus({
    CreatedDateTime: "2026-07-14T09:55:00.000Z",
    TriggerType: { TriggerType: "IGNITION_OFF" },
  }, { now, maxAgeMinutes: 120 }), "stopped");
  assert.equal(classifyVolvoVehicleStatus({
    CreatedDateTime: "2026-07-14T07:00:00.000Z",
    TriggerType: { TriggerType: "TIMER" },
  }, { now, maxAgeMinutes: 120 }), "offline");
  assert.equal(classifyVolvoVehicleStatus(null, { now, maxAgeMinutes: 120 }), "offline");
});

test("normalizes Volvo accumulated status without treating lifetime counters as period totals", () => {
  const vehicle = normalizeVolvoVehicle({
    VIN: "YV2TEST1234567890",
    CustomerVehicleName: "V117",
    Type: "TRUCK",
    Model: "FM (4)",
  }, {
    Vin: "YV2TEST1234567890",
    CreatedDateTime: "2026-07-14T08:00:00.000Z",
    ReceivedDateTime: "2026-07-14T08:01:00.000Z",
    HRTotalVehicleDistance: 123456000,
    TotalEngineHours: 5000,
    EngineTotalFuelUsed: 9876000,
    AccumulatedData: {
      DurationWheelbaseSpeedOverZero: 7200,
      DurationWheelbaseSpeedZero: 1800,
      FuelWheelbaseSpeedOverZero: 8000000,
      FuelWheelbaseSpeedZero: 876000,
    },
    TriggerType: { TriggerType: "TIMER" },
  }, {
    now: new Date("2026-07-14T08:30:00.000Z"),
  });
  const telemetry = normalizeVolvoTelemetry(vehicle, {
    Vin: "YV2TEST1234567890",
    CreatedDateTime: "2026-07-14T08:00:00.000Z",
    ReceivedDateTime: "2026-07-14T08:01:00.000Z",
    HRTotalVehicleDistance: 123456000,
    TotalEngineHours: 5000,
    EngineTotalFuelUsed: 9876000,
    AccumulatedData: {
      DurationWheelbaseSpeedOverZero: 7200,
      DurationWheelbaseSpeedZero: 1800,
      FuelWheelbaseSpeedOverZero: 8000000,
      FuelWheelbaseSpeedZero: 876000,
    },
    TriggerType: { TriggerType: "TIMER" },
  });

  assert.equal(telemetry.status, "running");
  assert.equal(telemetry.odometerKm, 123456);
  assert.equal(telemetry.fuelConsumedLitres, null);
  assert.equal(telemetry.engineHours, null);
  assert.equal(telemetry.rawMetrics.lifetimeFuelLitres, 9876);
  assert.equal(telemetry.rawMetrics.lifetimeRunningHours, 2);
  assert.equal(telemetry.rawMetrics.lifetimeIdleHours, 0.5);
  assert.equal(telemetry.rawMetrics.lifetimeEfficiencyKmPerLitre, 123456 / 9876);
  assert.equal(telemetry.rawMetrics.fuelSpeedOverZeroLitres, 8000);
});

test("maps Volvo vehicles to configured sites by VIN or customer vehicle name", () => {
  const siteMap = parseVolvoSiteMap(JSON.stringify({
    "YV2TEST1234567890": {
      siteId: "site-wcl-sasti-ocm",
      siteName: "Sasti OCM",
      contractType: "Coal",
    },
    V193: "Jayant 1",
  }));

  assert.deepEqual(findVolvoSiteAssignment({ VIN: "yv2test1234567890" }, siteMap), {
    siteId: "site-wcl-sasti-ocm",
    siteName: "Sasti OCM",
    contractType: "Coal",
  });
  assert.deepEqual(findVolvoSiteAssignment({ CustomerVehicleName: "v193" }, siteMap), {
    siteId: null,
    siteName: "Jayant 1",
    contractType: null,
  });
  assert.deepEqual(findVolvoSiteAssignment({ CustomerVehicleName: "V-193" }, siteMap), {
    siteId: null,
    siteName: "Jayant 1",
    contractType: null,
  });
});
