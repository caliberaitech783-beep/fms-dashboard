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
    const { sites, filteredVehicles, filteredRecords, records } = await getFilteredPortalData(filters);
    const siteMap = new Map(sites.map((site) => [site.id, site.name]));
    const recordsByVehicle = groupBy(filteredRecords, (record) => record.vehicleId);
    const liveRecordsByVehicle = groupBy(
      records.filter((record) => record.source === "VOLVO_RFMS_LIVE"),
      (record) => record.vehicleId,
    );

    return filteredVehicles
      .map((vehicle) => {
        const vehicleRecords = vehicle.source === "VOLVO_RFMS_LIVE"
          ? liveRecordsByVehicle.get(vehicle.id) ?? []
          : recordsByVehicle.get(vehicle.id) ?? [];
        const totals = sumRecords(vehicleRecords);
        const latestRecord = [...vehicleRecords].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
        const isLiveVolvo = vehicle.source === "VOLVO_RFMS_LIVE";
        const runningHours = isLiveVolvo
          ? rawMetricNumber(latestRecord, "lifetimeRunningHours") ?? 0
          : totals.runningHours;
        const idleHours = isLiveVolvo
          ? rawMetricNumber(latestRecord, "lifetimeIdleHours") ?? 0
          : totals.idleHours;
        const fuelConsumedLitres = isLiveVolvo
          ? rawMetricNumber(latestRecord, "lifetimeFuelLitres") ?? 0
          : totals.fuelConsumedLitres;
        const efficiency = isLiveVolvo
          ? rawMetricNumber(latestRecord, "lifetimeEfficiencyKmPerLitre")
          : vehicle.assetCategory === "Truck"
          ? calculateTruckEfficiency(totals.distanceKm, totals.fuelConsumedLitres)
          : calculateHemmFuelRate(totals.fuelConsumedLitres, totals.runningHours);

        return {
          vehicle,
          siteName: vehicle.siteName
            ?? (vehicle.siteId ? siteMap.get(vehicle.siteId) : null)
            ?? (isLiveVolvo ? "Site assignment required" : "Not available"),
          runningHours,
          idleHours,
          fuelConsumedLitres,
          trips: totals.trips,
          productionM3: totals.productionM3,
          efficiency,
          varianceFromNorm: calculateVarianceFromNorm(efficiency, vehicle.standardFuelNorm, vehicle.fuelMeasurementUnit),
          fuelPerM3: calculateFuelPerM3(fuelConsumedLitres, totals.productionM3),
          trackerHealth: getTrackerHealth(vehicle, latestRecord),
          lastDataReceived: latestRecord?.timestamp ?? null,
          latestRecord,
        };
      })
      .sort((a, b) => a.vehicle.vehicleNumber.localeCompare(b.vehicle.vehicleNumber));
  },
};

function rawMetricNumber(record: FleetTelemetryRecord | undefined, key: string): number | null {
  const value = record?.rawMetrics?.[key];
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

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
