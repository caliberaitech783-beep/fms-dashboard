import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { cx } from "./cx";

export interface DataTableColumn<T> {
  id?: string;
  header: string;
  render: (row: T, index: number) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  sortValue?: (row: T) => string | number | null | undefined;
  hideable?: boolean;
  initiallyHidden?: boolean;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  maxHeight?: string;
  enableColumnSelector?: boolean;
  defaultSort?: { column: string; direction?: "asc" | "desc" };
  caption?: string;
  getRowLabel?: (row: T) => string;
}

type SortState = { column: string; direction: "asc" | "desc" } | null;

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  maxHeight = "max-h-[420px]",
  enableColumnSelector = false,
  defaultSort,
  caption,
  getRowLabel,
}: DataTableProps<T>) {
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(columns.map((column) => [getColumnId(column), !column.initiallyHidden])),
  );
  const [sort, setSort] = useState<SortState>(() => defaultSort
    ? { column: defaultSort.column, direction: defaultSort.direction ?? "asc" }
    : null);

  const displayedColumns = useMemo(
    () => columns.filter((column) => visibleColumns[getColumnId(column)] !== false),
    [columns, visibleColumns],
  );
  const displayedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => getColumnId(candidate) === sort.column);
    if (!column?.sortValue) return rows;

    return [...rows].sort((left, right) => {
      const compared = compareSortValues(column.sortValue?.(left), column.sortValue?.(right));
      return sort.direction === "asc" ? compared : -compared;
    });
  }, [columns, rows, sort]);

  if (!rows.length) {
    return <EmptyState title="No data available" message="Try changing the selected filters." />;
  }

  return (
    <div>
      {enableColumnSelector && (
        <div className="mb-3 flex justify-end">
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-coal-200 bg-white px-3 py-2 text-xs font-semibold text-coal-700 hover:bg-coal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ore-500">
              <Columns3 className="h-4 w-4" aria-hidden="true" />
              Columns
            </summary>
            <div className="absolute right-0 z-30 mt-2 min-w-52 rounded-md border border-coal-200 bg-white p-2 shadow-command">
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-coal-500">Visible columns</p>
              {columns.map((column) => {
                const id = getColumnId(column);
                const checked = visibleColumns[id] !== false;
                const visibleCount = Object.values(visibleColumns).filter(Boolean).length;
                return (
                  <label key={id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-coal-700 hover:bg-coal-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={column.hideable === false || (checked && visibleCount === 1)}
                      onChange={(event) => setVisibleColumns((current) => ({ ...current, [id]: event.target.checked }))}
                      className="h-4 w-4 rounded border-coal-300 text-ore-600 focus:ring-ore-500"
                    />
                    <span>{column.header}</span>
                  </label>
                );
              })}
            </div>
          </details>
        </div>
      )}
      <div className={cx("overflow-auto", maxHeight)}>
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-coal-50">
            <tr>
              {displayedColumns.map((column) => {
                const id = getColumnId(column);
                const activeSort = sort?.column === id ? sort.direction : null;
                return (
                  <th
                    key={id}
                    aria-sort={activeSort ? (activeSort === "asc" ? "ascending" : "descending") : undefined}
                    className={cx(
                      "whitespace-nowrap border-b border-coal-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-coal-500",
                      column.align === "right" && "text-right",
                      column.align === "center" && "text-center",
                      column.className,
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => setSort((current) => nextSort(current, id))}
                        className={cx(
                          "inline-flex items-center gap-1 rounded py-1 hover:text-coal-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ore-500",
                          column.align === "right" && "flex-row-reverse",
                        )}
                        title={`Sort by ${column.header}`}
                      >
                        <span>{column.header}</span>
                        {activeSort === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : activeSort === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />}
                      </button>
                    ) : column.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((row, index) => (
              <tr
                key={getRowKey(row, index)}
                onClick={() => onRowClick?.(row)}
                onKeyDown={onRowClick ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(row);
                  }
                } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick ? getRowLabel?.(row) ?? "Open row details" : undefined}
                className={cx(
                  "border-b border-coal-100",
                  onRowClick && "cursor-pointer hover:bg-ore-50 focus:outline-none focus-visible:bg-ore-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ore-500",
                )}
              >
                {displayedColumns.map((column) => (
                  <td
                    key={getColumnId(column)}
                    className={cx(
                      "border-b border-coal-100 px-3 py-2 text-coal-700",
                      column.align === "right" && "text-right tabular-nums",
                      column.align === "center" && "text-center",
                      column.className,
                    )}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getColumnId<T>(column: DataTableColumn<T>): string {
  return column.id ?? column.header;
}

function nextSort(current: SortState, column: string): SortState {
  if (!current || current.column !== column) return { column, direction: "asc" };
  if (current.direction === "asc") return { column, direction: "desc" };
  return null;
}

function compareSortValues(left: string | number | null | undefined, right: string | number | null | undefined): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}
