const assert = require("node:assert/strict");
const test = require("node:test");
const { resetCaseEquipmentCache } = require("../src/lib/case/caseClient");
const {
  METRIC_DEFINITIONS,
  aggregateCaseMetrics,
  buildMetricUrl,
  fetchCaseReport,
  lastPageNumber,
  reportExcludedVins,
  splitDateRange,
  validateDateRange,
} = require("../src/lib/case/caseReportClient");

const reportEnv = {
  CASE_BASE_URL: "https://api-data.cnh.com/v1/equipment",
  CASE_CUMULATIVE_OPERATING_HOURS_URL: "https://api-data.cnh.com/v1/Fleet/Equipment/EXAMPLE/CumulativeOperatingHours/2021-04-24T14:55:13Z/2021-04-27T14:55:13Z/1",
  CASE_CUMULATIVE_FUEL_USED_URL: "https://api-data.cnh.com/v1/Fleet/Equipment/EXAMPLE/CumulativeFuelUsed/2021-04-24T14:55:13Z/2021-04-27T14:55:13Z/1",
  CASE_CUMULATIVE_IDLE_HOURS_URL: "https://api-data.cnh.com/v1/Fleet/Equipment/EXAMPLE/CumulativeIdleHours/2021-04-24T14:55:13Z/2021-04-27T14:55:13Z/1",
  CASE_ACCESS_TOKEN: "test-token",
  CASE_SUBSCRIPTION_KEY: "test-subscription",
  CASE_REQUEST_TIMEOUT_MS: "1000",
  CASE_CACHE_SECONDS: "0",
  CASE_REPORT_CACHE_SECONDS: "0",
};

test("builds metric URLs only from the supplied CASE endpoint templates", () => {
  const url = buildMetricUrl(
    reportEnv.CASE_CUMULATIVE_FUEL_USED_URL,
    METRIC_DEFINITIONS.fuel,
    {
      vin: "TEST-VIN",
      from: "2026-06-01T00:00:00Z",
      to: "2026-06-30T23:59:59Z",
      page: 3,
    },
  );
  const parsed = new URL(url);
  assert.equal(
    decodeURIComponent(parsed.pathname),
    "/v1/Fleet/Equipment/TEST-VIN/CumulativeFuelUsed/2026-06-01T00:00:00Z/2026-06-30T23:59:59Z/3",
  );
});

test("aggregates the exact CASE report calculations", () => {
  assert.deepEqual(aggregateCaseMetrics({
    operatingRecords: [{ Hour: 100 }, { Hour: 110 }],
    fuelRecords: [
      { FuelConsumed: 5, FuelUnits: "litre" },
      { FuelConsumed: 15, FuelUnits: "litre" },
    ],
    idleRecords: [{ Hour: 1 }, { Hour: 2 }],
  }), {
    totalFuel: 20,
    averageFuelPerHour: 2.857143,
    workingHours: 7,
    idleHours: 3,
    utilization: 70,
  });
});

test("keeps unavailable CASE metric values null instead of inventing data", () => {
  assert.deepEqual(aggregateCaseMetrics({
    operatingRecords: [],
    fuelRecords: [],
    idleRecords: [],
  }), {
    totalFuel: null,
    averageFuelPerHour: null,
    workingHours: null,
    idleHours: null,
    utilization: null,
  });
});

test("validates and splits CASE report periods into supported upstream windows", () => {
  const period = validateDateRange(
    "2026-06-01T00:00:00Z",
    "2026-07-01T23:59:59Z",
    reportEnv,
  );
  const ranges = splitDateRange(period.from, period.to);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].from, "2026-06-01T00:00:00Z");
  assert.equal(ranges[1].to, "2026-07-01T23:59:59Z");
  assert.throws(() => validateDateRange("invalid", period.to, reportEnv));
});

test("accepts only bounded same-origin CASE pagination", () => {
  const template = reportEnv.CASE_CUMULATIVE_FUEL_USED_URL;
  assert.equal(lastPageNumber({ Links: [{
    rel: "last",
    href: "https://api-data.cnh.com/v1/Fleet/Equipment/TEST/CumulativeFuelUsed/start/end/26",
  }] }, template, reportEnv), 26);
  assert.throws(() => lastPageNumber({ Links: [{
    rel: "last",
    href: "https://example.com/v1/Fleet/Equipment/TEST/CumulativeFuelUsed/start/end/2",
  }] }, template, reportEnv));
});

test("excludes the four retired CASE machines from reports", () => {
  const excluded = reportExcludedVins(reportEnv);
  assert.deepEqual([...excluded].sort(), [
    "HBZN865CCPAF30889",
    "HBZN865CEPAF30673",
    "HBZN865CKPAF31559",
    "HBZN865CPNAF27703",
  ].sort());
});

test("combines equipment and all three live CASE metric responses", async () => {
  resetCaseEquipmentCache();
  const requested = [];
  const payload = await fetchCaseReport({
    env: reportEnv,
    from: "2026-06-01T00:00:00Z",
    to: "2026-06-01T23:59:59Z",
    force: true,
    fetchImpl: async (url, init) => {
      requested.push({ url, init });
      let response;
      if (url.endsWith("/equipment")) {
        response = { equipment: [
          { vin: "TEST-VIN", model: "865C", devices: [] },
          { vin: "HBZN865CCPAF30889", model: "865C", devices: [] },
          { vin: "HBZN865CEPAF30673", model: "865C", devices: [] },
          { vin: "HBZN865CKPAF31559", model: "865C", devices: [] },
          { vin: "HBZN865CPNAF27703", model: "865C", devices: [] },
        ] };
      } else if (url.includes("/CumulativeOperatingHours/")) {
        response = { Links: [], CumulativeOperatingHours: [{ Hour: 100 }, { Hour: 110 }] };
      } else if (url.includes("/CumulativeFuelUsed/")) {
        response = { Links: [], FuelUsed: [{ FuelConsumed: 20, FuelUnits: "litre" }] };
      } else if (url.includes("/CumulativeIdleHours/")) {
        response = { Links: [], CumulativeIdleHours: [{ Hour: 3 }] };
      } else {
        throw new Error("Unexpected CASE URL in test");
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(response),
      };
    },
  });

  assert.equal(requested.length, 4);
  assert.equal(payload.equipmentCount, 1);
  assert.ok(requested.every(({ init }) => init.headers.Authorization === "Bearer test-token"));
  assert.deepEqual(payload.rows, [{
    machine: "TEST-VIN",
    model: "865C",
    totalFuel: 20,
    averageFuelPerHour: 2.857143,
    workingHours: 7,
    idleHours: 3,
    utilization: 70,
  }]);
});
