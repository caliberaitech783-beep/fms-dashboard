import { prepareScaniaStandstill, ADJUSTED_IDLING } from "./scaniaStandstill.ts";
import type { DashboardFilters, FleetTelemetryRecord, Vehicle } from "../types/fleet";
import type { ReportPreview } from "../types/reports";
import { getOperationalShiftPeriod } from "./shiftResolver.ts";

export function selectedShiftPeriods(filters: DashboardFilters, now = new Date()): DashboardFilters[] {
  const first = Date.parse(`${filters.dateFrom}T00:00:00+05:30`);
  let last = Date.parse(`${filters.dateTo}T00:00:00+05:30`);
  if (filters.timePeriodMode === "schedule" && filters.shift === "C" && filters.dateTo > filters.dateFrom) last -= 86400000;
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [];
  if ((last - first) / 86400000 > 30) throw new Error("Select up to 31 days for shift-based dashboard data.");
  const periods: DashboardFilters[] = [];
  const shifts = filters.shift === "All" || filters.shift === "ALL_DAY" ? ["A", "B", "C"] as const : [filters.shift];
  for (let day = filters.timePeriodMode === "custom" ? first - 86400000 : first; day <= last; day += 86400000) {
    const date = new Date(day + 19800000).toISOString().slice(0, 10);
    for (const shift of shifts) {
      const period = getOperationalShiftPeriod(filters.siteId, date, shift);
      if (!period) continue;
      let start = Date.parse(`${period.dateFrom}T${period.timeFrom}:00+05:30`);
      let end = Date.parse(`${period.dateTo}T${period.timeTo}:00+05:30`);
      if (filters.timePeriodMode === "custom") {
        start = Math.max(start, Date.parse(`${filters.dateFrom}T${filters.timeFrom}:00+05:30`));
        end = Math.min(end, Date.parse(`${filters.dateTo}T${filters.timeTo}:00+05:30`));
      }
      if (start >= end || start >= now.getTime()) continue;
      const local = (value: number) => new Date(value + 19800000).toISOString();
      periods.push({ ...filters, ...period, shift, timePeriodMode: "custom", dateFrom: local(start).slice(0, 10), timeFrom: local(start).slice(11, 16), dateTo: local(end).slice(0, 10), timeTo: local(end).slice(11, 16) });
    }
  }
  return periods;
}

const identifier = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
function hours(value: unknown): number | null {
  const match = String(value ?? "").match(/^(\d+):(\d{2})$/);
  return match ? Number(match[1]) + Number(match[2]) / 60 : null;
}

/** Convert period totals, never the live vehicle's lifetime counters. */
export function reportTelemetry(preview: ReportPreview, vehicles: Vehicle[], templates: FleetTelemetryRecord[]): FleetTelemetryRecord[] {
  if (preview.error || !preview.period) return [];
  const scania = preview.oem === "Scania";
  if (scania) preview = prepareScaniaStandstill(preview);
  return preview.rows.flatMap((row, index) => {
    const id = identifier(row[scania ? "Registration number" : "Vehicles"]);
    const vehicle = vehicles.find((v) => identifier(v.vehicleNumber) === id || identifier(v.trackerId) === id);
    const template = templates.find((record) => record.vehicleId === vehicle?.id);
    if (!vehicle || !template) return [];
    const fuel = number(row[scania ? "Consumption liquid fuel (litres)" : "Diesel engine on (l)"]);
    const distance = number(row[scania ? "Distance driven (km)" : "Driving (km)"]);
    const engine = hours(row[scania ? "Engine running time (h:m)" : "Total time (hh:mm)"]);
    const idle = hours(row[scania ? "Idling (h:m)" : "Standstill (hh:mm)"]);
    return [{ ...template, id: `period-${template.id}-${preview.period!.start}-${index}`, timestamp: preview.period!.end, date: preview.period!.date,
      shift: preview.period!.shift as FleetTelemetryRecord["shift"], fuelConsumedLitres: fuel, distanceKm: distance, engineHours: engine,
      runningHours: engine, idleHours: idle, stoppedHours: null, offlineHours: null, availableHours: null,
      fuelFilledLitres: null, trips: null, productionM3: null,
      truckEfficiencyKmPerLitre: fuel !== null && fuel > 0 && distance !== null ? distance / fuel : null,
      hemmFuelRateLitrePerHour: null,
      idlePercentage: number(row[scania ? "Idling (% of engine running time)" : "Standstill (%)"]),
      rawMetrics: { periodData: true, ...(scania ? { adjustedIdling: number(row[ADJUSTED_IDLING]) } : {}), averageDiesel: number(row[scania ? "Consumption liquid fuel (litres/h)" : "Avg diesel (l/h)"]) },
    }];
  });
}
