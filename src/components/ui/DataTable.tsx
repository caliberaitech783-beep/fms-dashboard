import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { cx } from "./cx";

export interface DataTableColumn<T> {
  header: string;
  render: (row: T, index: number) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  maxHeight?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  maxHeight = "max-h-[420px]",
}: DataTableProps<T>) {
  if (!rows.length) {
    return <EmptyState title="No data available" message="Try changing the selected filters." />;
  }

  return (
    <div className={cx("overflow-auto", maxHeight)}>
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 bg-coal-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                className={cx(
                  "whitespace-nowrap border-b border-coal-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-coal-500",
                  column.align === "right" && "text-right",
                  column.align === "center" && "text-center",
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={getRowKey(row, index)}
              onClick={() => onRowClick?.(row)}
              className={cx(
                "border-b border-coal-100",
                onRowClick && "cursor-pointer hover:bg-ore-50",
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.header}
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
  );
}
