import type { ReportPreview } from "../types/reports";

const REMOVED_REPORT_COLUMNS = new Set([
  "I-Shift Performance Time % time of Total time (%)",
  "Above economy % time of Total time (%)",
]);

export function visibleReportColumns(columns: string[]): string[] {
  return columns.filter((column) => !REMOVED_REPORT_COLUMNS.has(column));
}

export function removeHiddenReportColumns(preview: ReportPreview): ReportPreview {
  const columns = visibleReportColumns(preview.columns);
  if (columns.length === preview.columns.length) {
    return preview;
  }

  return {
    ...preview,
    columns,
    rows: preview.rows.map((row) => Object.fromEntries(
      Object.entries(row).filter(([column]) => !REMOVED_REPORT_COLUMNS.has(column)),
    )),
  };
}
