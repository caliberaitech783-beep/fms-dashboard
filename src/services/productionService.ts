import type { DashboardFilters } from "../types/fleet";
import {
  aggregateByLead,
  aggregateByShift,
  aggregateBySite,
  aggregateTrendByDate,
  calculateFuelPerM3,
  getVehiclePerformanceRows,
  sumRecords,
} from "../utils/calculations";
import { getFilteredPortalData } from "./dataAccess";

export const productionService = {
  async getProductionSummary(filters: DashboardFilters) {
    const { sites, filteredVehicles, filteredRecords } = await getFilteredPortalData(filters);
    const siteMap = new Map(sites.map((site) => [site.id, site.name]));
    const totals = sumRecords(filteredRecords);
    const vehicleRows = getVehiclePerformanceRows(filteredRecords, filteredVehicles)
      .sort((a, b) => b.productionM3 - a.productionM3);

    return {
      hasProductionData: filteredRecords.some((record) => record.trips !== null || record.productionM3 !== null || record.capacityM3 !== null),
      totals: {
        trips: totals.trips,
        productionM3: totals.productionM3,
        averageProductionPerVehicle: filteredVehicles.length ? totals.productionM3 / filteredVehicles.length : 0,
        fuelPerM3: calculateFuelPerM3(totals.fuelConsumedLitres, totals.productionM3),
      },
      productionByShift: aggregateByShift(filteredRecords),
      productionByVehicle: vehicleRows,
      productionByLead: aggregateByLead(filteredRecords),
      productionBySite: aggregateBySite(filteredRecords).map((metric) => ({
        ...metric,
        name: siteMap.get(metric.name) ?? metric.name,
      })),
      tripsPerVehicle: vehicleRows,
      productionFuelTrend: aggregateTrendByDate(filteredRecords),
      leadAnalysis: aggregateByLead(filteredRecords),
    };
  },
};
