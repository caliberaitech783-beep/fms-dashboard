const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  buildDriverStandstillRows,
  driverIdentifier,
  parseDriverMap,
  resolveRecentReportDate,
} = require("../src/lib/volvo/driverStandstillReport");

function status(at, values) {
  return {
    Vin: "VIN-1",
    CreatedDateTime: at,
    Driver1Id: {
      OemDriverIdentification: {
        OemDriverIdentification: "DRIVER-7",
      },
    },
    HRTotalVehicleDistance: values.distanceMetres,
    TotalEngineHours: values.engineHours,
    EngineTotalFuelUsed: values.fuelMillilitres,
    AccumulatedData: {
      DurationWheelbaseSpeedOverZero: values.runningSeconds,
      DurationWheelbaseSpeedZero: values.standstillSeconds,
      DrivingWithoutTorqueClass: { Value: [{ Seconds: values.coastingSeconds }] },
      EngineTorqueClass: {
        Value: [
          { From: 0, To: 10, Seconds: values.lowLoadSeconds },
          { From: 50, To: 60, Seconds: values.highLoadSeconds },
        ],
      },
    },
  };
}

test("calculates Volvo driver standstill metrics from accumulated counter deltas", () => {
  const rows = buildDriverStandstillRows({
    vehicles: [{
      trackerId: "VIN-1",
      vehicleNumber: "V 697",
      siteName: "Gauri Pauni OCM",
    }],
    statuses: [
      status("2026-07-13T23:30:00Z", {
        distanceMetres: 1_000_000,
        engineHours: 100,
        fuelMillilitres: 500_000,
        runningSeconds: 10_000,
        standstillSeconds: 4_000,
        coastingSeconds: 1_000,
        lowLoadSeconds: 4_000,
        highLoadSeconds: 1_000,
      }),
      status("2026-07-14T03:30:00Z", {
        distanceMetres: 1_032_000,
        engineHours: 103,
        fuelMillilitres: 540_000,
        runningSeconds: 17_200,
        standstillSeconds: 7_600,
        coastingSeconds: 1_720,
        lowLoadSeconds: 5_800,
        highLoadSeconds: 2_800,
      }),
    ],
    shiftStart: "2026-07-14T05:00:00+05:30",
    shiftEnd: "2026-07-14T13:00:00+05:30",
    shiftName: "A",
    driverMap: parseDriverMap(JSON.stringify({ "DRIVER-7": "Test Driver" })),
    now: new Date("2026-07-14T13:30:00+05:30"),
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].vehicle, "V 697");
  assert.equal(rows[0].driver, "Test Driver");
  assert.equal(rows[0].totalTime, "3:00");
  assert.equal(rows[0].drivingKm, 32);
  assert.equal(rows[0].dieselEngineOnPercent, 37.5);
  assert.equal(rows[0].averageDieselEngineKmPerLitre, 0.8);
  assert.equal(rows[0].standstillPercent, 33.33);
  assert.equal(rows[0].standstillTime, "1:00");
  assert.equal(rows[0].coastingPercent, 10);
  assert.equal(rows[0].engineLoadPercent, 30);
  assert.equal(rows[0].averageDieselLitresPerHour, 13.33);
  assert.equal(rows[0].iShiftPerformanceTimePercent, null);
  assert.equal(rows[0].aboveEconomyPercent, null);
});

test("extracts driver identifiers without exposing credentials", () => {
  assert.equal(driverIdentifier({
    Driver1Id: { OemDriverIdentification: { OemDriverIdentification: "D-9" } },
  }), "D-9");
  assert.equal(driverIdentifier({}), null);
  assert.throws(() => parseDriverMap("not-json"), /must be valid JSON/);
});

test("keeps recent Volvo dates and replaces stale demo dates", () => {
  assert.deepEqual(resolveRecentReportDate("2026-07-14", "2026-07-17", 13), {
    date: "2026-07-14",
    requestedDate: "2026-07-14",
    fallbackApplied: false,
    ageDays: 3,
  });
  assert.deepEqual(resolveRecentReportDate("2026-06-30", "2026-07-17", 13), {
    date: "2026-07-17",
    requestedDate: "2026-06-30",
    fallbackApplied: true,
    ageDays: 17,
  });
});
