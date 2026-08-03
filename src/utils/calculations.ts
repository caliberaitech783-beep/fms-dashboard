import type {
  Alert,
  DashboardFilters,
  ExtendedFuelMeasurementUnit,
  FleetTelemetryRecord,
  Vehicle,
} from "../types/fleet";
import type { NamedMetric, VehiclePerformanceRow } from "../types/dashboard";
import { ALERT_THRESHOLDS } from "../constants/thresholds";

type Thresholds = typeof ALERT_THRESHOLDS;

function toNumber(value: number | null | undefined): number {
  return Number.isFinite(value ?? Number.NaN) ? Number(value) : 0;
}

function safeDivide(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  const num = toNumber(numerator);
  const den = toNumber(denominator);

  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) {
    return null;
  }

  return num / den;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function calculateTruckEfficiency(
  distanceKm: number | null | undefined,
  fuelConsumedLitres: number | null | undefined,
): number | null {
  return round(safeDivide(distanceKm, fuelConsumedLitres), 2);
}

export function calculateTruckEfficiencyFromLPer100Km(lPer100Km: number | null | undefined): number | null {
  return round(safeDivide(100, lPer100Km), 2);
}

export function calculateFuelFromLPer100Km(
  distanceKm: number | null | undefined,
  lPer100Km: number | null | undefined,
): number | null {
  const value = safeDivide(toNumber(distanceKm) * toNumber(lPer100Km), 100);
  return round(value, 2);
}

export function calculateHemmFuelRate(
  fuelConsumedLitres: number | null | undefined,
  runningHours: number | null | undefined,
): number | null {
  return round(safeDivide(fuelConsumedLitres, runningHours), 2);
}

export function calculateProduction(
  trips: number | null | undefined,
  capacityM3: number | null | undefined,
): number | null {
  if (trips === null || trips === undefined || capacityM3 === null || capacityM3 === undefined) {
    return null;
  }

  return Math.max(0, trips) * Math.max(0, capacityM3);
}

export function calculateFuelPerTrip(
  fuelConsumedLitres: number | null | undefined,
  trips: number | null | undefined,
): number | null {
  return round(safeDivide(fuelConsumedLitres, trips), 2);
}

export function calculateFuelPerM3(
  fuelConsumedLitres: number | null | undefined,
  productionM3: number | null | undefined,
): number | null {
  return round(safeDivide(fuelConsumedLitres, productionM3), 3);
}

export function calculateIdlePercentage(
  idleHours: number | null | undefined,
  engineHours: number | null | undefined,
): number | null {
  const result = safeDivide(idleHours, engineHours);
  return round(result === null ? null : result * 100, 1);
}

export function calculateRunningPercentage(
  runningHours: number | null | undefined,
  engineHours: number | null | undefined,
): number | null {
  const result = safeDivide(runningHours, engineHours);
  return round(result === null ? null : result * 100, 1);
}

export function calculateUtilization(
  runningHours: number | null | undefined,
  availableHours: number | null | undefined,
): number | null {
  const result = safeDivide(runningHours, availableHours);
  return round(result === null ? null : result * 100, 1);
}

export function calculateVarianceFromNorm(
  actual: number | null,
  norm: number | null,
  measurementUnit: ExtendedFuelMeasurementUnit,
): number | null {
  if (actual === null || norm === null || norm <= 0 || measurementUnit === "Unknown") {
    return null;
  }

  return round(((actual - norm) / norm) * 100, 1);
}

export function sumRecords(records: FleetTelemetryRecord[]) {
  return records.reduce(
    (acc, record) => {
      acc.distanceKm += toNumber(record.distanceKm);
      acc.engineHours += toNumber(record.engineHours);
      acc.runningHours += toNumber(record.runningHours);
      acc.idleHours += toNumber(record.idleHours);
      acc.stoppedHours += toNumber(record.stoppedHours);
      acc.offlineHours += toNumber(record.offlineHours);
      acc.availableHours += toNumber(record.availableHours);
      acc.fuelConsumedLitres += toNumber(record.fuelConsumedLitres);
      acc.fuelFilledLitres += toNumber(record.fuelFilledLitres);
      acc.trips += toNumber(record.trips);
      acc.productionM3 += toNumber(record.productionM3);
      return acc;
    },
    {
      distanceKm: 0,
      engineHours: 0,
      runningHours: 0,
      idleHours: 0,
      stoppedHours: 0,
      offlineHours: 0,
      availableHours: 0,
      fuelConsumedLitres: 0,
      fuelFilledLitres: 0,
      trips: 0,
      productionM3: 0,
    },
  );
}

export function getVehiclePerformanceRows(
  records: FleetTelemetryRecord[],
  vehicles: Vehicle[],
): VehiclePerformanceRow[] {
  const recordsByVehicle = groupBy(records, (record) => record.vehicleId);
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  const rows: Array<VehiclePerformanceRow | null> = [...recordsByVehicle.entries()]
    .map(([vehicleId, vehicleRecords]) => {
      const vehicle = vehicleMap.get(vehicleId);

      if (!vehicle) {
        return null;
      }

      const totals = sumRecords(vehicleRecords);
      const latestRecord = [...vehicleRecords].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
      const efficiency =
        vehicle.assetCategory === "Truck"
          ? latestRecord?.truckEfficiencyKmPerLitre ?? calculateTruckEfficiency(totals.distanceKm, totals.fuelConsumedLitres)
          : vehicle.assetCategory === "HEMM"
            ? latestRecord?.hemmFuelRateLitrePerHour ?? calculateHemmFuelRate(totals.fuelConsumedLitres, totals.runningHours)
            : latestRecord?.truckEfficiencyKmPerLitre ?? calculateTruckEfficiency(totals.distanceKm, totals.fuelConsumedLitres);

      return {
        vehicle,
        fuelConsumedLitres: totals.fuelConsumedLitres,
        distanceKm: totals.distanceKm,
        runningHours: totals.runningHours,
        idleHours: totals.idleHours,
        trips: totals.trips,
        productionM3: totals.productionM3,
        efficiency,
        fuelPerM3: calculateFuelPerM3(totals.fuelConsumedLitres, totals.productionM3),
        latestRecord,
      } satisfies VehiclePerformanceRow;
    });

  return rows.filter((row): row is VehiclePerformanceRow => row !== null);
}

export function aggregateDashboardKpis(
  records: FleetTelemetryRecord[],
  vehicles: Vehicle[],
  _filters?: DashboardFilters,
) {
  const totals = sumRecords(records);
  const rows = getVehiclePerformanceRows(records, vehicles);
  const truckRecords = records.filter((record) => {
    const vehicle = vehicles.find((item) => item.id === record.vehicleId);
    return vehicle?.assetCategory === "Truck";
  });
  const hemmRecords = records.filter((record) => {
    const vehicle = vehicles.find((item) => item.id === record.vehicleId);
    return vehicle?.assetCategory === "HEMM";
  });
  const truckTotals = sumRecords(truckRecords);
  const hemmTotals = sumRecords(hemmRecords);
  const totalVehicles = vehicles.length;
  const runningVehicles = vehicles.filter((vehicle) => vehicle.status === "running").length;
  const idleVehicles = vehicles.filter((vehicle) => vehicle.status === "idle").length;
  const offlineVehicles = vehicles.filter((vehicle) => vehicle.status === "offline").length;
  const avgTruckExportedEfficiency = average(
    truckRecords.map((record) => record.truckEfficiencyKmPerLitre).filter((value): value is number => value !== null),
  );

  return {
    totalVehicles,
    runningVehicles,
    idleVehicles,
    offlineVehicles,
    totalFuelConsumed: totals.fuelConsumedLitres,
    totalDistance: totals.distanceKm,
    totalEngineHours: totals.engineHours,
    averageTruckEfficiency: avgTruckExportedEfficiency ?? calculateTruckEfficiency(
      truckTotals.distanceKm,
      truckTotals.fuelConsumedLitres,
    ),
    averageHemmFuelRate: calculateHemmFuelRate(
      hemmTotals.fuelConsumedLitres,
      hemmTotals.runningHours,
    ),
    totalTrips: totals.trips,
    totalProduction: totals.productionM3,
    fuelPerM3: calculateFuelPerM3(totals.fuelConsumedLitres, totals.productionM3),
    totalIdleHours: totals.idleHours,
    totalRunningHours: totals.runningHours,
    idlePercentage: calculateIdlePercentage(totals.idleHours, totals.engineHours),
    utilization: calculateUtilization(totals.runningHours, totals.availableHours),
    rows,
  };
}

export function aggregateBySite(records: FleetTelemetryRecord[]): NamedMetric[] {
  return aggregateRecords(records, (record) => record.siteName ?? record.siteId ?? "Not available");
}

export function aggregateByShift(records: FleetTelemetryRecord[]): NamedMetric[] {
  return aggregateRecords(records, (record) => record.shift === "ALL_DAY" ? "All day" : `Shift ${record.shift}`);
}

export function aggregateByCompany(records: FleetTelemetryRecord[], vehicles: Vehicle[]): NamedMetric[] {
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  return aggregateRecords(records, (record) => vehicleMap.get(record.vehicleId)?.company ?? "Unknown");
}

export function aggregateByModel(records: FleetTelemetryRecord[], vehicles: Vehicle[]): NamedMetric[] {
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  return aggregateRecords(records, (record) => vehicleMap.get(record.vehicleId)?.modelNumber ?? "Model not available");
}

export function aggregateByCategory(records: FleetTelemetryRecord[], vehicles: Vehicle[]): NamedMetric[] {
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  return aggregateRecords(records, (record) => vehicleMap.get(record.vehicleId)?.assetCategory ?? "Unknown");
}

export function aggregateByLead(records: FleetTelemetryRecord[]): NamedMetric[] {
  return aggregateRecords(records, () => "Manual");
}

export function aggregateTrendByDate(records: FleetTelemetryRecord[]): NamedMetric[] {
  return aggregateRecords(records, (record) => record.date || record.timestamp.slice(0, 10));
}

export function aggregateRunningIdleTrend(records: FleetTelemetryRecord[]): NamedMetric[] {
  return aggregateRecords(records, (record) => record.date || record.timestamp.slice(0, 10));
}

export function generateAlerts(
  records: FleetTelemetryRecord[],
  vehicles: Vehicle[],
  thresholds: Thresholds = ALERT_THRESHOLDS,
): Alert[] {
  const rows = getVehiclePerformanceRows(records, vehicles);
  const alerts: Alert[] = [];

  rows.forEach((row) => {
    const vehicle = row.vehicle;
    const latest = row.latestRecord;
    const idlePercentage = latest?.idlePercentage ?? calculateIdlePercentage(row.idleHours, latest?.engineHours ?? row.runningHours + row.idleHours);
    const variance = calculateVarianceFromNorm(row.efficiency, vehicle.standardFuelNorm, vehicle.fuelMeasurementUnit);
    const lPer100Km = typeof latest?.rawMetrics?.lPer100Km === "number" ? latest.rawMetrics.lPer100Km : null;
    const isLiveVolvo = vehicle.source === "VOLVO_RFMS_LIVE";
    const isEicherLive = vehicle.source === "EICHER_VECV_LIVE";
    const eventType = typeof latest?.rawMetrics?.eventType === "string" ? latest.rawMetrics.eventType : null;
    const adBluePercent = typeof latest?.rawMetrics?.adBluePercent === "number" ? latest.rawMetrics.adBluePercent : null;
    const fuelPercent = typeof latest?.rawMetrics?.fuelPercent === "number" ? latest.rawMetrics.fuelPercent : null;
    const isStale = latest?.rawMetrics?.isStale === true;

    if (isLiveVolvo && eventType === "WITHOUT_ADBLUE") {
      alerts.push(makeAlert("WITHOUT_ADBLUE", "critical", vehicle, latest, `${vehicle.vehicleNumber} reported operation without AdBlue.`));
    } else if (isLiveVolvo && adBluePercent !== null && adBluePercent <= 10) {
      alerts.push(makeAlert("LOW_ADBLUE", "warning", vehicle, latest, `${vehicle.vehicleNumber} AdBlue level is ${adBluePercent}%.`));
    }

    if (isLiveVolvo && fuelPercent !== null && fuelPercent <= 10) {
      alerts.push(makeAlert("LOW_FUEL", "warning", vehicle, latest, `${vehicle.vehicleNumber} fuel level is ${fuelPercent}%.`));
    }

    if (isLiveVolvo && isStale) {
      alerts.push(makeAlert("STALE_VEHICLE_DATA", "warning", vehicle, latest, `${vehicle.vehicleNumber} Volvo status data is stale.`));
    }

    if (row.fuelConsumedLitres > thresholds.highFuelConsumptionLitresPerPeriod) {
      alerts.push(makeAlert("HIGH_FUEL_CONSUMPTION", "warning", vehicle, latest, `${vehicle.vehicleNumber} consumed high fuel in the selected period.`));
    }

    if (vehicle.assetCategory === "Truck" && variance !== null && variance <= thresholds.lowTruckKmPerLitreVariancePercent) {
      alerts.push(makeAlert("LOW_KM_PER_LITRE", "critical", vehicle, latest, `${vehicle.vehicleNumber} is below configured truck fuel norm by ${Math.abs(variance)}%.`));
    }

    if (lPer100Km !== null && lPer100Km > thresholds.highLPer100Km) {
      alerts.push(makeAlert("HIGH_L_PER_100KM", "warning", vehicle, latest, `${vehicle.vehicleNumber} has high L/100km consumption.`));
    }

    if (vehicle.assetCategory === "HEMM" && variance !== null && variance >= thresholds.highHemmLitrePerHourVariancePercent) {
      alerts.push(makeAlert("HIGH_LITRE_PER_HOUR", "critical", vehicle, latest, `${vehicle.vehicleNumber} is above HEMM fuel norm by ${variance}%.`));
    }

    if (idlePercentage !== null && idlePercentage >= thresholds.excessiveIdlePercentage) {
      alerts.push(makeAlert("EXCESSIVE_IDLE", "warning", vehicle, latest, `${vehicle.vehicleNumber} idle time is ${idlePercentage}% of engine hours.`));
    }

    if (!isLiveVolvo && !isEicherLive && latest && (latest.distanceKm === null || latest.fuelConsumedLitres === null || latest.engineHours === null)) {
      alerts.push(makeAlert("DATA_MAPPING_WARNING", "info", vehicle, latest, `${vehicle.vehicleNumber} has missing mapped source fields.`));
    }
  });

  return alerts
    .map((alert, index) => ({ ...alert, id: `${alert.type}-${alert.vehicleId}-${index}` }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 120);
}

function makeAlert(
  type: Alert["type"],
  severity: Alert["severity"],
  vehicle: Vehicle,
  record: FleetTelemetryRecord | undefined,
  message: string,
): Alert {
  return {
    id: `${type}-${vehicle.id}`,
    type,
    severity,
    vehicleId: vehicle.id,
    siteId: vehicle.siteId,
    message,
    createdAt: record?.timestamp ?? new Date().toISOString(),
    acknowledged: severity === "info",
  };
}

function aggregateRecords(
  records: FleetTelemetryRecord[],
  keySelector: (record: FleetTelemetryRecord) => string,
): NamedMetric[] {
  const grouped = groupBy(records, keySelector);

  return [...grouped.entries()]
    .map(([name, group]) => {
      const totals = sumRecords(group);
      return {
        name,
        fuelConsumedLitres: totals.fuelConsumedLitres,
        productionM3: totals.productionM3,
        distanceKm: totals.distanceKm,
        runningHours: totals.runningHours,
        idleHours: totals.idleHours,
        trips: totals.trips,
        efficiency: calculateFuelPerM3(totals.fuelConsumedLitres, totals.productionM3),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
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

function average(values: number[]): number | null {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}
