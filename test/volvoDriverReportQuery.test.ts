import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardFilters } from "../src/types/fleet.ts";
import { buildVolvoDriverReportQuery } from "../src/utils/volvoDriverReportQuery.ts";

function reportFilters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return {
    dateFrom: "2026-08-13",
    dateTo: "2026-08-13",
    timeFrom: "00:00",
    timeTo: "23:59",
    shift: "A",
    siteId: "site-ncl-dch-east",
    contractType: "All",
    assetCategory: "All",
    assetType: "All",
    company: "Volvo",
    modelNumber: "",
    vehicleNumber: "",
    status: "All",
    lead: "All",
    ...overrides,
  };
}

test("forwards the exact DCH East custom report period", () => {
  const query = buildVolvoDriverReportQuery(reportFilters({
    timeFrom: "05:10",
    timeTo: "10:30",
  }));

  assert.equal(query.get("date"), "2026-08-13");
  assert.equal(query.get("shift"), "A");
  assert.equal(query.get("site"), "site-ncl-dch-east");
  assert.equal(query.get("startTime"), "2026-08-13T05:10:00+05:30");
  assert.equal(query.get("stopTime"), "2026-08-13T10:30:00+05:30");
});

test("uses the configured shift window for the default all-day filter period", () => {
  const query = buildVolvoDriverReportQuery(reportFilters());

  assert.equal(query.has("startTime"), false);
  assert.equal(query.has("stopTime"), false);
});
