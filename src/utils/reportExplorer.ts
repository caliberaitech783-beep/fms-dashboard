export type ReportRow = Record<string, string | number | null>;
export type ReportSortDirection = "asc" | "desc";

export interface ReportExplorerState {
  drilldownColumn: string;
  subDrilldownColumn: string;
  sortColumn: string;
  sortDirection: ReportSortDirection;
  thenSortColumn: string;
  thenSortDirection: ReportSortDirection;
}

export interface ReportRowGroup {
  key: string;
  value: string | number | null;
  rows: ReportRow[];
  subgroups: ReportRowGroup[];
}

export const emptyReportExplorerState: ReportExplorerState = {
  drilldownColumn: "",
  subDrilldownColumn: "",
  sortColumn: "",
  sortDirection: "asc",
  thenSortColumn: "",
  thenSortDirection: "asc",
};

export function sortReportRows(rows: ReportRow[], state: ReportExplorerState): ReportRow[] {
  if (!state.sortColumn) {
    return rows;
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const primary = compareReportValues(
        left.row[state.sortColumn],
        right.row[state.sortColumn],
        state.sortDirection,
      );
      if (primary !== 0 || !state.thenSortColumn) {
        return primary || left.index - right.index;
      }

      const secondary = compareReportValues(
        left.row[state.thenSortColumn],
        right.row[state.thenSortColumn],
        state.thenSortDirection,
      );
      return secondary || left.index - right.index;
    })
    .map(({ row }) => row);
}

export function groupReportRows(
  rows: ReportRow[],
  drilldownColumn: string,
  subDrilldownColumn: string,
): ReportRowGroup[] {
  if (!drilldownColumn) {
    return [];
  }

  const primaryGroups = groupByColumn(rows, drilldownColumn, "primary");
  if (!subDrilldownColumn) {
    return primaryGroups;
  }

  return primaryGroups.map((group) => ({
    ...group,
    subgroups: groupByColumn(group.rows, subDrilldownColumn, group.key),
  }));
}

export function formatReportGroupValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "Not available" : String(value);
}

function groupByColumn(rows: ReportRow[], column: string, parentKey: string): ReportRowGroup[] {
  const groups = new Map<string, ReportRowGroup>();

  rows.forEach((row) => {
    const value = row[column] ?? null;
    const valueKey = `${typeof value}:${String(value)}`;
    const key = `${parentKey}:${column}:${valueKey}`;
    const group = groups.get(valueKey);

    if (group) {
      group.rows.push(row);
      return;
    }

    groups.set(valueKey, {
      key,
      value,
      rows: [row],
      subgroups: [],
    });
  });

  return [...groups.values()];
}

function compareReportValues(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
  direction: ReportSortDirection,
): number {
  const leftComparable = comparableValue(left);
  const rightComparable = comparableValue(right);

  if (leftComparable === null) {
    return rightComparable === null ? 0 : 1;
  }
  if (rightComparable === null) {
    return -1;
  }

  const multiplier = direction === "asc" ? 1 : -1;
  if (typeof leftComparable === "number" && typeof rightComparable === "number") {
    return (leftComparable - rightComparable) * multiplier;
  }

  return String(leftComparable).localeCompare(String(rightComparable), undefined, {
    numeric: true,
    sensitivity: "base",
  }) * multiplier;
}

function comparableValue(value: string | number | null | undefined): string | number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || !value.trim() || value.trim() === "-") {
    return null;
  }

  const text = value.trim();
  const duration = text.match(/^(\d+):(\d{2})$/);
  if (duration) {
    return Number(duration[1]) * 60 + Number(duration[2]);
  }

  const numeric = Number(text.replace(/,/g, "").replace(/%$/, ""));
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const timestamp = /^\d{4}-\d{2}-\d{2}(?:T|\s)/.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  return text;
}
