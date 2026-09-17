const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateScaniaStatusReport } = require("../src/lib/scania/scaniaStatusReport");

const input = { site: "Sasti OCM", shift: "A", exactPeriod: true,
  startTime: "2026-09-17T05:00:00+05:30", stopTime: "2026-09-17T13:00:00+05:30" };
function status(time, hours, extra = {}) {
  return { vin: "VIN1", createdDateTime: `2026-09-17T${time}:00+05:30`,
    totalEngineHours: hours, hrTotalVehicleDistance: hours * 10000,
    engineTotalFuelUsed: hours * 20000,
    accumulatedData: { durationWheelbasedSpeedZero: hours * 900 }, ...extra };
}
async function report(records, overrides = {}) {
  return generateScaniaStatusReport(input, {
    now: new Date("2026-09-17T11:07:00+05:30"),
    importedVehicles: [{ vin: "VIN1", vehicleNumber: "S47", siteName: "Sasti OCM" }],
    client: { async getVehicleStatuses(query) {
      assert.equal(query.latestOnly, false);
      assert.equal(query.startTime, "2026-09-16T23:30:00.000Z");
      assert.equal(query.stopTime, "2026-09-17T05:37:00.000Z");
      return { records, status: 200 };
    } }, ...overrides,
  });
}
test("uses only shift counter deltas and caps ongoing period at generation time", async () => {
  const result = await report([status("04:00", 90), status("05:00", 100),
    status("11:00", 105), status("12:00", 106)]);
  assert.equal(result.rows[0].engineRunningTime, "5:00");
  assert.equal(result.rows[0].fuelConsumedLitres, 100);
  assert.equal(result.rows[0].distanceDrivenKm, 50);
  assert.equal(result.rows[0].idlingPercentage, 25);
  assert.equal(result.period.end, "2026-09-17T05:37:00.000Z");
  assert.equal(result.meta.periodCalculationVersion, 2);
});
test("rejects nine hours of engine runtime in a six-hour window", async () => {
  const result = await report([status("05:00", 100), status("11:00", 109)]);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.meta.rejectedVehicles, ["S47"]);
});
test("does not include vehicles without matching site assignments", async () => {
  const result = await report([status("05:00", 100), status("11:00", 105)], { importedVehicles: [] });
  assert.equal(result.rows.length, 0);
  assert.match(result.notice, /assignments are unavailable/);
});
test("deduplicates timestamps and excludes pre-shift readings without inventing boundary activity", async () => {
  const result = await report([status("04:00", 99), status("06:00", 101),
    status("06:00", 101), status("11:00", 105)]);
  assert.equal(result.rows[0].engineRunningTime, "4:00");
  assert.equal(result.rows[0].coverageStart, "2026-09-17T00:30:00.000Z");
});
test("counter resets are rejected and absent fuel or idle is not converted to zero", async () => {
  assert.equal((await report([status("05:00", 100), status("11:00", 99)])).rows.length, 0);
  const result = await report([status("05:00", 100), status("11:00", 105,
    { engineTotalFuelUsed: null, accumulatedData: {} })]);
  assert.equal(result.rows[0].fuelConsumedLitres, null);
  assert.equal(result.rows[0].idlingPercentage, null);
});
