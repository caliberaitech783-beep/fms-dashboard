import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import type { ReportExplorerState, ReportSortDirection } from "../../utils/reportExplorer";
import { titleCase } from "../../utils/formatters";
import { cx } from "../ui/cx";

interface ReportExplorerControlsProps {
  columns: string[];
  state: ReportExplorerState;
  onChange: (state: ReportExplorerState) => void;
  singleSort?: boolean;
  explicitSortDirections?: boolean;
}

export function ReportExplorerControls({
  columns,
  state,
  onChange,
  singleSort = false,
  explicitSortDirections = false,
}: ReportExplorerControlsProps) {
  const hasExploration = Object.entries(state).some(([key, value]) => (
    key.endsWith("Column") ? Boolean(value) : value !== "asc"
  ));

  const update = (patch: Partial<ReportExplorerState>) => {
    const next = { ...state, ...patch };

    if (!next.drilldownColumn) {
      next.subDrilldownColumn = "";
    } else if (next.subDrilldownColumn === next.drilldownColumn) {
      next.subDrilldownColumn = "";
    }

    if (singleSort || !next.sortColumn) {
      next.thenSortColumn = "";
    } else if (next.thenSortColumn === next.sortColumn) {
      next.thenSortColumn = "";
    }

    onChange(next);
  };

  return (
    <div
      className="flex flex-wrap items-end gap-2"
      aria-label={singleSort ? "Report sorting controls" : "Report sorting and drill-down controls"}
    >
      {!singleSort && (
        <>
          <ExplorerSelect
            label="Drill down"
            ariaLabel="Primary drill-down column"
            value={state.drilldownColumn}
            columns={columns}
            onChange={(value) => update({ drilldownColumn: value })}
          />
          <ExplorerSelect
            label="Sub drill down"
            ariaLabel="Secondary drill-down column"
            value={state.subDrilldownColumn}
            columns={columns.filter((column) => column !== state.drilldownColumn)}
            disabled={!state.drilldownColumn}
            onChange={(value) => update({ subDrilldownColumn: value })}
          />
        </>
      )}
      <SortControl
        label="Sort by"
        ariaLabel={singleSort ? "Sort report by parameter" : "Primary sort column"}
        value={state.sortColumn}
        direction={state.sortDirection}
        columns={columns}
        explicitDirections={singleSort || explicitSortDirections}
        onColumnChange={(value) => update({
          sortColumn: value,
          sortDirection: value && !state.sortColumn ? "desc" : state.sortDirection,
        })}
        onDirectionChange={(direction) => update({ sortDirection: direction })}
      />
      {!singleSort && (
        <SortControl
          label="Then by"
          ariaLabel="Secondary sort column"
          value={state.thenSortColumn}
          direction={state.thenSortDirection}
          columns={columns.filter((column) => column !== state.sortColumn)}
          disabled={!state.sortColumn}
          onColumnChange={(value) => update({ thenSortColumn: value })}
          onDirectionChange={(direction) => update({ thenSortDirection: direction })}
        />
      )}
      {hasExploration && (
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-coal-200 bg-white text-coal-600 hover:border-ore-300 hover:text-ore-700"
          title={singleSort ? "Reset report sorting" : "Reset report sorting and drill-down"}
          aria-label={singleSort ? "Reset report sorting" : "Reset report sorting and drill-down"}
          onClick={() => onChange({
            drilldownColumn: "",
            subDrilldownColumn: "",
            sortColumn: "",
            sortDirection: "asc",
            thenSortColumn: "",
            thenSortDirection: "asc",
          })}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

interface ExplorerSelectProps {
  label: string;
  ariaLabel: string;
  value: string;
  columns: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

function ExplorerSelect({
  label,
  ariaLabel,
  value,
  columns,
  disabled = false,
  onChange,
}: ExplorerSelectProps) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-coal-600">
      {label}
      <select
        aria-label={ariaLabel}
        className="h-10 w-36 rounded-md border border-coal-200 bg-white px-2 text-sm text-coal-800 outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100 disabled:bg-coal-100 disabled:text-coal-400"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">None</option>
        {columns.map((column) => (
          <option key={column} value={column}>{titleCase(column)}</option>
        ))}
      </select>
    </label>
  );
}

interface SortControlProps extends Omit<ExplorerSelectProps, "onChange"> {
  direction: ReportSortDirection;
  explicitDirections?: boolean;
  onColumnChange: (value: string) => void;
  onDirectionChange: (direction: ReportSortDirection) => void;
}

function SortControl({
  label,
  ariaLabel,
  value,
  direction,
  columns,
  disabled = false,
  explicitDirections = false,
  onColumnChange,
  onDirectionChange,
}: SortControlProps) {
  const nextDirection = direction === "asc" ? "desc" : "asc";

  return (
    <div className="flex items-end gap-1">
      <ExplorerSelect
        label={label}
        ariaLabel={ariaLabel}
        value={value}
        columns={columns}
        disabled={disabled}
        onChange={onColumnChange}
      />
      {explicitDirections ? (
        <>
          <SortDirectionButton
            label="High to Low"
            direction="desc"
            selectedDirection={direction}
            disabled={disabled || !value}
            onChange={onDirectionChange}
          />
          <SortDirectionButton
            label="Low to High"
            direction="asc"
            selectedDirection={direction}
            disabled={disabled || !value}
            onChange={onDirectionChange}
          />
        </>
      ) : (
        <button
          type="button"
          className={cx(
            "flex h-10 w-10 items-center justify-center rounded-md border border-coal-200 bg-white text-coal-600",
            "hover:border-ore-300 hover:text-ore-700 disabled:bg-coal-100 disabled:text-coal-300",
          )}
          title={direction === "asc" ? "Ascending order" : "Descending order"}
          aria-label={`Change ${label.toLowerCase()} to ${nextDirection === "asc" ? "ascending" : "descending"} order`}
          disabled={disabled || !value}
          onClick={() => onDirectionChange(nextDirection)}
        >
          {direction === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

interface SortDirectionButtonProps {
  label: string;
  direction: ReportSortDirection;
  selectedDirection: ReportSortDirection;
  disabled: boolean;
  onChange: (direction: ReportSortDirection) => void;
}

function SortDirectionButton({
  label,
  direction,
  selectedDirection,
  disabled,
  onChange,
}: SortDirectionButtonProps) {
  const selected = direction === selectedDirection;

  return (
    <button
      type="button"
      className={cx(
        "h-10 whitespace-nowrap rounded-md border px-3 text-xs font-semibold",
        selected
          ? "border-ore-600 bg-ore-50 text-ore-700"
          : "border-coal-200 bg-white text-coal-600 hover:border-ore-300 hover:text-ore-700",
        "disabled:bg-coal-100 disabled:text-coal-300",
      )}
      aria-label={`Sort ${label.toLowerCase()}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onChange(direction)}
    >
      {label}
    </button>
  );
}
