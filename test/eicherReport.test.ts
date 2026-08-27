import assert from "node:assert/strict";
import test from "node:test";
import { buildEicherReportRow, EICHER_REPORT_COLUMNS } from "../src/utils/eicherReport.ts";
import type { FleetTelemetryRecord, Vehicle } from "../src/types/fleet.ts";

const vehicle = {
  id: "eicher-MC2DALRC0PJ006329",
  vehicleNumber: "MC2DALRC0PJ006329",
  source: "EICHER_VECV_LIVE",
  assetCategory: "Truck",
  assetType: "Tipper",
  company: "Eicher",
  modelNumber: null,
  capacityM3: null,
  fuelMeasurementUnit: "km/L",
  trackerProvider: "Eicher VECV",
  trackerId: "MC2DALRC0PJ006329",
  siteId: null,
  contractType: null,
  status: "stopped",
  commissioningDate: null,
  fuelTankCapacityLitres: null,
  standardFuelNorm: null,
  active: true,
} satisfies Vehicle;

const telemetry = {
  vehicleId: vehicle.id,
  status: "stopped",
  odometerKm: 242876,
  fuelConsumedLitres: 195873,
  fuelLevelPercent: 81.6,
  fuelLevelLitres: 257.04,
  engineHours: 14876,
  rawMetrics: {
    registrationNumber: null,
    chassisNumber: "MC2DALRC0PJ006329",
    latitude: 20.1132,
    longitude: 79.02415,
    fuelType: "Diesel",
    vehicleStatus: "STOPPED",
    sourceLastUpdated: 20260827121841,
    sourceEpochTime: 1787813321,
    speedKph: 0,
    odometerKm: 242876,
    fuelLevelPercent: 81.6,
    fuelLevelLitres: 257.04,
    defLevelLitres: 47.8,
    fuelConsumedLitres: 195873,
    engineHours: 14876,
  },
} as FleetTelemetryRecord;

test("uses exactly the supplied Eicher vehicle parameters in their supplied order", () => {
  assert.deepEqual(EICHER_REPORT_COLUMNS, [
    "regNo",
    "chassisNo",
    "latitude",
    "longitude",
    "fuelType",
    "vehicleStatus",
    "lastUpdated",
    "epochTime",
    "vehicleSpeed",
    "odometer",
    "fuelLevelInPer",
    "fuelLevelInLtr",
    "defLevelInLtr",
    "lifeTimeFuelConsumtion",
    "engineOperatingHours",
  ]);
});

test("maps the supplied VECV fuel payload without losing zero or blank values", () => {
  assert.deepEqual(buildEicherReportRow(vehicle, telemetry), {
    regNo: null,
    chassisNo: "MC2DALRC0PJ006329",
    latitude: 20.1132,
    longitude: 79.02415,
    fuelType: "Diesel",
    vehicleStatus: "STOPPED",
    lastUpdated: 20260827121841,
    epochTime: 1787813321,
    vehicleSpeed: 0,
    odometer: 242876,
    fuelLevelInPer: 81.6,
    fuelLevelInLtr: 257.04,
    defLevelInLtr: 47.8,
    lifeTimeFuelConsumtion: 195873,
    engineOperatingHours: 14876,
  });
});
