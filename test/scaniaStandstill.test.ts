import test from "node:test";
import assert from "node:assert/strict";
import { prepareScaniaStandstill, scaniaExportRows, ADJUSTED_IDLING } from "../src/utils/scaniaStandstill.ts";
import type { ReportPreview } from "../src/types/reports.ts";

function preview(): ReportPreview {
  return { reportType: "Driverwise Standstill Tracking", oem: "Scania", generatedAt: "2026-09-16T09:30:00Z", columns: ["Registration number"], rows: [
    { "Registration number": "S 1", "Engine running time (h:m)": "1:00", "Distance driven (km)": 20, "Consumption liquid fuel (litres)": 10, "Consumption liquid fuel (litres/h)": 10, "Idling (% of engine running time)": 40, "Idling (h:m)": "0:24", "Powertrain coasting (% of distance)": 10 },
    { "Registration number": "S 2", "Engine running time (h:m)": "2:00", "Distance driven (km)": 60, "Consumption liquid fuel (litres)": 60, "Consumption liquid fuel (litres/h)": 30, "Idling (% of engine running time)": 40, "Idling (h:m)": "0:48", "Powertrain coasting (% of distance)": 30 },
    { "Registration number": "S 3", "Engine running time (h:m)": "0:10", "Distance driven (km)": 0, "Consumption liquid fuel (litres)": 0, "Consumption liquid fuel (litres/h)": null, "Idling (% of engine running time)": null, "Idling (h:m)": null },
  ] };
}
test("matches the established Scania fleet-normalized formula without inventing missing data", () => {
  const result = prepareScaniaStandstill(preview());
  assert.deepEqual(result.rows.map(row => row[ADJUSTED_IDLING]), [20, 40, null]);
  assert.equal(result.columns.at(-1), ADJUSTED_IDLING);
  assert.ok(!result.columns.some(column => column.startsWith("Performance mode")));
  assert.equal(result.rows.length, 3);
  assert.equal(result.summary?.[ADJUSTED_IDLING], 30);
  assert.equal(result.summary?.["Consumption liquid fuel (km/l)"], 1.14);
  assert.equal(result.summary?.["Powertrain coasting (% of distance)"], 25);
  assert.equal(result.summary?.["Idling (% of engine running time)"], 40);
  assert.equal(result.summary?.["Engine running time (h:m)"], "3:10");
  assert.equal(result.summary?.["Idling (h:m)"], "1:12");
  assert.equal(scaniaExportRows(result)[0]["Registration number"], "Summary (3)");
  assert.deepEqual(prepareScaniaStandstill(result), result);
});
test("uses the reference 20 L/h fallback, excludes exactly 15 km from the baseline and caps the adjustment", () => {
  const p = preview();
  p.rows = [{ "Registration number": "S 1", "Distance driven (km)": 15, "Consumption liquid fuel (litres/h)": 10, "Idling (% of engine running time)": 40 },
    { "Registration number": "S 2", "Distance driven (km)": 0, "Consumption liquid fuel (litres/h)": 30, "Idling (% of engine running time)": 40 }];
  assert.deepEqual(prepareScaniaStandstill(p).rows.map(row => row[ADJUSTED_IDLING]), [20, 40]);
});
test("preserves Volvo reports and missing Scania values", () => {
  const p = preview(); p.oem = "Volvo"; p.columns = ["Vehicles"];
  assert.equal(prepareScaniaStandstill(p), p);
  const missing = preview(); missing.rows = [{ "Registration number": "S 4" }];
  const result = prepareScaniaStandstill(missing);
  assert.equal(result.summary?.["Consumption liquid fuel (litres)"], null);
  assert.equal(result.summary?.[ADJUSTED_IDLING], null);
});
