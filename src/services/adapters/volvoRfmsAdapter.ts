import { getAuthSession } from "../../auth/sessionService";
import type { FleetTelemetryRecord, IntegrationSource, Vehicle, VehicleStatus } from "../../types/fleet";
import type { FleetDataAdapter } from "../../types/integrations";
import { fetchScaniaIntegrationStatus } from "../scaniaReportService";
import { mockAdapter } from "./mockAdapter";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const LIVE_SOURCE = "VOLVO_RFMS_LIVE";
const CLIENT_CACHE_MS = 30_000;

type MovementState = "MOVING" | "STANDSTILL" | "PARKED" | "STOPPED_UNKNOWN_IGNITION" | "UNKNOWN";

interface LiveVolvoVehicle {
  vin: string;
  displayVin?: string | null;
  eventType: string;
  eventContext: string | null;
  eventTime: string;
  receivedTime: string;
  odometerKm: number | null;
  engineHours: number | null;
  totalFuelLitres: number | null;
  grossWeightKg: number | null;
  maskedDriverId: string | null;
  driverName?: string | null;
  driverMobile?: string | null;
  driverTime?: {
    activityCount: number;
    dtjActivityCount: number;
  } | null;
  ignitionState: "ON" | "OFF" | "UNKNOWN";
  movementState: MovementState;
  speedKph: number | null;
  fuelPercent: number | null;
  adBluePercent: number | null;
  ambientTemperatureC: number | null;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  altitudeMetres: number | null;
  positionTime: string | null;
  lifetimeStandstillSeconds: number | null;
  lifetimeStandstillFuelLitres: number | null;
  lifetimeRunningSeconds: number | null;
  lifetimeRunningFuelLitres: number | null;
  currentStandstillStartedAt: string | null;
  currentStandstillSeconds: number | null;
  dataAgeSeconds: number | null;
  locationAgeSeconds: number | null;
  isStale: boolean;
  freshness?: {
    state: "fresh" | "delayed" | "stale" | "no-data";
    ageMinutes: number | null;
  };
  eventHistory: Array<Record<string, string | null>>;
  master: {
    vehicleNumber: string;
    model: string | null;
    siteId: string | null;
    siteName: string | null;
    contractType: "Coal" | "OB" | null;
    commissioningDate: string | null;
  } | null;
}

interface LiveVolvoResponse {
  vehicles: LiveVolvoVehicle[];
  summary: {
    total: number;
    moving: number;
    standstill: number;
    parked: number;
    unknown: number;
    stale: number;
  };
  meta: {
    fetchedAt: string;
    lastSuccessfulSyncAt: string | null;
    refreshSeconds?: number;
  };
  sync?: {
    status: "healthy" | "degraded" | "error";
    positionsLastSyncedAt: string | null;
    statusLastSyncedAt: string | null;
  };
}

interface VolvoSnapshot {
  source: typeof LIVE_SOURCE;
  fetchedAt: string;
  vehicles: Vehicle[];
  telemetry: FleetTelemetryRecord[];
  integration: IntegrationSource;
}

let cachedSnapshot: { expiresAt: number; value: VolvoSnapshot } | null = null;
let pendingSnapshot: Promise<VolvoSnapshot | null> | null = null;

function portalStatus(vehicle: LiveVolvoVehicle): VehicleStatus {
  if (vehicle.isStale) return "offline";
  if (vehicle.movementState === "MOVING") return "running";
  if (vehicle.movementState === "STANDSTILL") return "idle";
  if (vehicle.movementState === "PARKED") return "stopped";
  return "unknown";
}

function toPortalVehicle(live: LiveVolvoVehicle): Vehicle {
  return {
    id: `volvo-rfms-${live.vin}`,
    vehicleNumber: live.master?.vehicleNumber || live.vin,
    source: LIVE_SOURCE,
    assetCategory: "Truck",
    assetType: "Truck",
    company: "Volvo",
    modelNumber: live.master?.model || null,
    capacityM3: null,
    fuelMeasurementUnit: "km/L",
    trackerProvider: "Volvo RFMS",
    trackerId: live.vin,
    siteId: live.master?.siteId || null,
    siteName: live.master?.siteName || null,
    contractType: live.master?.contractType || null,
    status: portalStatus(live),
    commissioningDate: live.master?.commissioningDate || null,
    fuelTankCapacityLitres: null,
    standardFuelNorm: null,
    active: true,
  };
}

function toTelemetry(live: LiveVolvoVehicle, vehicle: Vehicle): FleetTelemetryRecord {
  const runningHours = live.lifetimeRunningSeconds === null ? null : live.lifetimeRunningSeconds / 3600;
  const idleHours = live.lifetimeStandstillSeconds === null ? null : live.lifetimeStandstillSeconds / 3600;
  const availableHours = runningHours !== null || idleHours !== null
    ? (runningHours ?? 0) + (idleHours ?? 0)
    : null;
  const distanceKm = live.odometerKm;
  const fuelConsumedLitres = live.totalFuelLitres;
  const truckEfficiencyKmPerLitre = distanceKm !== null && fuelConsumedLitres !== null && fuelConsumedLitres > 0
    ? distanceKm / fuelConsumedLitres
    : null;
  const idlePercentage = idleHours !== null && availableHours !== null && availableHours > 0
    ? idleHours / availableHours * 100
    : null;
  const runningPercentage = runningHours !== null && availableHours !== null && availableHours > 0
    ? runningHours / availableHours * 100
    : null;
  return {
    id: `volvo-live-${live.vin}-${new Date(live.eventTime).getTime()}`,
    source: LIVE_SOURCE,
    vehicleId: vehicle.id,
    vehicleNumber: vehicle.vehicleNumber,
    driverId: live.maskedDriverId,
    driverName: live.driverName,
    driverMobile: live.driverMobile,
    trackerId: live.vin,
    timestamp: live.eventTime,
    date: live.eventTime.slice(0, 10),
    shift: "UNKNOWN",
    siteId: vehicle.siteId,
    siteName: vehicle.siteName || null,
    assetCategory: vehicle.assetCategory,
    assetType: vehicle.assetType,
    company: vehicle.company,
    modelNumber: vehicle.modelNumber,
    location: live.latitude !== null && live.longitude !== null ? `${live.latitude}, ${live.longitude}` : null,
    odometerKm: live.odometerKm,
    distanceKm,
    engineHours: live.engineHours,
    runningHours,
    idleHours,
    stoppedHours: null,
    offlineHours: live.isStale && live.dataAgeSeconds !== null ? live.dataAgeSeconds / 3600 : 0,
    availableHours,
    fuelConsumedLitres,
    fuelFilledLitres: null,
    fuelLevelLitres: null,
    fuelLevelPercent: live.fuelPercent,
    trips: null,
    capacityM3: null,
    productionM3: null,
    leadKm: null,
    status: vehicle.status,
    truckEfficiencyKmPerLitre,
    hemmFuelRateLitrePerHour: null,
    fuelPerTrip: null,
    fuelPerM3: null,
    idlePercentage,
    runningPercentage,
    utilizationPercentage: null,
    rawMetrics: {
      vin: live.vin,
      eventType: live.eventType,
      eventContext: live.eventContext,
      eventTime: live.eventTime,
      receivedTime: live.receivedTime,
      ignitionState: live.ignitionState,
      movementState: live.movementState,
      speedKph: live.speedKph,
      fuelPercent: live.fuelPercent,
      adBluePercent: live.adBluePercent,
      ambientTemperatureC: live.ambientTemperatureC,
      latitude: live.latitude,
      longitude: live.longitude,
      heading: live.heading,
      altitudeMetres: live.altitudeMetres,
      positionTime: live.positionTime,
      currentStandstillStartedAt: live.currentStandstillStartedAt,
      currentStandstillSeconds: live.currentStandstillSeconds,
      lifetimeStandstillSeconds: live.lifetimeStandstillSeconds,
      lifetimeStandstillFuelLitres: live.lifetimeStandstillFuelLitres,
      lifetimeRunningSeconds: live.lifetimeRunningSeconds,
      lifetimeRunningHours: runningHours,
      lifetimeRunningFuelLitres: live.lifetimeRunningFuelLitres,
      lifetimeIdleHours: idleHours,
      lifetimeEfficiencyKmPerLitre: truckEfficiencyKmPerLitre,
      lifetimeOdometerKm: live.odometerKm,
      lifetimeEngineHours: live.engineHours,
      lifetimeFuelLitres: live.totalFuelLitres,
      grossWeightKg: live.grossWeightKg,
      maskedDriverId: live.maskedDriverId,
      driverName: live.driverName,
      driverTimeActivityCount: live.driverTime?.activityCount ?? null,
      driverTimeDtjActivityCount: live.driverTime?.dtjActivityCount ?? null,
      dataAgeSeconds: live.dataAgeSeconds,
      freshnessState: live.freshness?.state ?? "no-data",
      freshnessAgeMinutes: live.freshness?.ageMinutes ?? null,
      locationAgeSeconds: live.locationAgeSeconds,
      isStale: live.isStale,
      eventHistory: live.eventHistory,
    },
  };
}

function normalizeResponse(payload: LiveVolvoResponse): VolvoSnapshot {
  const vehicles = payload.vehicles.map(toPortalVehicle);
  const vehicleByVin = new Map(vehicles.map((vehicle) => [vehicle.trackerId, vehicle]));
  const telemetry = payload.vehicles.map((live) => toTelemetry(live, vehicleByVin.get(live.vin)!));
  const lastSyncAt = payload.meta.lastSuccessfulSyncAt || payload.meta.fetchedAt;
  return {
    source: LIVE_SOURCE,
    fetchedAt: payload.meta.fetchedAt,
    vehicles,
    telemetry,
    integration: {
      id: "live-integration-volvo",
      company: "Volvo",
      sourceType: "API",
      status: payload.sync?.status === "healthy" ? "connected" : "delayed",
      lastSyncAt,
      nextSyncAt: new Date(new Date(lastSyncAt).getTime() + (payload.meta.refreshSeconds || 30) * 1000).toISOString(),
      recordsSyncedToday: payload.vehicles.length,
      errorMessage: payload.sync?.status === "healthy" ? undefined : "Latest Volvo synchronization is delayed.",
    },
  };
}

function isLiveResponse(value: unknown): value is LiveVolvoResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<LiveVolvoResponse>;
  return Array.isArray(response.vehicles)
    && Boolean(response.meta?.fetchedAt)
    && typeof response.summary?.total === "number";
}

async function fetchLiveSnapshot(): Promise<VolvoSnapshot | null> {
  const session = getAuthSession();
  if (!session?.token) return null;
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return cachedSnapshot.value;
  if (pendingSnapshot) return pendingSnapshot;

  pendingSnapshot = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/vehicles/live`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      if (!isLiveResponse(payload)) return null;
      const snapshot = normalizeResponse(payload);
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

export function invalidateVolvoLiveCache() {
  cachedSnapshot = null;
}

export async function refreshVolvoLiveData(): Promise<void> {
  const session = getAuthSession();
  if (!session?.token) throw new Error("Authentication required.");
  const response = await fetch(`${API_BASE_URL}/integrations/volvo/refresh`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.token}`,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || "Volvo live data refresh failed.");
  }
  invalidateVolvoLiveCache();
}

async function mockVehicleContext() {
  const vehicles = await mockAdapter.fetchVehicles();
  const nonVolvoVehicles = vehicles.filter((vehicle) => (
    vehicle.company !== "Volvo" && vehicle.company !== "Scania"
  ));
  return {
    nonVolvoVehicles,
    nonVolvoIds: new Set(nonVolvoVehicles.map((vehicle) => vehicle.id)),
  };
}

async function liveAwareTelemetry(): Promise<FleetTelemetryRecord[]> {
  const [snapshot, records, context] = await Promise.all([
    fetchLiveSnapshot(),
    mockAdapter.fetchTelemetry(),
    mockVehicleContext(),
  ]);
  const nonVolvoRecords = records.filter((record) => context.nonVolvoIds.has(record.vehicleId));
  return snapshot ? [...nonVolvoRecords, ...snapshot.telemetry] : nonVolvoRecords;
}

export const volvoRfmsAdapter: FleetDataAdapter = {
  fetchSites: () => mockAdapter.fetchSites(),

  async fetchVehicles() {
    const [snapshot, context] = await Promise.all([fetchLiveSnapshot(), mockVehicleContext()]);
    return snapshot ? [...context.nonVolvoVehicles, ...snapshot.vehicles] : context.nonVolvoVehicles;
  },

  fetchTelemetry: liveAwareTelemetry,
  async fetchFuel() {
    return (await liveAwareTelemetry()).filter((record) => record.fuelConsumedLitres !== null);
  },
  async fetchTrips() {
    return (await liveAwareTelemetry()).filter((record) => record.trips !== null);
  },
  async fetchIntegrations() {
    const [snapshot, scaniaIntegration, integrations] = await Promise.all([
      fetchLiveSnapshot(),
      fetchScaniaIntegrationStatus(),
      mockAdapter.fetchIntegrations(),
    ]);
    return integrations.map((integration) => {
      if (integration.company === "Volvo" && snapshot) return snapshot.integration;
      if (integration.company === "Scania") return scaniaIntegration;
      return integration;
    });
  },
  fetchReports: () => mockAdapter.fetchReports(),
  fetchWhatsAppSchedules: () => mockAdapter.fetchWhatsAppSchedules(),
  fetchWhatsAppDeliveryLogs: () => mockAdapter.fetchWhatsAppDeliveryLogs(),
  normalizeVehicle: (payload) => mockAdapter.normalizeVehicle(payload),
  normalizeTelemetry: (payload) => mockAdapter.normalizeTelemetry(payload),
};
