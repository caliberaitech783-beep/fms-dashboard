import type { FleetTelemetryRecord, Vehicle } from "../types/fleet";

export const EICHER_REPORT_COLUMNS: string[] = [
  "regNo",
  "chassisNo",
  "latitude",
  "longitude",
  "fuelType",
  "vehicleStatus",
  "lastUpdated",
  "epochTime",
  "vehicleSpeed",
  "odometer",
  "fuelLevelInPer",
  "fuelLevelInLtr",
  "defLevelInLtr",
  "lifeTimeFuelConsumtion",
  "engineOperatingHours",
];

export function buildEicherReportRow(
  vehicle: Vehicle,
  record: FleetTelemetryRecord | undefined,
): Record<string, string | number | null> {
  const raw = record?.rawMetrics ?? {};

  return {
    regNo: stringMetric(raw, "registrationNumber"),
    chassisNo: stringMetric(raw, "chassisNumber") ?? vehicle.trackerId,
    latitude: roundNullable(numberMetric(raw, "latitude"), 6),
    longitude: roundNullable(numberMetric(raw, "longitude"), 6),
    fuelType: stringMetric(raw, "fuelType"),
    vehicleStatus: stringMetric(raw, "vehicleStatus") ?? record?.status ?? vehicle.status,
    lastUpdated: scalarMetric(raw, "sourceLastUpdated"),
    epochTime: scalarMetric(raw, "sourceEpochTime"),
    vehicleSpeed: roundNullable(numberMetric(raw, "speedKph")),
    odometer: roundNullable(numberMetric(raw, "odometerKm") ?? record?.odometerKm),
    fuelLevelInPer: roundNullable(numberMetric(raw, "fuelLevelPercent") ?? record?.fuelLevelPercent),
    fuelLevelInLtr: roundNullable(numberMetric(raw, "fuelLevelLitres") ?? record?.fuelLevelLitres),
    defLevelInLtr: roundNullable(numberMetric(raw, "defLevelLitres")),
    lifeTimeFuelConsumtion: roundNullable(
      numberMetric(raw, "fuelConsumedLitres") ?? record?.fuelConsumedLitres,
    ),
    engineOperatingHours: roundNullable(numberMetric(raw, "engineHours") ?? record?.engineHours),
  };
}

function scalarMetric(metrics: Record<string, unknown>, key: string): string | number | null {
  const value = metrics[key];
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" || typeof value === "string" ? value : String(value);
}

function stringMetric(metrics: Record<string, unknown>, key: string): string | null {
  const value = metrics[key];
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || null;
}

function numberMetric(metrics: Record<string, unknown>, key: string): number | null {
  const value = metrics[key];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundNullable(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
