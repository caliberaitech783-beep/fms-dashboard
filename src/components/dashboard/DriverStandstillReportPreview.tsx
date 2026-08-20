import type { ReportPreview } from "../../types/reports";
import type { ReportRow } from "../../utils/reportExplorer";
import { cx } from "../ui/cx";
import { ReportDrilldownRows } from "./ReportDrilldownRows";

interface DriverStandstillReportPreviewProps {
  preview: ReportPreview;
  rows: ReportRow[];
  drilldownColumn: string;
  subDrilldownColumn: string;
}

const VEHICLE = "Vehicles";
const DRIVER = "Drivers";
const TOTAL_TIME = "Total time (hh:mm)";
const DRIVING = "Driving (km)";
const ENGINE_ON = "Diesel engine on (l)";
const EFFICIENCY = "Avg diesel engine on (km/l)";
const STANDSTILL = "Standstill (%)";
const STANDSTILL_TIME = "Standstill (hh:mm)";
const I_SHIFT_PERFORMANCE = "I-Shift Performance % time of Total time (%)";
const ABOVE_ECONOMY = "Above economy % time of Total time (%)";
const ENGINE_LOAD = "Engine load % time of Total time (%)";
const COASTING = "Coasting (%)";
const AVERAGE_DIESEL = "Avg diesel (l/h)";

export const driverStandstillDisplayColumns = [
  VEHICLE,
  DRIVER,
  TOTAL_TIME,
  DRIVING,
  ENGINE_ON,
  EFFICIENCY,
  STANDSTILL,
  STANDSTILL_TIME,
  ENGINE_LOAD,
  COASTING,
  AVERAGE_DIESEL,
];

export const scaniaStandstillDisplayColumns = [
  "Registration number",
  DRIVER,
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

export function driverStandstillColumns(preview?: ReportPreview | null) {
  if (isScaniaReport(preview)) return scaniaStandstillDisplayColumns;
  if (!preview?.columns.includes(I_SHIFT_PERFORMANCE) && !preview?.columns.includes(ABOVE_ECONOMY)) {
    return driverStandstillDisplayColumns;
  }
  return [
    ...driverStandstillDisplayColumns.slice(0, 8),
    I_SHIFT_PERFORMANCE,
    ABOVE_ECONOMY,
    ...driverStandstillDisplayColumns.slice(8),
  ];
}

const HEADERS: Record<string, string> = {
  [VEHICLE]: "Vehicles",
  [DRIVER]: "Drivers",
  [TOTAL_TIME]: "Total time (hh:mm)",
  [DRIVING]: "Driving (km)",
  [ENGINE_ON]: "Diesel engine on (l)",
  [EFFICIENCY]: "Avg diesel engine on (km/l)",
  [STANDSTILL]: "Standstill (%)",
  [STANDSTILL_TIME]: "Standstill (hh:mm)",
  [I_SHIFT_PERFORMANCE]: "I-Shift Performance (%)",
  [ABOVE_ECONOMY]: "Above economy (%)",
  [ENGINE_LOAD]: "Engine load (%)",
  [COASTING]: "Coasting (%)",
  [AVERAGE_DIESEL]: "Avg diesel (l/h)",
  "Registration number": "Registration number",
  "Engine running time (h:m)": "Engine running time (h:m)",
  "Distance driven (km)": "Distance driven (km)",
  "Consumption liquid fuel (km/l)": "Consumption liquid fuel (km/l)",
  "Consumption liquid fuel (litres)": "Consumption liquid fuel (litres)",
  "Consumption liquid fuel (litres/h)": "Consumption liquid fuel (litres/h)",
  "Idling (% of engine running time)": "Idling (% of engine running time)",
  "Idling (h:m)": "Idling (h:m)",
  "Performance mode - Power (km)": "Performance mode - Power (km)",
  "Performance mode - Power (% of distance)": "Performance mode - Power (% of distance)",
  "Powertrain coasting (% of distance)": "Powertrain coasting (% of distance)",
};

export function DriverStandstillReportPreview({
  preview,
  rows,
  drilldownColumn,
  subDrilldownColumn,
}: DriverStandstillReportPreviewProps) {
  const period = preview.period;
  const scania = isScaniaReport(preview);
  const displayColumns = driverStandstillColumns(preview);
  const summary = resolveDriverStandstillSummary(preview);
  const averages = {
    fuelEconomy: average(preview.rows, scania ? "Consumption liquid fuel (km/l)" : EFFICIENCY),
    litresPerHour: average(preview.rows, scania ? "Consumption liquid fuel (litres/h)" : AVERAGE_DIESEL),
  };

  return (
    <div className="space-y-4">
      {period && (
        <div className="border-b-2 border-[#213d68] pb-4">
          <h3 className="text-xl font-semibold text-[#213d68]">
            Driverwise Standstill Tracking |{" "}
            {period.site ?? "All Sites"} | {period.customTimeRange ? "Custom period" : `Shift ${period.shift}`}
          </h3>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-coal-600">
            <span>Date: {formatReportDate(period.date)}</span>
            <span>Period: {formatReportTime(period.start)} to {formatReportTime(period.end)}</span>
            <span>Total vehicles: {rows.length}</span>
          </div>
        </div>
      )}

      {preview.notice && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {preview.notice}
        </div>
      )}

      {preview.error ? (
        <ReportErrorState error={preview.error} />
      ) : !rows.length ? (
        <div className="rounded-md border border-coal-200 bg-coal-50 px-4 py-8 text-center">
          <p className="font-semibold text-coal-800">
            {scania
              ? "No Scania Vehicle Evaluation rows were returned for this site and shift."
              : "No Volvo status intervals were returned for this shift."}
          </p>
          <p className="mt-1 text-sm text-coal-500">
            {preview.meta?.emptyReason
              ?? (scania
                ? "Confirm the selected Scania site, Shift A/B/C, and date, then refresh."
                : "Select another recent date or shift and refresh the report.")}
          </p>
        </div>
      ) : (
        <div>
          <div className="max-h-[560px] overflow-auto border border-coal-200">
            <table className="min-w-[1240px] border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-[#213d68] text-white">
              <tr>
                {displayColumns.map((column) => (
                  <th
                    key={column}
                    className={cx(
                      "border border-white/30 px-2 py-3 text-center font-semibold leading-tight",
                      column === DRIVER ? "min-w-36 text-left" : "min-w-24",
                      (column === VEHICLE || column === "Registration number") && "min-w-24 text-left",
                    )}
                  >
                    {HEADERS[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!scania && (
                <tr className="bg-white font-semibold text-[#213d68]">
                  {displayColumns.map((column) => (
                    <td key={column} className="border border-coal-200 px-2 py-2 text-center first:text-left nth-[2]:text-left">
                      {formatCell(summary[column])}
                    </td>
                  ))}
                </tr>
              )}
              <ReportDrilldownRows
                rows={rows}
                drilldownColumn={drilldownColumn}
                subDrilldownColumn={subDrilldownColumn}
                columnCount={displayColumns.length}
                renderRow={(row, rowIndex) => (
                  <tr
                    key={`${row[scania ? "Registration number" : VEHICLE] ?? "vehicle"}-${rowIndex}`}
                    className={rowIndex % 2 ? "bg-coal-50" : "bg-white"}
                  >
                    {displayColumns.map((column) => (
                      <td
                        key={column}
                        className={cx(
                          "border border-coal-200 px-2 py-2 text-center tabular-nums text-coal-900",
                          (column === VEHICLE || column === DRIVER || column === "Registration number") && "text-left",
                          metricCellClass(column, row[column], averages),
                        )}
                      >
                        {formatCell(row[column])}
                      </td>
                    ))}
                  </tr>
                )}
              />
            </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function isScaniaReport(preview?: ReportPreview | null) {
  return preview?.oem === "Scania"
    || preview?.source?.toLowerCase().includes("vehicle-evaluation")
    || Boolean(preview?.columns.includes("Registration number"));
}

function ReportErrorState({ error }: { error: NonNullable<ReportPreview["error"]> }) {
  const titles: Record<NonNullable<ReportPreview["error"]>["kind"], string> = {
    authentication: "Scania API authentication failed",
    permission: "Scania API permission denied",
    timeout: "Scania report generation timed out",
    mapping: "Scania site or shift mapping is incomplete",
    validation: "Scania report request is invalid",
    configuration: "Scania API is not configured",
    rate_limit: "Scania API rate limit reached",
    network: "Scania report service is unreachable",
    upstream: "Scania live report is unavailable",
    portal_authentication: "Dashboard authentication is required",
    portal_permission: "Your role cannot access live Scania data",
  };
  return (
    <div className="rounded-md border border-red-300 bg-red-50 px-4 py-8 text-center">
      <p className="font-semibold text-red-900">{titles[error.kind]}</p>
      <p className="mt-1 text-sm text-red-800">{error.message}</p>
      {error.retryable && <p className="mt-2 text-xs text-red-700">You can retry with the Refresh button.</p>}
    </div>
  );
}

export function resolveDriverStandstillSummary(
  preview: Pick<ReportPreview, "rows" | "summary">,
): Record<string, string | number | null> {
  if (preview.summary) return preview.summary;
  const rows = preview.rows;
  const summary: Record<string, string | number | null> = {
    [VEHICLE]: `Summary (${rows.length})`,
    [DRIVER]: `${rows.length} vehicles`,
    [TOTAL_TIME]: sumDurations(rows, TOTAL_TIME),
    [DRIVING]: sumValues(rows, DRIVING),
    [ENGINE_ON]: sumValues(rows, ENGINE_ON),
    [STANDSTILL_TIME]: sumDurations(rows, STANDSTILL_TIME),
  };

  [
    EFFICIENCY,
    STANDSTILL,
    ENGINE_LOAD,
    COASTING,
    AVERAGE_DIESEL,
  ]
    .forEach((column) => {
      summary[column] = average(rows, column);
    });
  return summary;
}

function sumValues(rows: ReportPreview["rows"], column: string): number | null {
  const values = rows
    .map((row) => row[column])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

function average(rows: ReportPreview["rows"], column: string): number | null {
  const values = rows
    .map((row) => row[column])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function sumDurations(rows: ReportPreview["rows"], column: string): string {
  const totalMinutes = rows.reduce((sum, row) => {
    const match = String(row[column] ?? "").match(/^(\d+):(\d{2})$/);
    return match ? sum + Number(match[1]) * 60 + Number(match[2]) : sum;
  }, 0);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function metricCellClass(
  column: string,
  value: string | number | null,
  averages: { fuelEconomy: number | null; litresPerHour: number | null },
): string {
  if (typeof value !== "number") return "";
  if (column === STANDSTILL && value > 28) return "bg-red-600 text-white";
  if (column === EFFICIENCY && averages.fuelEconomy !== null && value < averages.fuelEconomy) {
    return "bg-rose-200";
  }
  if (column === ENGINE_LOAD && value > 5) return "bg-red-600 text-white";
  if (column === COASTING && value < 20) return "bg-rose-200";
  if (column === AVERAGE_DIESEL && averages.litresPerHour !== null && value > averages.litresPerHour) {
    return "bg-rose-200";
  }
  if (column === "Idling (% of engine running time)" && value > 28) return "bg-red-600 text-white";
  if (column === "Consumption liquid fuel (km/l)" && averages.fuelEconomy !== null && value < averages.fuelEconomy) {
    return "bg-rose-200";
  }
  if (column === "Consumption liquid fuel (litres/h)" && averages.litresPerHour !== null && value > averages.litresPerHour) {
    return "bg-rose-200";
  }
  if (column === "Performance mode - Power (km)" && value > 30) return "bg-red-600 text-white";
  if (column === "Performance mode - Power (% of distance)" && value > 1) return "bg-rose-200";
  if (column === "Powertrain coasting (% of distance)" && value < 20) return "bg-rose-200";
  return "";
}

function formatCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return typeof value === "number" ? value.toFixed(2) : String(value);
}

function formatReportDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T12:00:00+05:30`));
}

function formatReportTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}
