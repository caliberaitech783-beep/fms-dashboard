import { getOperationalShiftPeriod } from "../utils/shiftResolver";
import { getAuthSession } from "../auth/sessionService";
import type { DashboardFilters } from "../types/fleet";
import type { ReportPreview } from "../types/reports";
import { buildVolvoDriverReportQuery } from "../utils/volvoDriverReportQuery";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api-b3-783.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const REPORT_CACHE_MS = 60_000;
export function invalidateVolvoReportCache() { reportCache.clear(); }
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
  // Cache by the requested window, not its moving generation-time cutoff.
  const keyQuery = buildVolvoDriverReportQuery(filters, new Date(0));
  if (!keyQuery.has("startTime")) {
    const period = getOperationalShiftPeriod(keyQuery.get("site"), filters.dateTo, filters.shift);
    if (period) { keyQuery.set("startTime", `${period.dateFrom}T${period.timeFrom}:00+05:30`); keyQuery.set("stopTime", `${period.dateTo}T${period.timeTo}:00+05:30`); }
  }
  const cacheKey = `${session.token}|${keyQuery}`;
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
        signal: AbortSignal.timeout(60_000),
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
      if (payload.period && filters.timePeriodMode === "schedule") {
        payload.period.customTimeRange = false;
      }

      if (reportCache.size >= 64) reportCache.delete(reportCache.keys().next().value!);
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
