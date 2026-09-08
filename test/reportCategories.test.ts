import assert from "node:assert/strict";
import test from "node:test";
import {
  findReportItem,
  normalizeReportPath,
  reportCategories,
  summarizeReportStatuses,
} from "../src/config/reportCategories.ts";
import type { ReportView } from "../src/types/reportCategories.ts";
import { reportTypes } from "../src/types/reports.ts";

test("defines exactly the seven required report categories", () => {
  assert.equal(reportCategories.length, 7);
  assert.deepEqual(
    reportCategories.map((category) => category.name),
    [
      "Operations & Utilization",
      "Fuel & Efficiency",
      "Performance Analysis",
      "Site & Fleet",
      "Alerts & Tracker Health",
      "OEM Reports",
      "Management & Delivery",
    ],
  );
});

test("maps every existing report type exactly once as a primary report", () => {
  const primaryReportTypes = reportCategories
    .flatMap((category) => category.reports)
    .filter((report) => !report.isShortcut)
    .map((report) => report.reportType)
    .sort();

  assert.deepEqual(primaryReportTypes, [...reportTypes].sort());
  assert.equal(new Set(primaryReportTypes).size, reportTypes.length);
});

test("redirects shortcuts and legacy report URLs to their canonical routes", () => {
  assert.equal(
    normalizeReportPath("/reports/performance-analysis/vehicle-efficiency"),
    "/reports/fuel-efficiency/vehicle-efficiency",
  );
  assert.equal(
    normalizeReportPath("/reports/daily-fuel-consumption"),
    "/reports/fuel-efficiency/daily",
  );
  assert.equal(normalizeReportPath("/reports/eicher/"), "/reports/oem/eicher");
  assert.equal(normalizeReportPath("/reports/case/"), "/reports/oem/case");
  assert.equal(findReportItem("/reports/idle-time")?.reportType, "Idle Time Report");
});

test("calculates category status totals from child report state", () => {
  const item = reportCategories[0].reports[0];
  const makeView = (status: ReportView["status"]): ReportView => ({
    item,
    source: null,
    status,
    generatedAt: null,
    exportFormats: [],
  });

  assert.deepEqual(
    summarizeReportStatuses([
      makeView("ready"),
      makeView("ready"),
      makeView("queued"),
      makeView("processing"),
      makeView("failed"),
      makeView("not_generated"),
    ]),
    { ready: 2, queued: 1, processing: 1, failed: 1, not_generated: 1 },
  );
});
