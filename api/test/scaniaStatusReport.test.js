const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateScaniaStatusReport } = require("../src/lib/scania/scaniaStatusReport");

function status(at, values) {
  return {
    vin: "SCANIA-VIN-1",
    createdDateTime: at,
    hrTotalVehicleDistance: values.distanceMetres,
    totalEngineHours: values.engineHours,
    engineTotalFuelUsed: values.fuelMillilitres,
    accumulatedData: {
      durationWheelbasedSpeedOverZero: values.runningSeconds,
      durationWheelbasedSpeedZero: values.standstillSeconds,
      drivingWithoutTorqueClass: { value: [{ seconds: values.coastingSeconds }] },
      engineTorqueClass: { value: [{ from: 40, to: 60, seconds: values.loadSeconds }] },
    },
  };
}

test("generates a Scania standstill report from RFMS status history", async () => {
  const records = [
    status("2026-07-31T23:00:00Z", {
      distanceMetres: 1_000_000,
      engineHours: 100,
      fuelMillilitres: 500_000,
      runningSeconds: 10_000,
      standstillSeconds: 4_000,
      coastingSeconds: 1_000,
      loadSeconds: 3_000,
    }),
    status("2026-08-01T01:00:00Z", {
      distanceMetres: 1_020_000,
      engineHours: 102,
      fuelMillilitres: 530_000,
      runningSeconds: 13_600,
      standstillSeconds: 7_600,
      coastingSeconds: 1_360,
      loadSeconds: 4_800,
    }),
  ];
  const result = await generateScaniaStatusReport({
    site: "Sasti OCM",
    shift: "A",
    startTime: "2026-08-01T05:00:00+05:30",
    stopTime: "2026-08-01T13:00:00+05:30",
  }, {
    importedVehicles: [],
    now: new Date("2026-08-01T12:00:00+05:30"),
    client: {
      async getVehicleStatuses(query) {
        assert.equal(query.latestOnly, false);
        assert.equal(query.dateType, "created");
        return {
          records,
          endpoint: "https://dataaccess.scania.test/rfms4/vehiclestatuses",
          status: 200,
        };
      },
    },
  });

  assert.equal(result.source, "SCANIA_RFMS_STATUS_HISTORY");
  assert.equal(result.period.site, "All Scania vehicles");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].registrationNumber, "SCANIA-VIN-1");
  assert.equal(result.rows[0].engineRunningTime, "2:00");
  assert.equal(result.rows[0].distanceDrivenKm, 20);
  assert.equal(result.rows[0].idlingPercentage, 50);
  assert.equal(result.rows[0].fuelConsumedLitres, 30);
  assert.match(result.notice, /VIN-to-site assignments are not loaded/);
});
