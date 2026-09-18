import { getAuthSession } from "../auth/sessionService";
import type { DashboardFilters, Vehicle, IntegrationSource } from "../types/fleet";
import type { ReportPreview, ReportType } from "../types/reports";
import { filterVehicles } from "../utils/filters";
import { getWorkbookModelName } from "../constants/modelMake";
const base = (import.meta.env.VITE_AUTH_API_BASE_URL ?? "https://cmll-fms-api-b3-783.azurewebsites.net/api").replace(/\/$/, "");
interface DailyRow { serialNumber: string; engineHours: number | null; workingHours: number | null;
  idleHours: number | null; fuelLitres: number | null; fuelRate: number | null;
  idlePercent: number | null; workPercent: number | null; daysReported: number; lastSyncAt: string | null }
interface Payload { vehicles: Vehicle[]; rows?: DailyRow[]; notice?: string; generatedAt?: string; integration?: IntegrationSource }
async function request(query = ""): Promise<Payload> {
  const token = getAuthSession()?.token;
  if (!token) throw new Error("Dashboard authentication is required.");
  const response = await fetch(`${base}/integrations/liugong/vehicles${query}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("LiuGong records could not be loaded.");
  return response.json() as Promise<Payload>;
}
export async function fetchLiuGongVehicles(): Promise<Vehicle[]> {
  try { return (await request()).vehicles; } catch { return []; }
}
export async function fetchLiuGongIntegration(): Promise<IntegrationSource> {
  const fallback: IntegrationSource = { id: "liugong-nbi", company: "LiuGong", sourceType: "API", status: "failed", lastSyncAt: null, nextSyncAt: null, recordsSyncedToday: 0 };
  try { return (await request()).integration ?? fallback; } catch { return fallback; }
}
export async function fetchLiuGongReport(reportType: ReportType, filters: DashboardFilters): Promise<ReportPreview> {
  const columns = ["Machine S/N", "Product group", "Model", "Site", "Engine hours", "Working hours", "Idle hours",
    "Fuel (L)", "Avg fuel (L/h)", "Work (%)", "Idling (%)", "Days reported", "Last sync"];
  const preview: ReportPreview = { reportType, generatedAt: new Date().toISOString(), columns, rows: [], oem: "LiuGong", source: "LIUGONG_NBI_LIVE", live: true };
  if (filters.shift !== "All" || (filters.timePeriodMode === "custom" && (filters.timeFrom !== "00:00" || filters.timeTo !== "23:59")))
    return { ...preview, notice: "LiuGong provides daily totals. Select All Shifts and a full-day date range; shift-level data is unavailable." };
  try {
    const data = await request(`?from=${encodeURIComponent(filters.dateFrom)}&to=${encodeURIComponent(filters.dateTo)}`);
    const vehicles = data.vehicles.map(v => ({ ...v, modelNumber: getWorkbookModelName(v.assetType, v.company, v.modelNumber) }));
    const selected = filterVehicles(vehicles, filters);
    const bySerial = new Map(data.rows?.map(r => [r.serialNumber, r]));
    return { ...preview, generatedAt: data.generatedAt || preview.generatedAt, notice: data.notice,
      period: { date: filters.dateFrom, shift: "ALL_DAY", start: `${filters.dateFrom}T00:00:00+05:30`,
        end: `${filters.dateTo}T23:59:59+05:30`, timezone: "Asia/Kolkata" },
      rows: selected.map(v => { const r = bySerial.get(v.trackerId); return {
        "Machine S/N": v.trackerId, "Product group": v.assetCategory === "Truck" ? "Mining Truck" : "Excavator",
        Model: v.modelNumber, Site: v.siteName || null, "Engine hours": r?.engineHours ?? null,
        "Working hours": r?.workingHours ?? null, "Idle hours": r?.idleHours ?? null,
        "Fuel (L)": r?.fuelLitres ?? null, "Avg fuel (L/h)": r?.fuelRate ?? null,
        "Work (%)": r?.workPercent ?? null, "Idling (%)": r?.idlePercent ?? null,
        "Days reported": r?.daysReported ?? 0, "Last sync": r?.lastSyncAt ?? null,
      }; }),
    };
  } catch (error) { return { ...preview, error: { kind: "upstream", message: (error as Error).message, retryable: true } }; }
}
