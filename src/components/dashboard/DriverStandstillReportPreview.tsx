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
const ENGINE_ON = "Diesel engine on (%)";
const EFFICIENCY = "Avg diesel engine on (km/l)";
const STANDSTILL = "Standstill (%)";
const STANDSTILL_TIME = "Standstill (hh:mm)";
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

const HEADERS: Record<string, string> = {
  [VEHICLE]: "Vehicles",
  [DRIVER]: "Drivers",
  [TOTAL_TIME]: "Total time (hh:mm)",
  [DRIVING]: "Driving (km)",
  [ENGINE_ON]: "Diesel engine on (%)",
  [EFFICIENCY]: "Avg diesel engine on (km/l)",
  [STANDSTILL]: "Standstill (%)",
  [STANDSTILL_TIME]: "Standstill (hh:mm)",
  [ENGINE_LOAD]: "Engine load (%)",
  [COASTING]: "Coasting (%)",
  [AVERAGE_DIESEL]: "Avg diesel (l/h)",
};

export function DriverStandstillReportPreview({
  preview,
  rows,
  drilldownColumn,
  subDrilldownColumn,
}: DriverStandstillReportPreviewProps) {
  const period = preview.period;
  const summary = buildSummary(preview.rows);

  return (
    <div className="space-y-4">
      {period && (
        <div className="border-b-2 border-[#213d68] pb-4">
          <h3 className="text-xl font-semibold text-[#213d68]">
            Driverwise Standstill Tracking | {period.site ?? "All Sites"} | Shift {period.shift}
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

      {!rows.length ? (
        <div className="rounded-md border border-coal-200 bg-coal-50 px-4 py-8 text-center">
          <p className="font-semibold text-coal-800">No Volvo status intervals were returned for this shift.</p>
          <p className="mt-1 text-sm text-coal-500">Select another recent date or shift and refresh the report.</p>
        </div>
      ) : (
        <div>
          <div className="max-h-[560px] overflow-auto border border-coal-200">
            <table className="min-w-[1240px] border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-[#213d68] text-white">
              <tr>
                {driverStandstillDisplayColumns.map((column) => (
                  <th
                    key={column}
                    className={cx(
                      "border border-white/30 px-2 py-3 text-center font-semibold leading-tight",
                      column === DRIVER ? "min-w-36 text-left" : "min-w-24",
                      column === VEHICLE && "min-w-24 text-left",
                    )}
                  >
                    {HEADERS[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="sticky top-[57px] z-10 bg-white font-semibold text-[#213d68]">
                {driverStandstillDisplayColumns.map((column) => (
                  <td key={column} className="border border-coal-200 px-2 py-2 text-center first:text-left nth-[2]:text-left">
                    {formatCell(summary[column])}
                  </td>
                ))}
              </tr>
              <ReportDrilldownRows
                rows={rows}
                drilldownColumn={drilldownColumn}
                subDrilldownColumn={subDrilldownColumn}
                columnCount={driverStandstillDisplayColumns.length}
                renderRow={(row, rowIndex) => (
                  <tr key={`${row[VEHICLE] ?? "vehicle"}-${rowIndex}`} className={rowIndex % 2 ? "bg-coal-50" : "bg-white"}>
                    {driverStandstillDisplayColumns.map((column) => (
                      <td
                        key={column}
                        className={cx(
                          "border border-coal-200 px-2 py-2 text-center tabular-nums text-coal-900",
                          (column === VEHICLE || column === DRIVER) && "text-left",
                          metricCellClass(column, row[column]),
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

function buildSummary(rows: ReportPreview["rows"]): Record<string, string | number | null> {
  const summary: Record<string, string | number | null> = {
    [VEHICLE]: `Summary (${rows.length})`,
    [DRIVER]: `${rows.length} vehicles`,
    [TOTAL_TIME]: sumDurations(rows, TOTAL_TIME),
    [STANDSTILL_TIME]: sumDurations(rows, STANDSTILL_TIME),
  };

  [
    DRIVING,
    ENGINE_ON,
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

function metricCellClass(column: string, value: string | number | null): string {
  if (typeof value !== "number") return "";
  if (column === STANDSTILL && value > 27) return "bg-red-600 text-white";
  if (column === EFFICIENCY && value < 0.65) return "bg-orange-200";
  if (column === ENGINE_LOAD && value >= 5) return "bg-orange-200";
  if (column === COASTING && value >= 2) return "bg-rose-200";
  if (column === AVERAGE_DIESEL && value >= 18) return "bg-rose-200";
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
