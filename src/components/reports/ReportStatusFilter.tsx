import type { ReportStatusFilterValue } from "../../types/reportCategories";

interface ReportStatusFilterProps {
  value: ReportStatusFilterValue;
  onChange: (value: ReportStatusFilterValue) => void;
}

const STATUS_OPTIONS: Array<{ value: ReportStatusFilterValue; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "ready", label: "Ready" },
  { value: "queued", label: "Queued" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "not_generated", label: "Not Generated" },
];

export function ReportStatusFilter({ value, onChange }: ReportStatusFilterProps) {
  return (
    <label className="block sm:w-48">
      <span className="sr-only">Filter reports by status</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ReportStatusFilterValue)}
        className="h-10 w-full rounded-md border border-coal-200 bg-white px-3 text-sm text-coal-900 outline-none transition focus:border-ore-500 focus:ring-2 focus:ring-ore-500/20"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
