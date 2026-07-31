import { getAuthSession } from "../auth/sessionService";
import type { DashboardFilters } from "../types/fleet";
import type { ReportPreview } from "../types/reports";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const REPORT_CACHE_MS = 5 * 60_000;
const reportCache = new Map<string, { expiresAt: number; preview: ReportPreview }>();
const inFlightReports = new Map<string, Promise<ReportPreview>>();

function selectedCompany(filters: DashboardFilters) {
  return filters.company && filters.company !== "All" ? filters.company : "Volvo";
}

function errorPreview(message: string, company = "Volvo"): ReportPreview {
  return {
    reportType: "Driverwise Standstill Tracking",
    generatedAt: new Date().toISOString(),
    columns: ["status", "message"],
    rows: [{ status: `Live ${company} data unavailable`, message }],
    oem: company,
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

function isScaniaReportRow(row: ReportPreview["rows"][number]) {
  const registration = String(
    row["Vehicles"]
    ?? row["Registration number"]
    ?? row.vehicle
    ?? "",
  ).trim();
  const rowCompany = String(
    row.company
    ?? row.oem
    ?? row.OEM
    ?? row.Company
    ?? "",
  ).trim().toLowerCase();

  if (rowCompany) {
    return rowCompany.includes("scania") && !rowCompany.includes("volvo");
  }
  return /^s(?:cania)?[\s_-]*\d+$/i.test(registration);
}

export async function fetchVolvoDriverStandstillReport(filters: DashboardFilters): Promise<ReportPreview> {
  const session = getAuthSession();
  const company = selectedCompany(filters);
  if (!session?.token) return errorPreview("Dashboard authentication is required.", company);

  const query = new URLSearchParams({
    date: filters.dateTo,
    shift: ["A", "B", "C"].includes(filters.shift) ? filters.shift : "A",
    site: !filters.siteId || filters.siteId === "All" ? "Gauri" : filters.siteId,
    company,
  });
  const cacheKey = query.toString();
  const cached = reportCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
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
          : `${company} RFMS did not return the requested shift report.`;
        return errorPreview(message, company);
      }
      if (!isReportPreview(payload)) {
        return errorPreview(`${company} RFMS returned an invalid shift report.`, company);
      }

      const scaniaSelected = company.trim().toLowerCase() === "scania";
      const rows = scaniaSelected ? payload.rows.filter(isScaniaReportRow) : payload.rows;
      const preview = {
        ...payload,
        rows,
        oem: company,
        notice: scaniaSelected && rows.length === 0
          ? "No Scania historical shift intervals were returned for the selected site and shift. Volvo and other OEM rows are excluded."
          : payload.notice,
      };
      reportCache.set(cacheKey, {
        expiresAt: Date.now() + REPORT_CACHE_MS,
        preview,
      });
      return preview;
    } catch {
      return errorPreview(`The ${company} RFMS shift report service could not be reached.`, company);
    } finally {
      inFlightReports.delete(cacheKey);
    }
  })();

  inFlightReports.set(cacheKey, request);
  return request;
}
