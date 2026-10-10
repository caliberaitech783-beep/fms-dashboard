import type { ReportPreview } from "../types/reports";

type Row = ReportPreview["rows"][number];
export const ADJUSTED_IDLING = "Adjusted Idling (%)";
export const SCANIA_STANDSTILL_COLUMNS = [
  "Registration number", "Drivers", "Engine running time (h:m)", "Distance driven (km)",
  "Consumption liquid fuel (km/l)", "Consumption liquid fuel (litres)",
  "Consumption liquid fuel (litres/h)", "Idling (% of engine running time)",
  "Idling (h:m)", "Powertrain coasting (% of distance)", ADJUSTED_IDLING,
];
const ENGINE = SCANIA_STANDSTILL_COLUMNS[2];
const DISTANCE = SCANIA_STANDSTILL_COLUMNS[3];
const FUEL = SCANIA_STANDSTILL_COLUMNS[5];
const RATE = SCANIA_STANDSTILL_COLUMNS[6];
const IDLE = SCANIA_STANDSTILL_COLUMNS[7];
const IDLE_TIME = SCANIA_STANDSTILL_COLUMNS[8];
const COAST = SCANIA_STANDSTILL_COLUMNS[9];
const NOTE = "Adjusted Idling is an estimate: reported idling × min(vehicle L/h ÷ fleet-average L/h, 1). The average uses vehicles travelling over 15 km with positive L/h (20 L/h fallback). It does not measure ignition-off time.";
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const round = (value: number) => Math.round(value * 100) / 100;
function minutes(value: unknown): number | null {
  const match = String(value ?? "").match(/^(\d+):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function duration(value: number | null) {
  return value === null ? null : `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}`;
}
function sum(values: (number | null)[]) {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
function ratio(rows: Row[], numerator: (row: Row) => number | null, denominator: (row: Row) => number | null, scale = 1) {
  const pairs = rows.map(row => [numerator(row), denominator(row)]).filter((p): p is [number, number] => p[0] !== null && p[1] !== null && p[1] > 0);
  const total = pairs.reduce((a, p) => a + p[1], 0);
  return total ? round(pairs.reduce((a, p) => a + p[0], 0) / total * scale) : null;
}

export function scaniaStandstillSummary(rows: Row[]): Row {
  const adjusted = rows.map(row => number(row[ADJUSTED_IDLING])).filter((v): v is number => v !== null && v > 0);
  return {
    "Registration number": `Summary (${rows.length})`, Drivers: `${rows.length} vehicles`,
    [ENGINE]: duration(sum(rows.map(row => minutes(row[ENGINE])))),
    [DISTANCE]: sum(rows.map(row => number(row[DISTANCE]))),
    [FUEL]: sum(rows.map(row => number(row[FUEL]))),
    "Consumption liquid fuel (km/l)": ratio(rows, row => number(row[DISTANCE]), row => number(row[FUEL])),
    [RATE]: ratio(rows, row => number(row[FUEL]), row => minutes(row[ENGINE]), 60),
    [IDLE]: ratio(rows, row => minutes(row[IDLE_TIME]), row => minutes(row[ENGINE]), 100),
    [IDLE_TIME]: duration(sum(rows.map(row => minutes(row[IDLE_TIME])))),
    [COAST]: ratio(rows, row => {
      const distance = number(row[DISTANCE]), coast = number(row[COAST]);
      return distance !== null && coast !== null ? distance * coast : null;
    }, row => number(row[DISTANCE])),
    [ADJUSTED_IDLING]: adjusted.length ? round(adjusted.reduce((a, b) => a + b, 0) / adjusted.length) : rows.some(row => row[ADJUSTED_IDLING] === 0) ? 0 : null,
  };
}

export function prepareScaniaStandstill(preview: ReportPreview): ReportPreview {
  if (preview.reportType !== "Driverwise Standstill Tracking" || (preview.oem !== "Scania" && !preview.columns.includes("Registration number")) || preview.error) return preview;
  const rates = preview.rows.filter(row => (number(row[DISTANCE]) ?? 0) > 15)
    .map(row => number(row[RATE])).filter((v): v is number => v !== null && v > 0);
  const fleetAverage = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 20;
  const rows = preview.rows.map(row => {
    const idle = number(row[IDLE]), rate = number(row[RATE]);
    const adjusted = idle !== null && rate !== null ? Math.round(idle * Math.min(rate / fleetAverage, 1) * 10) / 10 : null;
    return Object.fromEntries(SCANIA_STANDSTILL_COLUMNS.map(column => [column, column === ADJUSTED_IDLING ? adjusted : row[column] ?? null]));
  });
  return { ...preview, columns: SCANIA_STANDSTILL_COLUMNS, rows, summary: scaniaStandstillSummary(rows),
    notice: preview.notice?.includes(NOTE) ? preview.notice : [preview.notice, NOTE].filter(Boolean).join(" ") };
}

// Apply only at the report boundary; dashboard telemetry still needs the full fleet.
export function filterScaniaStandstillReport(preview: ReportPreview): ReportPreview {
  if (preview.reportType !== "Driverwise Standstill Tracking" || preview.oem !== "Scania" || preview.error) return preview;
  const filterNote = "Only vehicles with distance driven greater than 15 km in the selected period are shown. Counts and summary totals cover these vehicles only.";
  const notice = preview.notice?.replace(/mapped vehicles shown/g, "mapped vehicles available before distance filtering");
  return prepareScaniaStandstill({
    ...preview,
    rows: preview.rows.filter(row => (number(row[DISTANCE]) ?? 0) > 15),
    notice: notice?.includes(filterNote) ? notice : [notice, filterNote].filter(Boolean).join(" "),
  });
}

export function scaniaExportRows(preview: ReportPreview): Row[] {
  return preview.oem === "Scania" && preview.reportType === "Driverwise Standstill Tracking" && preview.summary
    ? [preview.summary, ...preview.rows] : preview.rows;
}
