import { getAuthSession } from "../../auth/sessionService";
import type { FleetTelemetryRecord, IntegrationSource, Vehicle } from "../../types/fleet";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const CLIENT_CACHE_MS = 30_000;

export interface ScaniaLiveSnapshot {
  source: "SCANIA_RFMS_LIVE";
  fetchedAt: string;
  vehicles: Vehicle[];
  telemetry: FleetTelemetryRecord[];
  integration: IntegrationSource;
}

let cachedSnapshot: { expiresAt: number; value: ScaniaLiveSnapshot } | null = null;
let pendingSnapshot: Promise<ScaniaLiveSnapshot | null> | null = null;

function isScaniaSnapshot(value: unknown): value is ScaniaLiveSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ScaniaLiveSnapshot>;
  return snapshot.source === "SCANIA_RFMS_LIVE"
    && typeof snapshot.fetchedAt === "string"
    && Array.isArray(snapshot.vehicles)
    && Array.isArray(snapshot.telemetry)
    && Boolean(snapshot.integration);
}

export async function fetchScaniaLiveSnapshot(): Promise<ScaniaLiveSnapshot | null> {
  const session = getAuthSession();
  if (!session?.token) return null;
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return cachedSnapshot.value;
  if (pendingSnapshot) return pendingSnapshot;

  pendingSnapshot = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/scania/snapshot`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      if (!isScaniaSnapshot(payload)) return null;
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

export function invalidateScaniaLiveCache() {
  cachedSnapshot = null;
}

export async function refreshScaniaLiveData(): Promise<void> {
  const session = getAuthSession();
  if (!session?.token) throw new Error("Authentication required.");
  const response = await fetch(`${API_BASE_URL}/integrations/scania/refresh`, {
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
    throw new Error(payload?.error?.message || payload?.message || "Scania live data refresh failed.");
  }
  invalidateScaniaLiveCache();
}
