import { getOperationalShiftPeriod } from "../utils/shiftResolver";
import { getAuthSession } from "../auth/sessionService";
import type { DashboardFilters } from "../types/fleet";
import type { ReportPreview } from "../types/reports";
import { buildVolvoDriverReportQuery } from "../utils/volvoDriverReportQuery";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api-b3-783.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const REPORT_CACHE_MS = 300_000;
export function invalidateVolvoReportCache() {
  for (const cached of reportCache.values()) cached.expiresAt = 0;
}
const retryAfterByReport = new Map<string, number>();
const reportCache = new Map<string, { expiresAt: number; preview: ReportPreview }>();
const inFlightReports = new Map<string, Promise<ReportPreview>>();

function errorPreview(message: string, status?: number): ReportPreview {
  return {
    reportType: "Driverwise Standstill Tracking",
    generatedAt: new Date().toISOString(),
    columns: ["status", "message"],
    rows: [],
    error: { kind: status === 429 ? "rate_limit" : "upstream", message, status, retryable: true },
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

  const token = session.token;
  const query = buildVolvoDriverReportQuery(filters);
  // Cache by the requested window, not its moving generation-time cutoff.
  const keyQuery = buildVolvoDriverReportQuery(filters, new Date(0));
  if (!keyQuery.has("startTime")) {
    const period = getOperationalShiftPeriod(keyQuery.get("site"), filters.dateTo, filters.shift);
    if (period) { keyQuery.set("startTime", `${period.dateFrom}T${period.timeFrom}:00+05:30`); keyQuery.set("stopTime", `${period.dateTo}T${period.timeTo}:00+05:30`); }
  }
  const cacheKey = `${token}|${keyQuery}`;
  const cached = reportCache.get(cacheKey);
  function rateLimitedPreview(retryAt: number): ReportPreview {
    const message = `Volvo is temporarily limiting requests. You can retry this report after ${new Date(retryAt).toLocaleTimeString()}.`;
    if (cached) {
      return {
        ...cached.preview,
        notice: [cached.preview.notice, message, `Showing the previous report generated at ${new Date(cached.preview.generatedAt).toLocaleString()}; its reporting period has not been updated.`].filter(Boolean).join(" "),
      };
    }
    return errorPreview(message, 429);
  }
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.preview;
  }
  // A throttled report must not hide another report already cached by the API.
  const retryAt = retryAfterByReport.get(cacheKey) || 0;
  if (retryAt > Date.now()) return rateLimitedPreview(retryAt);

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
          Authorization: `Bearer ${token}`,
        },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 429) {
          const bodyDelay = payload && typeof payload === "object" && "retryAfterSeconds" in payload
            ? Number(payload.retryAfterSeconds) * 1000 : NaN;
          const header = response.headers.get("Retry-After");
          const headerDelay = header === null ? NaN : Number.isFinite(Number(header))
            ? Number(header) * 1000 : Date.parse(header) - Date.now();
          const delay = Number.isFinite(bodyDelay) && bodyDelay > 0 ? bodyDelay
            : Number.isFinite(headerDelay) && headerDelay > 0 ? headerDelay : 60_000;
          const retryAt = Date.now() + delay;
          if (retryAfterByReport.size >= 64) retryAfterByReport.delete(retryAfterByReport.keys().next().value!);
          retryAfterByReport.set(cacheKey, retryAt);
          return rateLimitedPreview(retryAt);
        }
        const message = payload && typeof payload === "object" && "message" in payload
          ? String(payload.message)
          : "Volvo RFMS did not return the requested shift report.";
        return errorPreview(message, response.status);
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
