import { getAuthSession } from "../auth/sessionService";
import type { DashboardFilters } from "../types/fleet";
import type { ReportPreview } from "../types/reports";

const DEFAULT_API_BASE_URL = "https://cmll-fms-api.azurewebsites.net/api";
const API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");

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

export async function fetchVolvoDriverStandstillReport(filters: DashboardFilters): Promise<ReportPreview> {
  const session = getAuthSession();
  if (!session?.token) return errorPreview("Dashboard authentication is required.");

  const query = new URLSearchParams({
    date: filters.dateTo,
    shift: ["A", "B", "C"].includes(filters.shift) ? filters.shift : "A",
    site: !filters.siteId || filters.siteId === "All" ? "Gauri" : filters.siteId,
  });

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
    return isReportPreview(payload)
      ? payload
      : errorPreview("Volvo RFMS returned an invalid shift report.");
  } catch {
    return errorPreview("The Volvo RFMS shift report service could not be reached.");
  }
}
