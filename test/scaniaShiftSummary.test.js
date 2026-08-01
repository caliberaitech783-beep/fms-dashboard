const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  buildScaniaShiftSummary,
  resolveShift,
} = require("../src/lib/scania/scaniaShiftSummary");

const siteMapping = {
  fmsSite: "Sasti OCM",
  fmsSiteId: "site-wcl-sasti-ocm",
  timezone: "Asia/Kolkata",
};

test("resolves Scania status event times against Asia/Kolkata shift boundaries", () => {
  assert.deepEqual(resolveShift("2026-07-31T23:29:00Z"), {
    shift: "C",
    shiftDate: "2026-07-31",
  });
  assert.deepEqual(resolveShift("2026-07-31T23:30:00Z"), {
    shift: "A",
    shiftDate: "2026-08-01",
  });
  assert.deepEqual(resolveShift("2026-07-31T15:30:00Z"), {
    shift: "C",
    shiftDate: "2026-07-31",
  });
});

test("builds a site and shift filtered cumulative Scania summary without duplicates", () => {
  const report = buildScaniaShiftSummary({
    request: {
      site: "Sasti OCM",
      shift: "A",
      reportDate: "2026-07-31",
      startTime: "2026-07-31T05:00:00+05:30",
      stopTime: "2026-07-31T13:00:00+05:30",
      siteMapping,
    },
    vehicles: [
      { Vin: "VIN-1", CustomerVehicleName: "SC-101" },
      { Vin: "VIN-2", CustomerVehicleName: "SC-202" },
    ],
    importedVehicles: [
      { vin: "VIN-1", vehicleNumber: "SC-101", siteId: "site-wcl-sasti-ocm", siteName: "Sasti OCM", active: true },
      { vin: "VIN-2", vehicleNumber: "SC-202", siteId: "site-ncl-dch-west", siteName: "DCH West", active: true },
    ],
    statuses: [
      {
        Vin: "VIN-1",
        CreatedDateTime: "2026-07-31T00:30:00Z",
        HrTotalVehicleDistance: 90_000,
        EngineTotalFuelUsed: 45_000,
        TotalEngineHours: 11,
      },
      {
        Vin: "VIN-1",
        CreatedDateTime: "2026-07-31T01:00:00Z",
        HrTotalVehicleDistance: 100_000,
        EngineTotalFuelUsed: 50_000,
        TotalEngineHours: 12.5,
      },
      {
        Vin: "VIN-2",
        CreatedDateTime: "2026-07-31T01:15:00Z",
        HrTotalVehicleDistance: 200_000,
        EngineTotalFuelUsed: 100_000,
        TotalEngineHours: 20,
      },
    ],
    generatedAt: "2026-07-31T02:00:00.000Z",
  });

  assert.equal(report.rows.length, 1);
  assert.deepEqual(report.rows[0], {
    shift: "A",
    site: "Sasti OCM",
    vehicles: 1,
    fuelConsumedLitres: 50,
    distanceKm: 100,
    runningHours: 12.5,
    idleHours: null,
    idlePercentage: null,
    efficiencyKmPerLitre: 2,
    trips: null,
    productionM3: null,
    coverage: "Scania live cumulative snapshot",
  });
  assert.equal(report.meta.latestStatusCount, 2);
  assert.equal(report.meta.matchedVehicleCount, 1);
});
