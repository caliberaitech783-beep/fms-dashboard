import { getAuthSession } from "../auth/sessionService";
import { SHIFT_DEFINITIONS } from "../constants/shifts";
import type { DashboardFilters, IntegrationSource } from "../types/fleet";
import type { ReportPreview } from "../types/reports";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const REPORT_CACHE_MS = 5 * 60_000;
const SCANIA_REPORT_COLUMNS = [
  "Registration number",
  "Drivers",
  "Engine running time (h:m)",
  "Distance driven (km)",
  "Consumption liquid fuel (km/l)",
  "Consumption liquid fuel (litres)",
  "Consumption liquid fuel (litres/h)",
  "Idling (% of engine running time)",
  "Idling (h:m)",
  "Performance mode - Power (km)",
  "Performance mode - Power (% of distance)",
  "Powertrain coasting (% of distance)",
];
const SCANIA_SHIFT_REPORT_COLUMNS = [
  "Shift",
  "Site",
  "Vehicles",
  "Fuel consumed (L)",
  "Distance (km)",
  "Running hours",
  "Idle hours",
  "Idle (%)",
  "Efficiency (km/L)",
  "Trips",
  "Production (m3)",
  "Coverage",
];

interface ScaniaReportRow {
  registrationNumber: string;
  vin: string;
  driverName: string;
  driverReference: string | null;
  engineRunningTime: string | null;
  distanceDrivenKm: number | null;
  fuelEconomyKmPerLitre: number | null;
  fuelConsumedLitres: number | null;
  fuelConsumptionLitresPerHour: number | null;
  idlingPercentage: number | null;
  idlingTime: string | null;
  performanceModePowerKm: number | null;
  performanceModePowerPercentage: number | null;
  powertrainCoastingPercentage: number | null;
  lastUpdatedAt: string | null;
}

interface ScaniaReportResponse {
  reportType: "Driverwise Standstill Tracking";
  source: string;
  generatedAt: string;
  rows: ScaniaReportRow[];
  period: NonNullable<ReportPreview["period"]>;
  meta: NonNullable<ReportPreview["meta"]>;
  notice?: string | null;
}

interface ScaniaShiftSummaryResponse {
  reportType: "Shift-wise Fuel Report";
  source: string;
  generatedAt: string;
  rows: Array<{
    shift: string;
    site: string;
    vehicles: number;
    fuelConsumedLitres: number | null;
    distanceKm: number | null;
    runningHours: number | null;
    idleHours: number | null;
    idlePercentage: number | null;
    efficiencyKmPerLitre: number | null;
    trips: number | null;
    productionM3: number | null;
    coverage: string;
  }>;
  period: NonNullable<ReportPreview["period"]>;
  meta: {
    apiVehicleCount?: number;
    apiStatusCount?: number;
    latestStatusCount?: number;
    vehicleMasterCount?: number;
    matchedVehicleCount?: number;
    eventDates?: string[];
    emptyReason?: string | null;
  };
}

interface ScaniaErrorResponse {
  error?: {
    kind?: ReportPreview["error"] extends infer T
      ? T extends { kind: infer K } ? K : never
      : never;
    message?: string;
    retryable?: boolean;
  };
}

const reportCache = new Map<string, { expiresAt: number; preview: ReportPreview }>();
const inFlightReports = new Map<string, Promise<ReportPreview>>();
type ScaniaShift = "A" | "B" | "C";

function siteName(siteId: string) {
  const normalized = siteId.trim().toLowerCase();
  if (["site-wcl-sasti-ocm", "sasti ocm", "sasti"].includes(normalized)) {
    return "Sasti OCM";
  }
  if (["site-ncl-dch-west", "dch west", "dudhichua singrauli"].includes(normalized)) {
    return "DCH West";
  }
  if (["site-ncl-dch-east", "dch east"].includes(normalized)) {
    return "DCH East";
  }
  return siteId === "All" || !siteId ? null : siteId;
}

function isScaniaShift(value: DashboardFilters["shift"]): value is ScaniaShift {
  return value === "A" || value === "B" || value === "C";
}

function addCalendarDays(dateText: string, days: number) {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateText;
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
  ));
  return date.toISOString().slice(0, 10);
}

export function scaniaShiftWindow(date: string, shift: ScaniaShift) {
  const definition = SHIFT_DEFINITIONS[shift];
  const stopDate = addCalendarDays(date, shift === "C" ? 1 : 0);
  return {
    startTime: `${date}T${definition.start}:00+05:30`,
    stopTime: `${stopDate}T${definition.end}:00+05:30`,
  };
}

function reportPeriod(filters: DashboardFilters): NonNullable<ReportPreview["period"]> {
  const date = filters.dateTo;
  const window = isScaniaShift(filters.shift)
    ? scaniaShiftWindow(date, filters.shift)
    : {
      startTime: `${date}T00:00:00+05:30`,
      stopTime: `${date}T23:59:59+05:30`,
    };
  return {
    date,
    shift: filters.shift,
    site: siteName(filters.siteId) ?? "All Sites",
    start: window.startTime,
    end: window.stopTime,
    timezone: "Asia/Kolkata",
  };
}

function errorPreview(
  filters: DashboardFilters,
  kind: NonNullable<ReportPreview["error"]>["kind"],
  message: string,
  options: { retryable?: boolean; status?: number } = {},
): ReportPreview {
  return {
    reportType: "Driverwise Standstill Tracking",
    generatedAt: new Date().toISOString(),
    columns: SCANIA_REPORT_COLUMNS,
    rows: [],
    oem: "Scania",
    live: false,
    source: "SCANIA_LIVE_API",
    period: reportPeriod(filters),
    error: {
      kind,
      message,
      retryable: options.retryable,
      status: options.status,
    },
  };
}

function isScaniaReportResponse(value: unknown): value is ScaniaReportResponse {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ScaniaReportResponse>;
  return report.reportType === "Driverwise Standstill Tracking"
    && typeof report.generatedAt === "string"
    && Array.isArray(report.rows)
    && Boolean(report.period)
    && Boolean(report.meta);
}

function isScaniaShiftSummaryResponse(value: unknown): value is ScaniaShiftSummaryResponse {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ScaniaShiftSummaryResponse>;
  return report.reportType === "Shift-wise Fuel Report"
    && typeof report.generatedAt === "string"
    && Array.isArray(report.rows)
    && Boolean(report.period)
    && Boolean(report.meta);
}

function displayRow(row: ScaniaReportRow): ReportPreview["rows"][number] {
  return {
    "Registration number": row.registrationNumber,
    "Drivers": row.driverName || "Unknown",
    "Engine running time (h:m)": row.engineRunningTime,
    "Distance driven (km)": row.distanceDrivenKm,
    "Consumption liquid fuel (km/l)": row.fuelEconomyKmPerLitre,
    "Consumption liquid fuel (litres)": row.fuelConsumedLitres,
    "Consumption liquid fuel (litres/h)": row.fuelConsumptionLitresPerHour,
    "Idling (% of engine running time)": row.idlingPercentage,
    "Idling (h:m)": row.idlingTime,
    "Performance mode - Power (km)": row.performanceModePowerKm,
    "Performance mode - Power (% of distance)": row.performanceModePowerPercentage,
    "Powertrain coasting (% of distance)": row.powertrainCoastingPercentage,
  };
}

type ScaniaRequestResult =
  | { error: ReportPreview; body?: never }
  | {
    error?: never;
    body: {
      site: string;
      shift: string;
      startTime: string;
      stopTime: string;
    };
  };

function scaniaRequest(filters: DashboardFilters): ScaniaRequestResult {
  const mappedSite = siteName(filters.siteId);
  if (!mappedSite) {
    return {
      error: errorPreview(
        filters,
        "mapping",
        "Select Sasti OCM, DCH West, or DCH East to generate a site-wise Scania report.",
      ),
    };
  }
  if (!isScaniaShift(filters.shift)) {
    return {
      error: errorPreview(
        filters,
        "mapping",
        "Select Shift A, Shift B, or Shift C for this Scania site report.",
      ),
    };
  }
  const date = filters.dateTo;
  const window = scaniaShiftWindow(date, filters.shift);
  return {
    body: {
      site: mappedSite,
      shift: filters.shift,
      startTime: window.startTime,
      stopTime: window.stopTime,
    },
  };
}

export function invalidateScaniaReportCache() {
  reportCache.clear();
}

export async function fetchScaniaDriverStandstillReport(
  filters: DashboardFilters,
  options: { forceRefresh?: boolean } = {},
): Promise<ReportPreview> {
  const session = getAuthSession();
  if (!session?.token) {
    return errorPreview(filters, "portal_authentication", "Dashboard authentication is required.");
  }

  const request = scaniaRequest(filters);
  if (request.error) return request.error;

  const cacheKey = JSON.stringify(request.body);
  if (options.forceRefresh) {
    reportCache.delete(cacheKey);
  } else {
    const cached = reportCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.preview;
    if (cached) reportCache.delete(cacheKey);
  }

  const pending = inFlightReports.get(cacheKey);
  if (pending) return pending;

  const reportRequest = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/scania/reports/vehicle-evaluation`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const details = payload && typeof payload === "object"
          ? (payload as ScaniaErrorResponse).error
          : null;
        return errorPreview(
          filters,
          details?.kind ?? "upstream",
          details?.message ?? "Scania live report request failed.",
          { retryable: details?.retryable, status: response.status },
        );
      }
      if (!isScaniaReportResponse(payload)) {
        return errorPreview(
          filters,
          "upstream",
          "Scania returned an invalid Vehicle Evaluation report response.",
          { status: response.status },
        );
      }

      const preview: ReportPreview = {
        reportType: payload.reportType,
        generatedAt: payload.generatedAt,
        columns: SCANIA_REPORT_COLUMNS,
        rows: payload.rows.map(displayRow),
        oem: "Scania",
        live: true,
        source: payload.source,
        period: payload.period,
        meta: payload.meta,
        notice: payload.notice ?? payload.meta.emptyReason ?? null,
      };
      reportCache.set(cacheKey, {
        expiresAt: Date.now() + REPORT_CACHE_MS,
        preview,
      });
      return preview;
    } catch {
      return errorPreview(
        filters,
        "network",
        "The Scania live report service could not be reached.",
        { retryable: true },
      );
    } finally {
      inFlightReports.delete(cacheKey);
    }
  })();

  inFlightReports.set(cacheKey, reportRequest);
  return reportRequest;
}

function scaniaShiftRequest(filters: DashboardFilters): ScaniaRequestResult {
  const mappedSite = siteName(filters.siteId);
  const allSites = filters.siteId === "All" || !filters.siteId;
  if (!mappedSite && !allSites) {
    return {
      error: {
        ...errorPreview(
          filters,
          "mapping",
          "Select All Sites, Sasti OCM, DCH West, or DCH East for the Scania shift report.",
        ),
        reportType: "Shift-wise Fuel Report",
        columns: SCANIA_SHIFT_REPORT_COLUMNS,
      },
    };
  }
  if (!isScaniaShift(filters.shift)) {
    return {
      error: {
        ...errorPreview(
          filters,
          "mapping",
          "Select Shift A, Shift B, or Shift C for this Scania shift report.",
        ),
        reportType: "Shift-wise Fuel Report",
        columns: SCANIA_SHIFT_REPORT_COLUMNS,
      },
    };
  }
  const window = scaniaShiftWindow(filters.dateTo, filters.shift);
  return {
    body: {
      site: mappedSite ?? "All Sites",
      shift: filters.shift,
      startTime: window.startTime,
      stopTime: window.stopTime,
    },
  };
}

export async function fetchScaniaShiftSummaryReport(
  filters: DashboardFilters,
  options: { forceRefresh?: boolean } = {},
): Promise<ReportPreview> {
  const session = getAuthSession();
  if (!session?.token) {
    return {
      ...errorPreview(filters, "portal_authentication", "Dashboard authentication is required."),
      reportType: "Shift-wise Fuel Report",
      columns: SCANIA_SHIFT_REPORT_COLUMNS,
    };
  }

  const request = scaniaShiftRequest(filters);
  if (request.error) {
    return {
      ...request.error,
      reportType: "Shift-wise Fuel Report",
      columns: SCANIA_SHIFT_REPORT_COLUMNS,
    };
  }

  const cacheKey = `shift:${JSON.stringify(request.body)}`;
  if (options.forceRefresh) {
    reportCache.delete(cacheKey);
  } else {
    const cached = reportCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.preview;
    if (cached) reportCache.delete(cacheKey);
  }
  const pending = inFlightReports.get(cacheKey);
  if (pending) return pending;

  const reportRequest = (async () => {
    try {
      let response: Response | null = null;
      let payload: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch(`${API_BASE_URL}/scania/reports/shift-summary`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${session.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request.body),
        });
        payload = await response.json().catch(() => null);
        if (response.ok) break;
        const details = payload && typeof payload === "object"
          ? (payload as ScaniaErrorResponse).error
          : null;
        const retryable = Boolean(details?.retryable || [502, 503, 504].includes(response.status));
        if (!retryable || attempt === 1) {
          return {
            ...errorPreview(
              filters,
              details?.kind ?? "upstream",
              details?.message ?? "Scania live shift report request failed.",
              { retryable, status: response.status },
            ),
            reportType: "Shift-wise Fuel Report" as const,
            columns: SCANIA_SHIFT_REPORT_COLUMNS,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 1_200));
      }
      if (!response) throw new Error("Scania shift report request did not start.");
      if (!isScaniaShiftSummaryResponse(payload)) {
        return {
          ...errorPreview(
            filters,
            "upstream",
            "Scania returned an invalid shift-summary response.",
            { status: response.status },
          ),
          reportType: "Shift-wise Fuel Report" as const,
          columns: SCANIA_SHIFT_REPORT_COLUMNS,
        };
      }

      const eventDateText = payload.meta.eventDates?.length
        ? ` Snapshot shift date${payload.meta.eventDates.length === 1 ? "" : "s"}: ${payload.meta.eventDates.join(", ")}.`
        : "";
      const preview: ReportPreview = {
        reportType: payload.reportType,
        generatedAt: payload.generatedAt,
        columns: SCANIA_SHIFT_REPORT_COLUMNS,
        rows: payload.rows.map((row) => ({
          Shift: `Shift ${row.shift}`,
          Site: row.site,
          Vehicles: row.vehicles,
          "Fuel consumed (L)": row.fuelConsumedLitres,
          "Distance (km)": row.distanceKm,
          "Running hours": row.runningHours,
          "Idle hours": row.idleHours,
          "Idle (%)": row.idlePercentage,
          "Efficiency (km/L)": row.efficiencyKmPerLitre,
          Trips: row.trips,
          "Production (m3)": row.productionM3,
          Coverage: row.coverage,
        })),
        oem: "Scania",
        live: true,
        source: payload.source,
        period: payload.period,
        meta: {
          rawRecordCount: payload.meta.apiStatusCount ?? null,
          finalFilteredVehicleCount: payload.meta.matchedVehicleCount ?? null,
          siteVehicleMasterCount: payload.meta.vehicleMasterCount ?? null,
          emptyReason: payload.meta.emptyReason ?? null,
        },
        notice: payload.meta.emptyReason
          ?? `Latest cumulative Scania RFMS snapshots are assigned by imported site and Asia/Kolkata event time.${eventDateText}`,
      };
      reportCache.set(cacheKey, { expiresAt: Date.now() + REPORT_CACHE_MS, preview });
      return preview;
    } catch {
      return {
        ...errorPreview(
          filters,
          "network",
          "The Scania live shift report service could not be reached.",
          { retryable: true },
        ),
        reportType: "Shift-wise Fuel Report" as const,
        columns: SCANIA_SHIFT_REPORT_COLUMNS,
      };
    } finally {
      inFlightReports.delete(cacheKey);
    }
  })();

  inFlightReports.set(cacheKey, reportRequest);
  return reportRequest;
}

export async function fetchScaniaIntegrationStatus(): Promise<IntegrationSource> {
  const fallback: IntegrationSource = {
    id: "live-integration-scania",
    company: "Scania",
    sourceType: "API",
    status: "failed",
    lastSyncAt: null,
    nextSyncAt: null,
    recordsSyncedToday: 0,
    errorMessage: "Scania live API is not connected.",
  };
  const session = getAuthSession();
  if (!session?.token) {
    return { ...fallback, status: "not_configured", errorMessage: "Dashboard authentication is required." };
  }
  try {
    const response = await fetch(`${API_BASE_URL}/scania/snapshot`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object" || !("integration" in payload)) {
      const details = payload && typeof payload === "object"
        ? (payload as ScaniaErrorResponse).error
        : null;
      return {
        ...fallback,
        status: details?.kind === "configuration" ? "not_configured" : "failed",
        errorMessage: details?.message ?? `Scania status check failed (HTTP ${response.status}).`,
      };
    }
    return (payload as { integration: IntegrationSource }).integration;
  } catch {
    return fallback;
  }
}
