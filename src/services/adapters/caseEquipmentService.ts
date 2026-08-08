import { getAuthSession } from "../../auth/sessionService";
import type { IntegrationSource, Vehicle } from "../../types/fleet";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const CLIENT_CACHE_MS = 30_000;
export const CASE_EQUIPMENT_SOURCE = "CASE_EQUIPMENT_LIVE" as const;

export interface CaseEquipmentDevice {
  type: string | null;
  serialNumber: string | null;
}

export interface CaseEquipment {
  vin: string | null;
  companyName: string | null;
  companyId: string | null;
  brand: string | null;
  model: string | null;
  productLine: string | null;
  productType: string | null;
  devices: CaseEquipmentDevice[];
}

export interface CaseEquipmentSnapshot {
  source: typeof CASE_EQUIPMENT_SOURCE;
  fetchedAt: string;
  equipment: CaseEquipment[];
  vehicles: Vehicle[];
  integration: IntegrationSource;
}

let cachedSnapshot: { expiresAt: number; value: CaseEquipmentSnapshot } | null = null;
let pendingSnapshot: Promise<CaseEquipmentSnapshot | null> | null = null;

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeEquipment(value: unknown): CaseEquipment | null {
  const record = objectValue(value);
  if (!record) return null;
  const devices = Array.isArray(record.devices)
    ? record.devices.flatMap((device) => {
      const item = objectValue(device);
      return item ? [{
        type: textValue(item.type),
        serialNumber: textValue(item.serialNumber),
      }] : [];
    })
    : [];
  return {
    vin: textValue(record.vin),
    companyName: textValue(record.companyName),
    companyId: textValue(record.companyId),
    brand: textValue(record.brand),
    model: textValue(record.model),
    productLine: textValue(record.productLine),
    productType: textValue(record.productType),
    devices,
  };
}

function normalizePayload(value: unknown): CaseEquipment[] | null {
  const payload = objectValue(value);
  if (!payload || !Array.isArray(payload.equipment)) return null;
  return payload.equipment.flatMap((equipment) => {
    const normalized = normalizeEquipment(equipment);
    return normalized ? [normalized] : [];
  });
}

function toVehicle(equipment: CaseEquipment): Vehicle | null {
  if (!equipment.vin) return null;
  return {
    id: `case-equipment-${equipment.vin}`,
    vehicleNumber: equipment.vin,
    source: CASE_EQUIPMENT_SOURCE,
    assetCategory: "Unknown",
    assetType: null,
    company: "Case",
    modelNumber: equipment.model,
    capacityM3: null,
    fuelMeasurementUnit: "Unknown",
    trackerProvider: "CASE Equipment API",
    trackerId: equipment.vin,
    siteId: null,
    siteName: null,
    contractType: null,
    status: "unknown",
    commissioningDate: null,
    fuelTankCapacityLitres: null,
    standardFuelNorm: null,
    active: true,
  };
}

function buildSnapshot(equipment: CaseEquipment[]): CaseEquipmentSnapshot {
  const fetchedAt = new Date().toISOString();
  const vehicles = equipment.flatMap((item) => {
    const vehicle = toVehicle(item);
    return vehicle ? [vehicle] : [];
  });
  return {
    source: CASE_EQUIPMENT_SOURCE,
    fetchedAt,
    equipment,
    vehicles,
    integration: {
      id: "live-integration-case",
      company: "Case",
      sourceType: "API",
      status: "connected",
      lastSyncAt: fetchedAt,
      nextSyncAt: null,
      recordsSyncedToday: equipment.length,
    },
  };
}

export function defaultCaseIntegration(): IntegrationSource {
  return {
    id: "live-integration-case",
    company: "Case",
    sourceType: "API",
    status: "failed",
    lastSyncAt: null,
    nextSyncAt: null,
    recordsSyncedToday: 0,
    errorMessage: "CASE data unavailable",
  };
}

export async function fetchCaseEquipmentSnapshot(
  options: { forceRefresh?: boolean } = {},
): Promise<CaseEquipmentSnapshot | null> {
  const session = getAuthSession();
  if (!session?.token) return null;
  if (!options.forceRefresh && cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) {
    return cachedSnapshot.value;
  }
  if (pendingSnapshot) return pendingSnapshot;

  pendingSnapshot = (async () => {
    try {
      const query = options.forceRefresh ? "?refresh=true" : "";
      const response = await fetch(`${API_BASE_URL}/case/equipment${query}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      const equipment = normalizePayload(payload);
      if (!equipment) return null;
      const snapshot = buildSnapshot(equipment);
      cachedSnapshot = { expiresAt: Date.now() + CLIENT_CACHE_MS, value: snapshot };
      return snapshot;
    } catch {
      return null;
    } finally {
      pendingSnapshot = null;
    }
  })();

  return pendingSnapshot;
}

export function invalidateCaseEquipmentCache() {
  cachedSnapshot = null;
}

export async function refreshCaseEquipmentData(): Promise<void> {
  invalidateCaseEquipmentCache();
  const snapshot = await fetchCaseEquipmentSnapshot({ forceRefresh: true });
  if (!snapshot) throw new Error("CASE data unavailable");
}
