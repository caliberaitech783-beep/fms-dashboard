const assert = require("node:assert/strict");
const { test } = require("node:test");
const { findFrozenDriverReport } = require("../src/lib/volvo/frozenDriverReports");

const fullDayWindow = {
  customTimeRange: true,
  shiftStart: "2026-08-17T18:30:00.000Z",
  shiftEnd: "2026-08-18T18:29:00.000Z",
};

test("returns the exact completed Sasti all-day report for 18 August 2026", () => {
  const report = findFrozenDriverReport({
    date: "2026-08-18",
    site: "WCL / Sasti OCM",
    window: fullDayWindow,
  });

  assert.ok(report);
  assert.equal(report.rows.length, 9);
  assert.equal(report.summary["Total time (hh:mm)"], "141:48");
  assert.equal(report.summary["Driving (km)"], 1262.88);
  assert.equal(report.summary["Diesel engine on (l)"], 2641.64);
  assert.equal(report.summary["Standstill (%)"], 21.30);
  assert.equal(report.summary["Standstill (hh:mm)"], "30:12");
  assert.equal(report.summary["Engine load % time of Total time (%)"], 2.39);
  assert.equal(report.summary["Coasting (%)"], 4.95);
  assert.equal(report.summary["Avg diesel (l/h)"], 18.63);
  assert.deepEqual(
    report.rows.map((row) => row.Vehicles),
    ["V-604", "V 503", "V-606", "V-603", "V 502", "V 590", "V-500", "V-501", "V-605"],
  );
});

test("does not apply the frozen report to another site, date, or partial day", () => {
  assert.equal(findFrozenDriverReport({
    date: "2026-08-18",
    site: "Majri",
    window: fullDayWindow,
  }), null);
  assert.equal(findFrozenDriverReport({
    date: "2026-08-19",
    site: "Sasti",
    window: fullDayWindow,
  }), null);
  assert.equal(findFrozenDriverReport({
    date: "2026-08-18",
    site: "Sasti",
    window: { ...fullDayWindow, shiftEnd: "2026-08-18T07:30:00.000Z" },
  }), null);
});

test("returns a fresh copy so a frozen report cannot be changed by a caller", () => {
  const input = { date: "2026-08-18", site: "Sasti", window: fullDayWindow };
  const first = findFrozenDriverReport(input);
  first.rows[0]["Driving (km)"] = 0;
  first.summary["Driving (km)"] = 0;

  const second = findFrozenDriverReport(input);
  assert.equal(second.rows[0]["Driving (km)"], 138.04);
  assert.equal(second.summary["Driving (km)"], 1262.88);
});
