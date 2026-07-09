import type { DashboardFilters } from "../types/fleet";
import {
  aggregateByCategory,
  aggregateByCompany,
  aggregateByModel,
  aggregateByShift,
  aggregateBySite,
  aggregateDashboardKpis,
  calculateFuelPerM3,
  calculateFuelPerTrip,
  calculateVarianceFromNorm,
  getVehiclePerformanceRows,
} from "../utils/calculations";
import { getFilteredPortalData } from "./dataAccess";

export const fuelService = {
  async getFuelSummary(filters: DashboardFilters) {
    const { sites, vehicles, filteredVehicles, filteredRecords } = await getFilteredPortalData(filters);
    const siteMap = new Map(sites.map((site) => [site.id, site.name]));
    const kpis = aggregateDashboardKpis(filteredRecords, filteredVehicles, filters);
    const vehicleRows = getVehiclePerformanceRows(filteredRecords, filteredVehicles).map((row) => ({
      ...row,
      varianceFromNorm: calculateVarianceFromNorm(row.efficiency, row.vehicle.standardFuelNorm, row.vehicle.fuelMeasurementUnit),
      fuelPerTrip: calculateFuelPerTrip(row.fuelConsumedLitres, row.trips),
      fuelPerM3: calculateFuelPerM3(row.fuelConsumedLitres, row.productionM3),
    }));

    return {
      kpis,
      fuelBySite: aggregateBySite(filteredRecords).map((metric) => ({
        ...metric,
        name: siteMap.get(metric.name) ?? metric.name,
      })),
      fuelByCategory: aggregateByCategory(filteredRecords, vehicles),
      fuelByCompany: aggregateByCompany(filteredRecords, vehicles),
      fuelByModel: aggregateByModel(filteredRecords, vehicles),
      fuelByShift: aggregateByShift(filteredRecords),
      truckComparison: vehicleRows
        .filter((row) => row.vehicle.assetCategory === "Truck")
        .sort((a, b) => (a.efficiency ?? 0) - (b.efficiency ?? 0))
        .slice(0, 15),
      hemmComparison: vehicleRows
        .filter((row) => row.vehicle.assetCategory === "HEMM")
        .sort((a, b) => (b.efficiency ?? 0) - (a.efficiency ?? 0))
        .slice(0, 15),
      normDeviation: vehicleRows
        .sort((a, b) => Math.abs(b.varianceFromNorm ?? 0) - Math.abs(a.varianceFromNorm ?? 0))
        .slice(0, 20),
      abnormalFuelDrops: filteredRecords
        .filter((record) => {
          const vehicle = filteredVehicles.find((item) => item.id === record.vehicleId);
          return vehicle && record.fuelLevelLitres !== null && vehicle.fuelTankCapacityLitres !== null
            ? (record.fuelFilledLitres ?? 0) === 0 && record.fuelLevelLitres < vehicle.fuelTankCapacityLitres * 0.18
            : false;
        })
        .slice(0, 15),
    };
  },
};
