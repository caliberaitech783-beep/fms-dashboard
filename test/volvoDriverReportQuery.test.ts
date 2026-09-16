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

test("forwards a manually selected full-day period exactly", () => {
  const query = buildVolvoDriverReportQuery(reportFilters({ timePeriodMode: "custom" }));

  assert.equal(query.get("startTime"), "2026-08-13T00:00:00+05:30");
  assert.equal(query.get("stopTime"), "2026-08-13T23:59:00+05:30");
});

test("forwards the All Day shift as an exact full-day period", () => {
  const query = buildVolvoDriverReportQuery(reportFilters({ shift: "ALL_DAY" }));

  assert.equal(query.get("shift"), "A");
  assert.equal(query.get("startTime"), "2026-08-13T00:00:00+05:30");
  assert.equal(query.get("stopTime"), "2026-08-13T23:59:00+05:30");
});

test("forwards an overnight scheduled period with the next end date", () => {
  const query = buildVolvoDriverReportQuery(reportFilters({
    dateTo: "2026-08-14",
    timeFrom: "21:00",
    timeTo: "05:00",
    shift: "C",
    timePeriodMode: "schedule",
  }));

  assert.equal(query.get("date"), "2026-08-13");
  assert.equal(query.get("startTime"), "2026-08-13T21:00:00+05:30");
  assert.equal(query.get("stopTime"), "2026-08-14T05:00:00+05:30");
});

test("active shift ends at generation time rather than its future scheduled end", () => {
  const query = buildVolvoDriverReportQuery(reportFilters({ dateFrom: "2026-09-16", dateTo: "2026-09-16", shift: "B", timeFrom: "13:00", timeTo: "21:00", timePeriodMode: "schedule" }), new Date("2026-09-16T16:10:23+05:30"));
  assert.equal(query.get("startTime"), "2026-09-16T13:00:00+05:30");
  assert.equal(query.get("stopTime"), "2026-09-16T10:40:23.000Z");
});

test("default active shift resolves its start before capping the end", () => {
  const query = buildVolvoDriverReportQuery(reportFilters({ dateFrom: "2026-09-16", dateTo: "2026-09-16", shift: "B" }), new Date("2026-09-16T16:10:00+05:30"));
  assert.equal(query.get("startTime"), "2026-09-16T13:00:00+05:30");
  assert.equal(query.get("stopTime"), "2026-09-16T10:40:00.000Z");
});

test("overnight shift caps on the following day and refresh advances the cutoff", () => {
  const filters = reportFilters({ dateFrom: "2026-09-16", dateTo: "2026-09-17", shift: "C", timeFrom: "21:00", timeTo: "05:00", timePeriodMode: "schedule" });
  const first = buildVolvoDriverReportQuery(filters, new Date("2026-09-17T02:00:00+05:30"));
  const next = buildVolvoDriverReportQuery(filters, new Date("2026-09-17T02:05:00+05:30"));
  assert.equal(first.get("startTime"), "2026-09-16T21:00:00+05:30");
  assert.equal(first.get("stopTime"), "2026-09-16T20:30:00.000Z");
  assert.equal(next.get("stopTime"), "2026-09-16T20:35:00.000Z");
});

test("completed and future shifts preserve their scheduled periods", () => {
  const filters = reportFilters({ timeFrom: "05:00", timeTo: "13:00", timePeriodMode: "schedule" });
  for (const now of ["2026-08-13T16:00:00+05:30", "2026-08-12T16:00:00+05:30"]) {
    const query = buildVolvoDriverReportQuery(filters, new Date(now));
    assert.equal(query.get("stopTime"), "2026-08-13T13:00:00+05:30");
  }
});
