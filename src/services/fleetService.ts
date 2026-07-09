import type { DashboardFilters, FleetTelemetryRecord, Vehicle } from "../types/fleet";
import {
  calculateFuelPerM3,
  calculateHemmFuelRate,
  calculateTruckEfficiency,
  calculateVarianceFromNorm,
  sumRecords,
} from "../utils/calculations";
import { TRACKER_HEALTH_THRESHOLDS } from "../constants/thresholds";
import { getFilteredPortalData } from "./dataAccess";

export interface FleetVehicleRow {
  vehicle: Vehicle;
  siteName: string;
  runningHours: number;
  idleHours: number;
  fuelConsumedLitres: number;
  trips: number;
  productionM3: number;
  efficiency: number | null;
  varianceFromNorm: number | null;
  fuelPerM3: number | null;
  trackerHealth: "healthy" | "delayed" | "offline";
  lastDataReceived: string | null;
  latestRecord?: FleetTelemetryRecord;
}

export const fleetService = {
  async getVehicles(filters: DashboardFilters): Promise<FleetVehicleRow[]> {
    const { sites, filteredVehicles, filteredRecords } = await getFilteredPortalData(filters);
    const siteMap = new Map(sites.map((site) => [site.id, site.name]));
    const recordsByVehicle = groupBy(filteredRecords, (record) => record.vehicleId);

    return filteredVehicles
      .map((vehicle) => {
        const records = recordsByVehicle.get(vehicle.id) ?? [];
        const totals = sumRecords(records);
        const latestRecord = [...records].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
        const efficiency = vehicle.assetCategory === "Truck"
          ? calculateTruckEfficiency(totals.distanceKm, totals.fuelConsumedLitres)
          : calculateHemmFuelRate(totals.fuelConsumedLitres, totals.runningHours);

        return {
          vehicle,
          siteName: vehicle.siteName ?? (vehicle.siteId ? siteMap.get(vehicle.siteId) : null) ?? "Not available",
          runningHours: totals.runningHours,
          idleHours: totals.idleHours,
          fuelConsumedLitres: totals.fuelConsumedLitres,
          trips: totals.trips,
          productionM3: totals.productionM3,
          efficiency,
          varianceFromNorm: calculateVarianceFromNorm(efficiency, vehicle.standardFuelNorm, vehicle.fuelMeasurementUnit),
          fuelPerM3: calculateFuelPerM3(totals.fuelConsumedLitres, totals.productionM3),
          trackerHealth: getTrackerHealth(vehicle, latestRecord),
          lastDataReceived: latestRecord?.timestamp ?? null,
          latestRecord,
        };
      })
      .sort((a, b) => a.vehicle.vehicleNumber.localeCompare(b.vehicle.vehicleNumber));
  },
};

function getTrackerHealth(vehicle: Vehicle, latestRecord?: FleetTelemetryRecord): FleetVehicleRow["trackerHealth"] {
    if (vehicle.status === "offline" || !latestRecord || (latestRecord.offlineHours ?? 0) >= 6) {
    return "offline";
  }

  const minutesSinceData = (new Date().getTime() - new Date(latestRecord.timestamp).getTime()) / 60000;

  if (minutesSinceData > TRACKER_HEALTH_THRESHOLDS.delayedMinutes) {
    return "delayed";
  }

  return "healthy";
}

function groupBy<T>(items: T[], keySelector: (item: T) => string): Map<string, T[]> {
  return items.reduce((map, item) => {
    const key = keySelector(item);
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
    return map;
  }, new Map<string, T[]>());
}
