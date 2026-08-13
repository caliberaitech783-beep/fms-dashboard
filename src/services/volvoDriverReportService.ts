import { getAuthSession } from "../auth/sessionService";
import type { DashboardFilters } from "../types/fleet";
import type { ReportPreview } from "../types/reports";
import { buildVolvoDriverReportQuery } from "../utils/volvoDriverReportQuery";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const REPORT_CACHE_MS = 5 * 60_000;
const reportCache = new Map<string, { expiresAt: number; preview: ReportPreview }>();
const inFlightReports = new Map<string, Promise<ReportPreview>>();

function errorPreview(message: string): ReportPreview {
  return {
    reportType: "Driverwise Standstill Tracking",
    generatedAt: new Date().toISOString(),
    columns: ["status", "message"],
    rows: [{ status: "Live Volvo data unavailable", message }],
  };
}

function isReportPreview(value: unknown): value is ReportPreview {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ReportPreview>;
  return report.reportType === "Driverwise Standstill Tracking"
    && typeof report.generatedAt === "string"
    && Array.isArray(report.columns)
    && Array.isArray(report.rows);
}

export async function fetchVolvoDriverStandstillReport(
  filters: DashboardFilters,
  options: { forceRefresh?: boolean } = {},
): Promise<ReportPreview> {
  const session = getAuthSession();
  if (!session?.token) return errorPreview("Dashboard authentication is required.");

  const query = buildVolvoDriverReportQuery(filters);
  const cacheKey = query.toString();
  if (options.forceRefresh) {
    reportCache.delete(cacheKey);
  }
  const cached = reportCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.preview;
  }
  if (cached) {
    reportCache.delete(cacheKey);
  }

  const pendingReport = inFlightReports.get(cacheKey);
  if (pendingReport) {
    return pendingReport;
  }

  const request = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/volvo/driver-standstill?${query}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "message" in payload
          ? String(payload.message)
          : "Volvo RFMS did not return the requested shift report.";
        return errorPreview(message);
      }
      if (!isReportPreview(payload)) {
        return errorPreview("Volvo RFMS returned an invalid shift report.");
      }

      reportCache.set(cacheKey, {
        expiresAt: Date.now() + REPORT_CACHE_MS,
        preview: payload,
      });
      return payload;
    } catch {
      return errorPreview("The Volvo RFMS shift report service could not be reached.");
    } finally {
      inFlightReports.delete(cacheKey);
    }
  })();

  inFlightReports.set(cacheKey, request);
  return request;
}
