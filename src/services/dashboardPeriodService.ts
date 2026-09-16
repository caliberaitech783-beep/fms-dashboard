import type { DashboardFilters, FleetTelemetryRecord, Vehicle } from "../types/fleet";
import { isLiveOemSource } from "../utils/filters";
import { reportTelemetry, selectedShiftPeriods } from "../utils/dashboardPeriods";
import { fetchVolvoDriverStandstillReport } from "./volvoDriverReportService";
import { fetchScaniaDriverStandstillReport } from "./scaniaReportService";

export async function dashboardPeriodRecords(filters: DashboardFilters, vehicles: Vehicle[], snapshots: FleetTelemetryRecord[], filteredRecords: FleetTelemetryRecord[], onProgress?: (records: FleetTelemetryRecord[]) => void, signal?: AbortSignal) {
  const records = filteredRecords.filter((record) => !isLiveOemSource(record.source));
  const live = vehicles.filter((vehicle) => isLiveOemSource(vehicle.source));
  const jobs: Array<() => Promise<void>> = [];
  const issues = new Set<string>();
  const now = new Date();
  const sites = [...new Set(live.map((vehicle) => vehicle.siteId).filter((site): site is string => Boolean(site)))];
  for (const siteId of sites) {
    for (const company of ["Volvo", "Scania"] as const) {
      const siteVehicles = live.filter((v) => v.siteId === siteId && v.company === company);
      if (!siteVehicles.length) continue;
      let periods: DashboardFilters[];
      try { periods = selectedShiftPeriods({ ...filters, siteId, company }, now); }
      catch (error) { issues.add((error as Error).message); continue; }
      for (const period of periods) jobs.push(async () => {
        try {
          const preview = company === "Volvo" ? await fetchVolvoDriverStandstillReport(period) : await fetchScaniaDriverStandstillReport(period);
          const rows = reportTelemetry(preview, siteVehicles, snapshots);
          records.push(...rows);
          if (!preview.period || preview.error || !rows.length) issues.add(`${company}: some selected site/shift data is unavailable.`);
        } catch { issues.add(`${company}: some selected site/shift data is unavailable.`); }
        finally { onProgress?.([...records]); }
      });
    }
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    while (!signal?.aborted && next < jobs.length) await jobs[next++]();
  }));
  const unsupported = [...new Set(live.filter((v) => !["Volvo", "Scania"].includes(v.company) || !v.siteId).map((v) => v.company))];
  if (unsupported.length) issues.add(`Shift consumption unavailable for ${unsupported.join(", ")}; cumulative readings are excluded.`);
  if (live.length && !records.length) issues.add("No consumption data is available for the selected shift / period.");
  return { records, notice: [...issues].join(" "), live: live.length > 0 };
}
