import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardFilters } from "../src/types/fleet.ts";
import { applyFleetFilterChange } from "../src/utils/filterState.ts";

const selectedVolvoFilters: DashboardFilters = {
  dateFrom: "2026-06-01",
  dateTo: "2026-06-30",
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
