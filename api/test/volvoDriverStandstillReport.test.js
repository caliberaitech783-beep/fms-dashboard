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
          { From: 90, To: 100, Seconds: values.highLoadSeconds },
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
    metricProfile: "volvo-manager",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].vehicle, "V 697");
  assert.equal(rows[0].driver, "Test Driver");
  assert.equal(rows[0].totalTime, "3:00");
  assert.equal(rows[0].drivingKm, 32);
  assert.equal(rows[0].dieselEngineOnPercent, 37.5);
  assert.equal(rows[0].dieselEngineOnLitres, 40);
  assert.equal(rows[0].averageDieselEngineKmPerLitre, 0.8);
  assert.equal(rows[0].fuelLitres, 40);
  assert.equal(rows[0].standstillPercent, 33.33);
  assert.equal(rows[0].standstillTime, "1:00");
  assert.equal(rows[0].coastingPercent, 6.67);
  assert.equal(rows[0].engineLoadPercent, 16.67);
  assert.equal(rows[0].averageDieselLitresPerHour, 13.33);
  assert.equal(rows[0].iShiftPerformanceTimePercent, null);
  assert.equal(rows[0].aboveEconomyPercent, null);
});

test("groups driver changes into one exact row per Volvo vehicle", () => {
  const makeStatus = (at, driverId, values) => {
    const value = status(at, values);
    value.Driver1Id.OemDriverIdentification.OemDriverIdentification = driverId;
    return value;
  };
  const rows = buildDriverStandstillRows({
    vehicles: [{
      trackerId: "VIN-1",
      vehicleNumber: "V 590",
      siteName: "Sasti OCM",
    }],
    statuses: [
      makeStatus("2026-08-06T00:00:00Z", "DRIVER-A", {
        distanceMetres: 1_000_000,
        engineHours: 100,
        fuelMillilitres: 500_000,
        runningSeconds: 10_000,
        standstillSeconds: 4_000,
        coastingSeconds: 1_000,
        lowLoadSeconds: 4_000,
        highLoadSeconds: 1_000,
      }),
      makeStatus("2026-08-06T01:00:00Z", "DRIVER-A", {
        distanceMetres: 1_010_000,
        engineHours: 101,
        fuelMillilitres: 510_000,
        runningSeconds: 13_600,
        standstillSeconds: 4_000,
        coastingSeconds: 1_360,
        lowLoadSeconds: 4_900,
        highLoadSeconds: 1_900,
      }),
      makeStatus("2026-08-06T02:00:00Z", "DRIVER-B", {
        distanceMetres: 1_015_000,
        engineHours: 102,
        fuelMillilitres: 520_000,
        runningSeconds: 13_600,
        standstillSeconds: 7_600,
        coastingSeconds: 1_360,
        lowLoadSeconds: 5_800,
        highLoadSeconds: 2_800,
      }),
    ],
    shiftStart: "2026-08-06T00:00:00Z",
    shiftEnd: "2026-08-06T08:00:00Z",
    shiftName: "A",
    driverMap: new Map([
      ["DRIVER-A", "Driver A"],
      ["DRIVER-B", "Driver B"],
    ]),
    now: new Date("2026-08-06T08:00:00Z"),
    groupByVehicle: true,
    metricProfile: "volvo-manager",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].vehicle, "V 590");
  assert.equal(rows[0].driver, "Driver A, Driver B");
  assert.equal(rows[0].totalTime, "2:00");
  assert.equal(rows[0].drivingKm, 15);
  assert.equal(rows[0].fuelLitres, 20);
  assert.equal(rows[0].standstillPercent, 50);
});

test("accepts Scania RFMS wheelbased accumulated counter names", () => {
  const first = status("2026-07-31T23:00:00Z", {
    distanceMetres: 1_000_000,
    engineHours: 100,
    fuelMillilitres: 500_000,
    runningSeconds: 10_000,
    standstillSeconds: 4_000,
    coastingSeconds: 1_000,
    lowLoadSeconds: 4_000,
    highLoadSeconds: 1_000,
  });
  const second = status("2026-08-01T01:00:00Z", {
    distanceMetres: 1_020_000,
    engineHours: 102,
    fuelMillilitres: 530_000,
    runningSeconds: 13_600,
    standstillSeconds: 7_600,
    coastingSeconds: 1_360,
    lowLoadSeconds: 4_900,
    highLoadSeconds: 1_900,
  });
  for (const item of [first, second]) {
    item.AccumulatedData.DurationWheelbasedSpeedOverZero =
      item.AccumulatedData.DurationWheelbaseSpeedOverZero;
    item.AccumulatedData.DurationWheelbasedSpeedZero =
      item.AccumulatedData.DurationWheelbaseSpeedZero;
    delete item.AccumulatedData.DurationWheelbaseSpeedOverZero;
    delete item.AccumulatedData.DurationWheelbaseSpeedZero;
  }

  const rows = buildDriverStandstillRows({
    vehicles: [{ trackerId: "VIN-1", vehicleNumber: "SCANIA-1" }],
    statuses: [first, second],
    shiftStart: "2026-08-01T05:00:00+05:30",
    shiftEnd: "2026-08-01T13:00:00+05:30",
    shiftName: "A",
    driverMap: new Map(),
    now: new Date("2026-08-01T13:00:00+05:30"),
    metricProfile: "volvo-manager",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].standstillPercent, 50);
  assert.equal(rows[0].totalTime, "1:30");
});

test("prorates accumulated counters at exact shift boundaries", () => {
  const rows = buildDriverStandstillRows({
    vehicles: [{ trackerId: "VIN-1", vehicleNumber: "V-500", siteName: "Sasti" }],
    statuses: [
      status("2026-08-06T04:30:00Z", {
        distanceMetres: 1_000_000,
        engineHours: 100,
        fuelMillilitres: 500_000,
        runningSeconds: 10_000,
        standstillSeconds: 4_000,
        coastingSeconds: 1_000,
        lowLoadSeconds: 4_000,
        highLoadSeconds: 1_000,
      }),
      status("2026-08-06T05:30:00Z", {
        distanceMetres: 1_020_000,
        engineHours: 101,
        fuelMillilitres: 520_000,
        runningSeconds: 11_000,
        standstillSeconds: 4_200,
        coastingSeconds: 1_100,
        lowLoadSeconds: 4_600,
        highLoadSeconds: 1_200,
      }),
      status("2026-08-06T06:30:00Z", {
        distanceMetres: 1_040_000,
        engineHours: 102,
        fuelMillilitres: 540_000,
        runningSeconds: 12_000,
        standstillSeconds: 4_400,
        coastingSeconds: 1_200,
        lowLoadSeconds: 5_200,
        highLoadSeconds: 1_400,
      }),
    ],
    shiftStart: "2026-08-06T05:00:00Z",
    shiftEnd: "2026-08-06T06:00:00Z",
    shiftName: "A",
    driverMap: new Map(),
    now: new Date("2026-08-06T06:00:00Z"),
    metricProfile: "volvo-manager",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalTime, "1:00");
  assert.equal(rows[0].drivingKm, 20);
  assert.equal(rows[0].dieselEngineOnLitres, 20);
  assert.equal(rows[0].standstillTime, "0:03");
  assert.equal(rows[0].standstillPercent, 5.56);
  assert.equal(rows[0].coastingPercent, 2.78);
  assert.equal(rows[0].engineLoadPercent, 5.56);
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
