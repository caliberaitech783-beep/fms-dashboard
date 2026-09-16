import assert from "node:assert/strict";
import test from "node:test";
import { selectedShiftPeriods, reportTelemetry } from "../src/utils/dashboardPeriods.ts";
import { filterVehicles } from "../src/utils/filters.ts";
import { applyFleetFilterChange } from "../src/utils/filterState.ts";
import type { DashboardFilters, Vehicle, FleetTelemetryRecord } from "../src/types/fleet.ts";
import type { ReportPreview } from "../src/types/reports.ts";
const filters = { dateFrom: "2026-09-16", dateTo: "2026-09-16", timeFrom: "00:00", timeTo: "23:59", timePeriodMode: "schedule", shift: "All", siteId: "site-wcl-sasti-ocm", region: "WCL", company: "All", assetCategory: "All", assetType: "All", contractType: "All", modelNumber: "All", status: "All", vehicleNumber: "", lead: "All" } as DashboardFilters;
const now = new Date("2026-09-18T12:00:00+05:30");
test("All Shifts includes each operational shift once, including overnight C", () => {
  const periods = selectedShiftPeriods(filters, now);
  assert.deepEqual(periods.map(p => p.shift), ["A", "B", "C"]);
  assert.deepEqual(periods.map(p => [p.timeFrom, p.timeTo]), [["05:00","13:00"],["13:00","21:00"],["21:00","05:00"]]);
  assert.equal(periods[2].dateTo, "2026-09-17");
  assert.equal(selectedShiftPeriods({ ...filters, shift: "C", timeFrom: "21:00", timeTo: "05:00", dateTo: "2026-09-17" }, now).length, 1);
});
test("region All sites excludes other regions and switching region clears site selection", () => {
  const vehicles = [{ id: "w", siteId: "site-wcl-sasti-ocm", vehicleNumber: "W1" },{ id: "n", siteId: "site-ncl-dch-west", vehicleNumber: "N1" }] as Vehicle[];
  assert.deepEqual(filterVehicles(vehicles, {...filters,siteId:"All"}).map(v=>v.id), ["w"]);
  const next = applyFleetFilterChange(filters,"region","NCL");
  assert.equal(next.siteId,"All");
  assert.deepEqual(filterVehicles(vehicles,next).map(v=>v.id), ["n"]);
});
test("periods respect site schedules, current cutoff and custom overnight intersections", () => {
  assert.equal(selectedShiftPeriods({...filters,siteId:"site-wcl-majri-ocm",shift:"A"},now)[0].timeFrom,"04:00");
  assert.deepEqual(selectedShiftPeriods(filters,new Date("2026-09-16T16:00:00+05:30")).map(p=>p.shift),["A","B"]);
  const custom = selectedShiftPeriods({...filters,timePeriodMode:"custom",timeFrom:"01:00",timeTo:"03:00"},now);
  assert.equal(custom.length,1); assert.equal(custom[0].shift,"C"); assert.equal(custom[0].timeFrom,"01:00");
});
test("report period fuel replaces cumulative counters, keeps unavailable values null", () => {
  const vehicle = {id:"v",vehicleNumber:"V 605",trackerId:"vin",company:"Volvo"} as Vehicle;
  const snapshot = {id:"snapshot",vehicleId:"v",fuelConsumedLitres:980161,engineHours:9000,rawMetrics:{}} as FleetTelemetryRecord;
  const preview = {period:{date:"2026-09-16",shift:"B",start:"2026-09-16T13:00:00+05:30",end:"2026-09-16T18:15:00+05:30"},rows:[{Vehicles:"V-605","Diesel engine on (l)":88.56,"Driving (km)":53.19,"Total time (hh:mm)":"3:39","Standstill (hh:mm)":"0:47","Standstill (%)":21.37,"Avg diesel (l/h)":24.28}]} as unknown as ReportPreview;
  const [row] = reportTelemetry(preview,[vehicle],[snapshot]);
  assert.equal(row.fuelConsumedLitres,88.56); assert.equal(row.engineHours,3.65); assert.equal(row.idlePercentage,21.37); assert.equal(row.rawMetrics.averageDiesel,24.28);
  assert.ok(Math.abs(row.truckEfficiencyKmPerLitre! - 53.19/88.56)<0.00001);
  assert.equal(reportTelemetry({...preview,rows:[{Vehicles:"V-605"}]},[vehicle],[snapshot])[0].fuelConsumedLitres,null);
});
