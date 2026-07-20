import type { DashboardOverview, KpiMetric, NamedMetric } from "../types/dashboard";
import type { DashboardFilters, Site } from "../types/fleet";
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
      kpis: buildKpis(kpiValues, alerts.length, filters.company === "Volvo"),
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
    };
  },
};

function buildKpis(
  values: ReturnType<typeof aggregateDashboardKpis>,
  alertsCount: number,
  liveVolvoOnly = false,
): KpiMetric[] {
  const cumulativeLabel = liveVolvoOnly ? "Latest cumulative Volvo counters" : "Selected period";
  return [
    { label: "Total Vehicles", value: formatNumber(values.totalVehicles), subLabel: "Filtered fleet", tone: "neutral" },
    { label: "Running Vehicles", value: formatNumber(values.runningVehicles), subLabel: "Live operating", tone: "good" },
    { label: "Idle Vehicles", value: formatNumber(values.idleVehicles), subLabel: "Needs attention", tone: "warning" },
    { label: "Offline Vehicles", value: formatNumber(values.offlineVehicles), subLabel: "Tracker gaps", tone: "danger" },
    { label: "Total Fuel Consumed", value: formatLitres(values.totalFuelConsumed), subLabel: cumulativeLabel, tone: "info" },
    { label: "Avg Truck Efficiency", value: formatEfficiency(values.averageTruckEfficiency, "km/L"), subLabel: liveVolvoOnly ? "Cumulative Volvo efficiency" : "Truck category only", tone: "good" },
    { label: "Avg HEMM Fuel Rate", value: formatEfficiency(values.averageHemmFuelRate, "L/hr"), subLabel: "HEMM category only", tone: "info" },
    { label: "Total Trips", value: formatNumber(values.totalTrips), subLabel: liveVolvoOnly ? "Not supplied by Volvo RFMS" : "All completed trips", tone: "neutral" },
    { label: "Total Production", value: formatM3(values.totalProduction), subLabel: liveVolvoOnly ? "Not supplied by Volvo RFMS" : "Trips x capacity", tone: "good" },
    { label: "Fuel per m³", value: `${formatNumber(values.fuelPerM3, 3)} L/m³`, subLabel: liveVolvoOnly ? "Requires production data" : "Fuel intensity", tone: "warning" },
    { label: "Total Idle Hours", value: formatHours(values.totalIdleHours), subLabel: liveVolvoOnly ? cumulativeLabel : "Engine idle", tone: "warning" },
    { label: "Alerts Count", value: formatNumber(alertsCount), subLabel: "Open exceptions", tone: alertsCount ? "danger" : "good" },
  ];
}

function withSiteNames(metrics: NamedMetric[], siteNameMap: Map<string, Site["name"]>): NamedMetric[] {
  return metrics.map((metric) => ({
    ...metric,
    name: siteNameMap.get(metric.name) ?? metric.name,
  }));
}
