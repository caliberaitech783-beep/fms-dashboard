import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardFilters } from "../src/types/fleet.ts";
import { applyFleetFilterChange, applyFleetTimePeriod } from "../src/utils/filterState.ts";

const selectedVolvoFilters: DashboardFilters = {
  dateFrom: "2026-06-01",
  dateTo: "2026-06-30",
  timeFrom: "00:00",
  timeTo: "23:59",
  shift: "All",
  siteId: "site-wcl-gauri-pauni",
  contractType: "Coal",
  assetCategory: "Truck",
  assetType: "Dumper",
  company: "Volvo",
  modelNumber: "A45G",
  vehicleNumber: "",
  status: "All",
  lead: "All",
};

test("keeps the selected OEM when the site changes", () => {
  const next = applyFleetFilterChange(selectedVolvoFilters, "siteId", "site-ncl-dudhichua-east");

  assert.equal(next.siteId, "site-ncl-dudhichua-east");
  assert.equal(next.company, "Volvo");
  assert.equal(next.modelNumber, "All");
  assert.equal(next.contractType, "All");
  assert.equal(next.assetCategory, "All");
  assert.equal(next.assetType, "All");
});

test("still resets the model when the OEM is changed manually", () => {
  const next = applyFleetFilterChange(selectedVolvoFilters, "company", "Scania");

  assert.equal(next.company, "Scania");
  assert.equal(next.modelNumber, "All");
});

test("selecting a shift applies the configured period for the selected site", () => {
  const filters = {
    ...selectedVolvoFilters,
    dateFrom: "2026-08-14",
    dateTo: "2026-08-14",
    siteId: "site-wcl-majri-ocm",
  };

  const shiftA = applyFleetFilterChange(filters, "shift", "A");
  assert.deepEqual(
    { dateFrom: shiftA.dateFrom, dateTo: shiftA.dateTo, timeFrom: shiftA.timeFrom, timeTo: shiftA.timeTo },
    { dateFrom: "2026-08-14", dateTo: "2026-08-14", timeFrom: "04:00", timeTo: "12:00" },
  );
  assert.equal(shiftA.timePeriodMode, "schedule");

  const shiftC = applyFleetFilterChange(shiftA, "shift", "C");
  assert.deepEqual(
    { dateFrom: shiftC.dateFrom, dateTo: shiftC.dateTo, timeFrom: shiftC.timeFrom, timeTo: shiftC.timeTo },
    { dateFrom: "2026-08-14", dateTo: "2026-08-15", timeFrom: "20:00", timeTo: "04:00" },
  );
});

test("changing sites reapplies the selected shift schedule", () => {
  const majriShiftA = applyFleetFilterChange({
    ...selectedVolvoFilters,
    dateFrom: "2026-08-14",
    dateTo: "2026-08-14",
    siteId: "site-wcl-majri-ocm",
  }, "shift", "A");
  const dchShiftA = applyFleetFilterChange(majriShiftA, "siteId", "site-ncl-dch-east");

  assert.equal(dchShiftA.timeFrom, "05:00");
  assert.equal(dchShiftA.timeTo, "13:00");
});

test("manually applying a period marks it as an exact custom range", () => {
  const custom = applyFleetTimePeriod(selectedVolvoFilters, {
    dateFrom: "2026-08-14",
    dateTo: "2026-08-14",
    timeFrom: "00:00",
    timeTo: "23:59",
  });

  assert.equal(custom.timePeriodMode, "custom");
});
