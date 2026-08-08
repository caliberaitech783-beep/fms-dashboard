import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardFilters, FleetTelemetryRecord, Vehicle } from "../src/types/fleet.ts";
import { filterTelemetryRecords, isLiveOemSource } from "../src/utils/filters.ts";

const filters = {
  dateFrom: "2026-06-01",
  dateTo: "2026-06-30",
  timeFrom: "00:00",
  timeTo: "23:59",
  siteId: "All",
  contractType: "All",
  assetCategory: "All",
  assetType: "All",
  company: "All",
  modelNumber: "All",
  status: "All",
  vehicleNumber: "",
  shift: "All",
  lead: "All",
} as DashboardFilters;

const vehicles = [
  { id: "volvo-1", vehicleNumber: "V1" },
  { id: "scania-1", vehicleNumber: "S1" },
  { id: "mock-1", vehicleNumber: "M1" },
] as Vehicle[];

const records = [
  { id: "volvo-record", vehicleId: "volvo-1", source: "VOLVO_RFMS_LIVE", timestamp: "2026-08-01T06:00:00.000Z", shift: "A" },
  { id: "scania-record", vehicleId: "scania-1", source: "SCANIA_RFMS_LIVE", timestamp: "2026-08-01T06:00:00.000Z", shift: "A" },
  { id: "mock-record", vehicleId: "mock-1", source: "MOCK", timestamp: "2026-08-01T06:00:00.000Z", shift: "A" },
] as FleetTelemetryRecord[];

test("recognizes each connected OEM as a live source", () => {
  assert.equal(isLiveOemSource("VOLVO_RFMS_LIVE"), true);
  assert.equal(isLiveOemSource("SCANIA_RFMS_LIVE"), true);
  assert.equal(isLiveOemSource("EICHER_VECV_LIVE"), true);
  assert.equal(isLiveOemSource("CASE_EQUIPMENT_LIVE"), true);
  assert.equal(isLiveOemSource("MOCK"), false);
});

test("keeps live Volvo and Scania snapshots outside the historical demo date range", () => {
  const filtered = filterTelemetryRecords(records, vehicles, filters);
  assert.deepEqual(filtered.map((record) => record.id), ["volvo-record", "scania-record"]);
});

test("applies the selected start and end times to historical telemetry", () => {
  const timeFilters: DashboardFilters = {
    ...filters,
    dateFrom: "2026-06-10",
    dateTo: "2026-06-10",
    timeFrom: "09:00",
    timeTo: "10:00",
  };
  const historicalRecords = [
    { id: "before-window", vehicleId: "mock-1", source: "MOCK", timestamp: "2026-06-10T08:59:00", shift: "A" },
    { id: "inside-window", vehicleId: "mock-1", source: "MOCK", timestamp: "2026-06-10T09:30:00", shift: "A" },
    { id: "after-window", vehicleId: "mock-1", source: "MOCK", timestamp: "2026-06-10T10:01:00", shift: "A" },
  ] as FleetTelemetryRecord[];

  const filtered = filterTelemetryRecords(historicalRecords, vehicles, timeFilters);
  assert.deepEqual(filtered.map((record) => record.id), ["inside-window"]);
});
