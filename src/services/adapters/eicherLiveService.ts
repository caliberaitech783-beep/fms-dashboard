import { getAuthSession } from "../../auth/sessionService";
import type { FleetTelemetryRecord, IntegrationSource, Vehicle } from "../../types/fleet";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const CLIENT_CACHE_MS = 30_000;

export interface EicherLiveSnapshot {
  source: "EICHER_VECV_LIVE";
  fetchedAt: string;
  vehicles: Vehicle[];
  telemetry: FleetTelemetryRecord[];
  integration: IntegrationSource;
  registry?: {
    total: number;
    mapped: number;
    unmapped: number;
    unmappedVins: string[];
  };
  meta?: {
    fieldsReceived?: string[];
    rawRecordCount?: number;
    lastSuccessfulUpdate?: string | null;
    apiErrors?: string[];
  };
}

let cachedSnapshot: { expiresAt: number; value: EicherLiveSnapshot } | null = null;
let pendingSnapshot: Promise<EicherLiveSnapshot | null> | null = null;

export function defaultEicherIntegration(): IntegrationSource {
  return {
    id: "live-integration-eicher",
    company: "Eicher",
    sourceType: "API",
    status: "not_configured",
    lastSyncAt: null,
    nextSyncAt: null,
    recordsSyncedToday: 0,
    errorMessage: "Backend Eicher VECV endpoint has not returned a snapshot yet.",
  };
}

function isEicherSnapshot(value: unknown): value is EicherLiveSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<EicherLiveSnapshot>;
  return snapshot.source === "EICHER_VECV_LIVE"
    && typeof snapshot.fetchedAt === "string"
    && Array.isArray(snapshot.vehicles)
    && Array.isArray(snapshot.telemetry)
    && Boolean(snapshot.integration);
}

export async function fetchEicherLiveSnapshot(): Promise<EicherLiveSnapshot | null> {
  const session = getAuthSession();
  if (!session?.token) return null;
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return cachedSnapshot.value;
  if (pendingSnapshot) return pendingSnapshot;

  pendingSnapshot = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/eicher/vehicles`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      if (!isEicherSnapshot(payload)) return null;
      cachedSnapshot = { expiresAt: Date.now() + CLIENT_CACHE_MS, value: payload };
      return payload;
    } catch {
      return null;
    } finally {
      pendingSnapshot = null;
    }
  })();

  return pendingSnapshot;
}

export function invalidateEicherLiveCache() {
  cachedSnapshot = null;
}

export async function refreshEicherLiveData(): Promise<void> {
  const session = getAuthSession();
  if (!session?.token) throw new Error("Authentication required.");
  const response = await fetch(`${API_BASE_URL}/integrations/eicher/refresh`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.token}`,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      error?: { message?: string };
      message?: string;
    } | null;
    throw new Error(payload?.error?.message || payload?.message || "Eicher live data refresh failed.");
  }
  invalidateEicherLiveCache();
}
