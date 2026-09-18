const assert = require("node:assert/strict");
const { test } = require("node:test");
const { fleet, vehicles, normalizeDaily, summarize, report, rowsFrom } = require("../src/lib/liugong/service");
test("LiuGong registry contains exactly the requested 26 trucks and 2 excavators", () => {
  const rows = vehicles();
  assert.equal(new Set(rows.map(r => r.trackerId)).size, 28);
  assert.equal(rows.filter(r => r.assetCategory === "Truck").length, 26);
  assert.equal(rows.filter(r => r.siteId === "site-wcl-sasti-ocm").length, 16);
  assert.equal(rows.filter(r => r.siteId === "site-wcl-gauri-pauni").length, 12);
  assert.deepEqual(fleet.filter(r => r.productGroup === "Excavator").map(r => r.model), ["965EHD", "975E"]);
});
test("uses daily measurements rather than cumulative counters and keeps missing distinct from zero", () => {
  const row = normalizeDaily({ static: { dateFormate: "2026-09-17", workingHours: 4, jobHours: 3,
    idleTime: 1, oilConsumes: 80, cumulativeOilConsumption: 9000, cumulativeWorkingHours: 700 } });
  assert.equal(summarize([row]).fuelRate, 20);
  assert.equal(summarize([row]).idlePercent, 25);
  assert.equal(summarize([row]).workPercent, 75);
  assert.equal(normalizeDaily({ static: { dateFormate: "2026-09-17", oilConsumes: null } }).fuelLitres, null);
  assert.equal(normalizeDaily({ static: { dateFormate: "2026-09-17", oilConsumes: 0 } }).fuelLitres, 0);
  assert.equal(summarize([]).fuelLitres, null);
});
test("reports retain all machines and select only the requested dates", async () => {
  const daily = normalizeDaily({ static: { dateFormate: "2026-09-17", workingHours: 4, oilConsumes: 80 } });
  const storage = { loadSnapshot: async sn => sn === fleet[0].serialNumber ? { fetchedAt: "2026-09-18T00:00:00Z", payload: { rows: [daily, { ...daily, date: "2026-09-16" }] } } : null };
  const result = await report("2026-09-17", "2026-09-17", storage);
  assert.equal(result.rows.length, 28);
  assert.equal(result.rows[0].fuelLitres, 80);
  assert.equal(result.rows[0].daysReported, 1);
  assert.equal(result.rows[1].fuelLitres, null);
  assert.equal(result.rows[1].daysReported, 0);
  assert.deepEqual(rowsFrom({ data: { data: [daily] } }), [daily]);
});
test("does not calculate a rate from mismatched daily input coverage", () => {
  const a = normalizeDaily({ static: { dateFormate: "2026-09-17", workingHours: 4, oilConsumes: 80 } });
  const b = normalizeDaily({ static: { dateFormate: "2026-09-18", workingHours: 4 } });
  assert.equal(summarize([a,b]).fuelRate, null);
});
