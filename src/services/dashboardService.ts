import { dashboardPeriodRecords } from "./dashboardPeriodService";
import { filterVehicles } from "../utils/filters";
import { withModelEfficiency } from "../utils/modelEfficiency";
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
  formatLitres,
  formatNumber,
} from "../utils/formatters";
import { ALERT_THRESHOLDS } from "../constants/thresholds";
import { getFilteredPortalData } from "./dataAccess";

export const dashboardService = {
  async getOverview(filters: DashboardFilters, onProgress?: (overview: DashboardOverview) => void, signal?: AbortSignal): Promise<DashboardOverview> {
    const data = await getFilteredPortalData(filters);
    const { sites, vehicles, integrations } = data;
    const filteredVehicles = filterVehicles(vehicles, filters);
    signal?.throwIfAborted();
    const build = (filteredRecords: FleetTelemetryRecord[], notice: string): DashboardOverview => {
    const kpiValues = aggregateDashboardKpis(filteredRecords, filteredVehicles, filters);
    const truckRecords = filteredRecords.filter((record) => record.assetCategory === "Truck");
    const fuel = truckRecords.reduce((sum, record) => sum + (record.fuelConsumedLitres ?? 0), 0);
    const distance = truckRecords.reduce((sum, record) => sum + (record.distanceKm ?? 0), 0);
    kpiValues.averageTruckEfficiency = fuel > 0 ? distance / fuel : null;
    const alerts = generateAlerts(filteredRecords, filteredVehicles, ALERT_THRESHOLDS);
    const siteNameMap = new Map(sites.map((site) => [site.id, site.name]));
    const statusDistribution = ["running", "idle", "stopped", "offline", "maintenance", "unknown"].map((status) => ({
      status,
      value: filteredVehicles.filter((vehicle) => vehicle.status === status).length,
    }));

    return {
      kpis: buildKpis(kpiValues, filters.company === "Eicher", filteredRecords.some((row) => row.fuelConsumedLitres !== null)),
      periodNotice: notice,
      vehicleMetrics: getVehiclePerformanceRows(filteredRecords, filteredVehicles).map((row) => {
        const parts = filteredRecords.filter((record) => record.vehicleId === row.vehicle.id);
        const weighted = (value: (record: FleetTelemetryRecord) => number | null) => {
          const available = parts.filter((record) => value(record) !== null && (record.engineHours ?? 0) > 0);
          const hours = available.reduce((sum, record) => sum + record.engineHours!, 0);
          return hours > 0 ? available.reduce((sum, record) => sum + value(record)! * record.engineHours!, 0) / hours : null;
        };
        return {
          name: row.vehicle.vehicleNumber,
          standstill: weighted((record) => row.vehicle.company === "Scania"
            ? typeof record.rawMetrics.adjustedIdling === "number" ? record.rawMetrics.adjustedIdling : null
            : record.idlePercentage),
          averageDiesel: weighted((record) => typeof record.rawMetrics.averageDiesel === "number" ? record.rawMetrics.averageDiesel : record.fuelConsumedLitres !== null && (record.engineHours ?? 0) > 0 ? record.fuelConsumedLitres / record.engineHours! : null),
        };
      }),
      productionFuelTrend: aggregateTrendByDate(filteredRecords),
      shiftComparison: aggregateByShift(filteredRecords).map((metric) => ({
        ...metric,
        shift: metric.name.replace("Shift ", ""),
      })),
      sitePerformance: withSiteNames(aggregateBySite(filteredRecords.filter((row) => row.assetCategory === "Truck")), siteNameMap).map((metric) => withModelEfficiency(metric, "Truck")),
      companyPerformance: aggregateByCompany(filteredRecords, vehicles),
      modelPerformance: ["Truck", "HEMM"].flatMap((category) => {
        const categoryVehicles = filteredVehicles
          .filter((vehicle) => vehicle.assetCategory === category)
          .map((vehicle) => category === "Truck" && vehicle.company === "Scania" && !vehicle.modelNumber?.trim()
            ? { ...vehicle, modelNumber: "500-XT" }
            : vehicle);
        const ids = new Set(categoryVehicles.map((vehicle) => vehicle.id));
        return aggregateByModel(filteredRecords.filter((record) => ids.has(record.vehicleId)), categoryVehicles)
          .map((metric) => withModelEfficiency(metric, category)).sort((a, b) => b.fuelConsumedLitres - a.fuelConsumedLitres).slice(0, 12);
      }),
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
    };
    onProgress?.(build([], "Loading selected-period consumption..."));
    const periodData = await dashboardPeriodRecords(filters, filteredVehicles, data.records, data.filteredRecords, (records) => {
      onProgress?.(build(records, "Loading remaining site/shift data. Totals are partial until the update completes."));
    }, signal);
    return build(periodData.records, periodData.notice);
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
  eicherLocationOnly = false,
  hasFuelData = true,
): KpiMetric[] {
  const periodLabel = "Selected shift / period consumption";
  const eicherUnavailable = "Not supplied by Eicher VECV";
  const notSupplied = eicherLocationOnly ? eicherUnavailable : null;

  return [
    { label: "Total Vehicles", value: formatNumber(values.totalVehicles), subLabel: "Filtered fleet", tone: "neutral" },
    { label: "Running Vehicles", value: formatNumber(values.runningVehicles), subLabel: "Live operating", tone: "good" },
    { label: "Total Fuel Consumed", value: eicherLocationOnly || !hasFuelData ? "-" : formatLitres(values.totalFuelConsumed), subLabel: notSupplied ?? periodLabel, tone: "info" },
    { label: "Avg Truck Efficiency", value: eicherLocationOnly ? "-" : formatEfficiency(values.averageTruckEfficiency, "km/L"), subLabel: notSupplied ?? "Selected shift / period · Trucks", tone: "good" },
    { label: "Avg Equipment Fuel Rate", value: eicherLocationOnly ? "-" : formatEfficiency(values.averageHemmFuelRate, "L/hr"), subLabel: notSupplied ?? "Equipment category only", tone: "info" },
  ];
}

function withSiteNames(metrics: NamedMetric[], siteNameMap: Map<string, Site["name"]>): NamedMetric[] {
  return metrics.map((metric) => ({
    ...metric,
    name: siteNameMap.get(metric.name) ?? metric.name,
  }));
}
