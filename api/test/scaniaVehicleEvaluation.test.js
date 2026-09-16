const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  driverAssignmentsFromPayload,
  averageFuelConsumptionLitresPer100KmToKmPerLitre,
  filterAndNormalizeRows,
  generateVehicleEvaluationReport,
  pollCompletedReport,
  reportRowsFromPayload,
  validateReportInput,
} = require("../src/lib/scania/scaniaVehicleEvaluation");

function gasRow(overrides = {}) {
  return {
    LicensePlate: "S483",
    Vin: "VIN-S483",
    EngineRunningTime: "1:14:30",
    Distance: 14.44,
    AverageFuelConsumption: 72.46,
    TotalFuelConsumption: 10.47,
    FuelConsumptionPerHour: 8.48,
    IdlingValue: 53.42,
    EngineRuntimeIdle: "0:40:00",
    PerformanceModePowerPercentage: 0,
    TotalDistanceWithPerformanceModePower: 0,
    CoastingValue: 20.15,
    StopDate: "2026-07-31 13:00:00",
    ...overrides,
  };
}

function master(overrides = {}) {
  return {
    vehicleNumber: "S483",
    vin: "VIN-S483",
    siteId: "site-ncl-dch-west",
    siteName: "DCH West",
    ...overrides,
  };
}

function reportRequest(overrides = {}) {
  return validateReportInput({
    site: "DCH West",
    shift: "A",
    startTime: "2026-07-31T05:00:00+05:30",
    stopTime: "2026-07-31T13:00:00+05:30",
    ...overrides,
  });
}

test("converts Scania AverageFuelConsumption from L/100 km to km/L", () => {
  assert.equal(averageFuelConsumptionLitresPer100KmToKmPerLitre(72.46), 1.38);
  assert.equal(averageFuelConsumptionLitresPer100KmToKmPerLitre(100), 1);
  assert.equal(averageFuelConsumptionLitresPer100KmToKmPerLitre(0), null);
});

test("uses normal Shift A, B, and C windows and rejects A2", () => {
  const request = reportRequest();
  assert.equal(request.shift, "A");
  assert.equal(request.startTime, "2026-07-31T05:00:00+05:30");
  assert.equal(request.stopTime, "2026-07-31T13:00:00+05:30");
  assert.equal(request.siteMapping.scaniaSite, "Dudhichua Singrauli");
  assert.equal(request.siteMapping.timezone, "Asia/Kolkata");
  const shiftB = validateReportInput({
    site: "DCH West",
    shift: "B",
    startTime: "2026-07-31T00:00:00+05:30",
    stopTime: "2026-07-31T23:59:59+05:30",
  });
  assert.equal(shiftB.startTime, "2026-07-31T13:00:00+05:30");
  assert.equal(shiftB.stopTime, "2026-07-31T21:00:00+05:30");
  const shiftC = validateReportInput({
    site: "DCH West",
    shift: "C",
    startTime: "2026-07-31T00:00:00+05:30",
    stopTime: "2026-07-31T23:59:59+05:30",
  });
  assert.equal(shiftC.startTime, "2026-07-31T21:00:00+05:30");
  assert.equal(shiftC.stopTime, "2026-08-01T05:00:00+05:30");
  assert.throws(
    () => validateReportInput({
      site: "DCH West",
      shift: "A2",
      startTime: "2026-07-31T05:00:00+05:30",
      stopTime: "2026-07-31T11:45:00+05:30",
    }),
    /shift mapping is not configured/i,
  );
});

test("maps and filters Sasti OCM, DCH West, and DCH East independently", () => {
  const mappings = [
    ["Sasti OCM", "site-wcl-sasti-ocm"],
    ["DCH West", "site-ncl-dch-west"],
    ["DCH East", "site-ncl-dch-east"],
  ];
  for (const [site, expectedId] of mappings) {
    assert.equal(reportRequest({ site }).siteMapping.fmsSiteId, expectedId);
  }

  const importedVehicles = [
    master(),
    master({
      vehicleNumber: "S484",
      vin: "VIN-S484",
      siteId: "site-ncl-dch-east",
      siteName: "DCH East",
      rawSiteName: "Dudhichua Singrauli",
    }),
  ];
  const result = filterAndNormalizeRows([
    gasRow(),
    gasRow({ LicensePlate: "S484", Vin: "VIN-S484" }),
  ], importedVehicles, reportRequest({ site: "DCH East" }));

  assert.deepEqual(result.rows.map((row) => row.registrationNumber), ["S484"]);
  assert.equal(result.filterCounts.differentSite, 1);
});

test("normalizes live rows and records every site/master/time filter removal", () => {
  const importedVehicles = [
    master(),
    master({ vehicleNumber: "S484", vin: "VIN-S484" }),
    master({
      vehicleNumber: "OTHER-1",
      vin: "VIN-OTHER",
      siteId: "site-other",
      siteName: "Other Site",
    }),
  ];
  const rawRows = [
    gasRow(),
    gasRow({ LicensePlate: "S484", Vin: "VIN-S484", EngineRunningTime: "0:29:59" }),
    gasRow({ LicensePlate: "OTHER-1", Vin: "VIN-OTHER" }),
    gasRow({ LicensePlate: "MISSING", Vin: "VIN-MISSING" }),
    gasRow(),
  ];

  const result = filterAndNormalizeRows(rawRows, importedVehicles, reportRequest());

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    registrationNumber: "S483",
    vin: "VIN-S483",
    driverName: "Unknown",
    driverReference: null,
    engineRunningTime: "1:14",
    distanceDrivenKm: 14.44,
    fuelEconomyKmPerLitre: 1.38,
    fuelConsumedLitres: 10.47,
    fuelConsumptionLitresPerHour: 8.48,
    idlingPercentage: 53.42,
    idlingTime: "0:40",
    performanceModePowerKm: 0,
    performanceModePowerPercentage: 0,
    powertrainCoastingPercentage: 20.15,
    lastUpdatedAt: "2026-07-31T13:00:00+05:30",
  });
  assert.deepEqual(result.filterCounts, {
    missingVehicleMaster: 1,
    differentSite: 1,
    engineRunningTimeUnder30Minutes: 1,
    duplicateVehicle: 1,
  });
});

test("stores a SessionId and polls until asynchronous Scania rows are complete", async () => {
  const stored = [];
  let calls = 0;
  const result = await pollCompletedReport(
    {
      payload: { SessionId: "session-1234" },
      endpoint: "https://dataaccess.scania.test/report",
      status: 202,
    },
    reportRequest(),
    {
      client: {
        async getVehicleEvaluationResult() {
          calls += 1;
          if (calls === 1) {
            return {
              payload: { Status: "Processing" },
              endpoint: "https://dataaccess.scania.test/report/result",
              status: 200,
            };
          }
          return {
            payload: {
              Status: "Completed",
              EvaluationVehiclesWithGasConsumption: {
                VehicleList: { EvaluationVehicleWithGasConsumption: [gasRow()] },
              },
            },
            endpoint: "https://dataaccess.scania.test/report/result",
            status: 200,
          };
        },
      },
      logger() {},
      sessionStore: {
        async saveSession(value) { stored.push(["save", value]); },
        async updateSession(sessionId, value) { stored.push(["update", { sessionId, ...value }]); },
      },
      sleepFn: async () => {},
      pollingIntervalMs: 1,
      pollingTimeoutMs: 100,
      nowFn: () => 0,
    },
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.sessionId, "session-1234");
  assert.equal(calls, 2);
  assert.equal(stored[0][1].sessionId, "session-1234");
  assert.equal(stored.at(-1)[1].status, "completed");
});

test("returns normalized live report metadata without hard-coded vehicle rows", async () => {
  const payload = {
    EvaluationVehiclesWithGasConsumption: {
      VehicleList: { EvaluationVehicleWithGasConsumption: [gasRow()] },
    },
  };
  const result = await generateVehicleEvaluationReport({
    site: "DCH West",
    shift: "A",
    startTime: "2026-07-31T00:00:00+05:30",
    stopTime: "2026-07-31T23:59:59+05:30",
  }, {
    client: {
      async getVehicleEvaluationWithGasConsumption(query) {
        assert.deepEqual(query, {
          startDate: "2026-07-31",
        });
        return {
          payload,
          endpoint: "https://dataaccess.scania.test/vehicle-evaluation",
          status: 200,
        };
      },
    },
    importedVehicles: [master()],
    nowFn: () => Date.parse("2026-07-31T12:00:00+05:30"),
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.meta.httpStatus, 200);
  assert.equal(result.meta.rawRecordCount, 1);
  assert.equal(result.meta.finalFilteredVehicleCount, 1);
  assert.equal(result.period.shift, "A");
  assert.equal(result.period.start, "2026-07-31T05:00:00+05:30");
  assert.equal(result.period.end, "2026-07-31T13:00:00+05:30");
  assert.equal(result.period.scaniaSite, "Dudhichua Singrauli");
});

test("parses the direct Scania Vehicle Evaluation envelope used by the live API", () => {
  const payload = {
    EvaluationStart: "20260801",
    EvaluationEnd: null,
    VehicleList: [gasRow()],
  };
  const parsed = reportRowsFromPayload(payload);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].Vin, "VIN-S483");
  assert.equal(parsed.source, "vehicle-evaluation");
  assert.equal(parsed.evaluation, payload);
});

test("joins Scania Driver Evaluation identities to their vehicle VINs", () => {
  const assignments = driverAssignmentsFromPayload({
    Drivers: [{
      DriverName: "Test Driver",
      DriverIdentification: "12345678",
      Vehicles: [{ Vin: "VIN-S483", CustomerVehicleName: "S483" }],
    }],
  });
  assert.equal(assignments.get("vin s483").driverName, "Test Driver");
  assert.equal(assignments.get("s483").driverReference, "12345678");
});

test("exact report periods preserve partial-shift and all-shift consumption windows", () => {
  const partial = reportRequest({ exactPeriod: true, stopTime: "2026-07-31T09:15:00+05:30" });
  assert.equal(partial.stopTime, "2026-07-31T09:15:00+05:30");
  const all = reportRequest({ exactPeriod: true, stopTime: "2026-08-01T05:00:00+05:30" });
  assert.equal(all.stopTime, "2026-08-01T05:00:00+05:30");
});
