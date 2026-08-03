import type { DashboardOverview, KpiMetric, NamedMetric } from "../types/dashboard";
import type { DashboardFilters, FleetTelemetryRecord, Site, Vehicle } from "../types/fleet";
import {
  aggregateByCategory,
  aggregateByCompany,
  aggregateByModel,
  aggregateByShift,
  aggregateBySite,
  aggregateDashboardKpis,
  aggregateRunningIdleTrend,
  aggregateTrendByDate,
  calculateVarianceFromNorm,
  generateAlerts,
  getVehiclePerformanceRows,
} from "../utils/calculations";
import {
  formatEfficiency,
  formatHours,
  formatLitres,
  formatM3,
  formatNumber,
} from "../utils/formatters";
import { ALERT_THRESHOLDS } from "../constants/thresholds";
import { getFilteredPortalData } from "./dataAccess";

export const dashboardService = {
  async getOverview(filters: DashboardFilters): Promise<DashboardOverview> {
    const { sites, vehicles, filteredVehicles, filteredRecords, integrations } = await getFilteredPortalData(filters);
    const kpiValues = aggregateDashboardKpis(filteredRecords, filteredVehicles, filters);
    const alerts = generateAlerts(filteredRecords, filteredVehicles, ALERT_THRESHOLDS);
    const siteNameMap = new Map(sites.map((site) => [site.id, site.name]));
    const statusDistribution = ["running", "idle", "stopped", "offline", "maintenance", "unknown"].map((status) => ({
      status,
      value: filteredVehicles.filter((vehicle) => vehicle.status === status).length,
    }));

    return {
      kpis: buildKpis(kpiValues, alerts.length, filters.company === "Volvo", filters.company === "Eicher"),
      productionFuelTrend: aggregateTrendByDate(filteredRecords),
      shiftComparison: aggregateByShift(filteredRecords).map((metric) => ({
        ...metric,
        shift: metric.name.replace("Shift ", ""),
      })),
      sitePerformance: withSiteNames(aggregateBySite(filteredRecords), siteNameMap),
      companyPerformance: aggregateByCompany(filteredRecords, vehicles),
      modelPerformance: aggregateByModel(filteredRecords, vehicles)
        .map((metric) => ({
          ...metric,
          efficiency: metric.runningHours
            ? metric.fuelConsumedLitres / metric.runningHours
            : metric.fuelConsumedLitres / Math.max(1, metric.distanceKm ?? 1),
        }))
        .sort((a, b) => b.fuelConsumedLitres - a.fuelConsumedLitres)
        .slice(0, 12),
      statusDistribution,
      categoryFuel: aggregateByCategory(filteredRecords, vehicles),
      runningIdleTrend: aggregateRunningIdleTrend(filteredRecords),
      highFuelVehicles: getVehiclePerformanceRows(filteredRecords, filteredVehicles)
        .sort((a, b) => b.fuelConsumedLitres - a.fuelConsumedLitres)
        .slice(0, 10),
      lowEfficiencyVehicles: getVehiclePerformanceRows(filteredRecords, filteredVehicles)
        .sort((a, b) => {
          const aVariance = calculateVarianceFromNorm(a.efficiency, a.vehicle.standardFuelNorm, a.vehicle.fuelMeasurementUnit) ?? 0;
          const bVariance = calculateVarianceFromNorm(b.efficiency, b.vehicle.standardFuelNorm, b.vehicle.fuelMeasurementUnit) ?? 0;
          return a.vehicle.fuelMeasurementUnit === "km/L" ? aVariance - bVariance : bVariance - aVariance;
        })
        .slice(0, 10),
      idleVehicles: getVehiclePerformanceRows(filteredRecords, filteredVehicles)
        .sort((a, b) => b.idleHours - a.idleHours)
        .slice(0, 10),
      criticalAlerts: alerts.filter((alert) => alert.severity === "critical").slice(0, 10),
      integrationHealth: integrations,
      eicherLiveLocations: filters.company === "Eicher"
        ? buildEicherLiveLocations(filteredRecords, filteredVehicles)
        : undefined,
    };
  },
};

function buildEicherLiveLocations(records: FleetTelemetryRecord[], vehicles: Vehicle[]) {
  const eicherVehicles = vehicles.filter((vehicle) => vehicle.source === "EICHER_VECV_LIVE");
  const latestByVehicle = latestRecordsByVehicle(records.filter((record) => record.source === "EICHER_VECV_LIVE"));

  return eicherVehicles
    .map((vehicle) => {
      const latestRecord = latestByVehicle.get(vehicle.id);
      const raw = latestRecord?.rawMetrics ?? {};
      return {
        vehicleId: vehicle.id,
        registrationNumber: rawString(raw, "registrationNumber") || vehicle.vehicleNumber,
        chassisNumber: rawString(raw, "chassisNumber") || vehicle.trackerId,
        status: rawString(raw, "vehicleStatus") || latestRecord?.status || vehicle.status,
        latitude: rawNumber(raw, "latitude"),
        longitude: rawNumber(raw, "longitude"),
        speedKph: rawNumber(raw, "speedKph"),
        odometerKm: rawNumber(raw, "odometerKm") ?? latestRecord?.odometerKm ?? null,
        vehicleDirection: rawNumber(raw, "vehicleDirection") ?? rawNumber(raw, "heading"),
        deviceId: rawString(raw, "deviceId"),
        currentLocation: rawString(raw, "currentLocation") || latestRecord?.location || null,
        gpsTimestamp: rawString(raw, "gpsTimestamp") || latestRecord?.timestamp || null,
        lastSuccessfulUpdate: rawString(raw, "lastSuccessfulUpdate"),
      };
    })
    .sort((left, right) => left.registrationNumber.localeCompare(
      right.registrationNumber,
      undefined,
      { numeric: true },
    ));
}

function latestRecordsByVehicle(records: FleetTelemetryRecord[]): Map<string, FleetTelemetryRecord> {
  const latest = new Map<string, FleetTelemetryRecord>();
  records.forEach((record) => {
    const current = latest.get(record.vehicleId);
    if (!current || record.timestamp > current.timestamp) {
      latest.set(record.vehicleId, record);
    }
  });
  return latest;
}

function rawString(metrics: Record<string, unknown>, key: string): string | null {
  const value = metrics[key];
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || null;
}

function rawNumber(metrics: Record<string, unknown>, key: string): number | null {
  const value = metrics[key];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildKpis(
  values: ReturnType<typeof aggregateDashboardKpis>,
  alertsCount: number,
  liveVolvoOnly = false,
  eicherLocationOnly = false,
): KpiMetric[] {
  const cumulativeLabel = liveVolvoOnly ? "Latest cumulative Volvo counters" : "Selected period";
  const eicherUnavailable = "Not supplied by Eicher VECV";
  const notSupplied = eicherLocationOnly ? eicherUnavailable : null;

  return [
    { label: "Total Vehicles", value: formatNumber(values.totalVehicles), subLabel: "Filtered fleet", tone: "neutral" },
    { label: "Running Vehicles", value: formatNumber(values.runningVehicles), subLabel: "Live operating", tone: "good" },
    { label: "Idle Vehicles", value: formatNumber(values.idleVehicles), subLabel: "Needs attention", tone: "warning" },
    { label: "Offline Vehicles", value: formatNumber(values.offlineVehicles), subLabel: "Tracker gaps", tone: "danger" },
    { label: "Total Fuel Consumed", value: eicherLocationOnly ? "-" : formatLitres(values.totalFuelConsumed), subLabel: notSupplied ?? cumulativeLabel, tone: "info" },
    { label: "Avg Truck Efficiency", value: eicherLocationOnly ? "-" : formatEfficiency(values.averageTruckEfficiency, "km/L"), subLabel: notSupplied ?? (liveVolvoOnly ? "Cumulative Volvo efficiency" : "Truck category only"), tone: "good" },
    { label: "Avg HEMM Fuel Rate", value: eicherLocationOnly ? "-" : formatEfficiency(values.averageHemmFuelRate, "L/hr"), subLabel: notSupplied ?? "HEMM category only", tone: "info" },
    { label: "Total Trips", value: eicherLocationOnly ? "-" : formatNumber(values.totalTrips), subLabel: notSupplied ?? (liveVolvoOnly ? "Not supplied by Volvo RFMS" : "All completed trips"), tone: "neutral" },
    { label: "Total Production", value: eicherLocationOnly ? "-" : formatM3(values.totalProduction), subLabel: notSupplied ?? (liveVolvoOnly ? "Not supplied by Volvo RFMS" : "Trips x capacity"), tone: "good" },
    { label: "Fuel per m3", value: eicherLocationOnly ? "-" : `${formatNumber(values.fuelPerM3, 3)} L/m3`, subLabel: notSupplied ?? (liveVolvoOnly ? "Requires production data" : "Fuel intensity"), tone: "warning" },
    { label: "Total Idle Hours", value: eicherLocationOnly ? "-" : formatHours(values.totalIdleHours), subLabel: notSupplied ?? (liveVolvoOnly ? cumulativeLabel : "Engine idle"), tone: "warning" },
    { label: "Alerts Count", value: formatNumber(alertsCount), subLabel: "Open exceptions", tone: alertsCount ? "danger" : "good" },
  ];
}

function withSiteNames(metrics: NamedMetric[], siteNameMap: Map<string, Site["name"]>): NamedMetric[] {
  return metrics.map((metric) => ({
    ...metric,
    name: siteNameMap.get(metric.name) ?? metric.name,
  }));
}
