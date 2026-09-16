import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { RefreshCw, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import type { DashboardFilters } from "../../types/fleet";
import type { FilterOptions } from "../../hooks/useFleetFilters";
import { SHIFT_OPTIONS } from "../../constants/shifts";
import { Button } from "../ui/Button";
import { TimePeriodPicker } from "./TimePeriodPicker";
import { applyFleetTimePeriod } from "../../utils/filterState";

interface GlobalFiltersProps {
  filters: DashboardFilters;
  options: FilterOptions;
  setFilter: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void;
  setFilters: Dispatch<SetStateAction<DashboardFilters>>;
  resetFilters: () => void;
  onRefresh: () => void;
}

export function GlobalFilters({
  filters,
  options,
  setFilter,
  setFilters,
  resetFilters,
  onRefresh,
}: GlobalFiltersProps) {
  const [open, setOpen] = useState(true);
  return (
    <aside aria-label="Fleet filters" className={open ? "filter-panel w-full shrink-0 border-r border-coal-200 bg-white p-4 lg:sticky lg:top-0 lg:max-h-screen lg:w-72 lg:overflow-y-auto" : "filter-panel shrink-0 p-3"}>
      <div className="mb-4 flex items-center justify-between gap-3"><button type="button" aria-label={open ? "Collapse filters" : "Open filters"} aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4" />{open && "Filters"}</button>{open && <button type="button" aria-label="Close filters" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>}</div>
      {open && <>
      <div className="mb-2 flex justify-end">
        <div className="flex gap-2">
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh} variant="primary">Refresh</Button>
          <Button icon={<RotateCcw className="h-4 w-4" />} onClick={resetFilters}>Reset</Button>
        </div>
      </div>
      <div className="grid gap-4">
        <TimePeriodPicker
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          timeFrom={filters.timeFrom}
          timeTo={filters.timeTo}
          onApply={(period) => {
            setFilters((current) => applyFleetTimePeriod(current, period));
          }}
        />
        <FilterSelect label="Shift" value={filters.shift} options={[{ value: "All", label: "All Shifts" }, ...SHIFT_OPTIONS.map((shift) => ({ value: shift.value, label: shift.label }))]} onChange={(value) => setFilter("shift", value as DashboardFilters["shift"])} />
        <div>
          <span className="mb-2 block text-xs font-semibold text-coal-500">Region</span>
          <div role="group" aria-label="Region" className="flex gap-2">
            {(["WCL", "NCL"] as const).map((region) => <button key={region} type="button" aria-pressed={(filters.region ?? "WCL") === region} onClick={() => setFilter("region", region)} className={`flex-1 rounded-md border border-coal-200 px-3 py-2 text-sm font-semibold ${(filters.region ?? "WCL") === region ? "bg-ore-50 text-ore-700" : "text-coal-600"}`}>{region}</button>)}
          </div>
          <span className="mb-2 mt-4 block text-xs font-semibold text-coal-500">Sites</span>
          <div role="group" aria-label="Sites" className="flex flex-wrap gap-2">
            {[{value: "All", label: "All sites"}, ...options.sites.filter((site) => site.group === (filters.region ?? "WCL"))].map((site) => <button key={site.value} type="button" aria-pressed={filters.siteId === site.value} onClick={() => setFilter("siteId", site.value)} className={`rounded-md border border-coal-200 px-3 py-2 text-left text-xs font-semibold ${filters.siteId === site.value ? "bg-ore-50 text-ore-700" : "text-coal-600"}`}>{site.label}</button>)}
          </div>
        </div>
        <FilterSelect label="Category" value={filters.assetCategory} options={withAll(options.categories).map((option) => ({ ...option, label: option.value === "HEMM" ? "Equipment" : option.label }))} onChange={(value) => setFilter("assetCategory", value as DashboardFilters["assetCategory"])} />
        <FilterSelect label="OEM" value={filters.company} options={withAll(options.companies)} onChange={(value) => setFilter("company", value as DashboardFilters["company"])} />
        <FilterSelect label="Model" value={filters.modelNumber} options={withAll(options.models)} onChange={(value) => setFilter("modelNumber", value)} />
        <FilterSelect label="Types of work" value={filters.contractType} options={withAll(options.contracts, "All Work Types")} onChange={(value) => setFilter("contractType", value as DashboardFilters["contractType"])} />
      </div>
      </>}
    </aside>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

type FilterOption = { value: string; label: string; group?: string };

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  const ungroupedOptions = options.filter((option) => !option.group);
  const groupedOptions = options.reduce<Record<string, typeof options>>((groups, option) => {
    if (!option.group) {
      return groups;
    }

    return {
      ...groups,
      [option.group]: [...(groups[option.group] ?? []), option],
    };
  }, {});

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-coal-500">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-coal-200 bg-white px-3 text-sm text-coal-800 outline-none transition focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
      >
        {ungroupedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {Object.entries(groupedOptions).map(([group, grouped]) => (
          <optgroup key={group} label={group}>
            {grouped.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function withAll(values: string[], allLabel = "All"): { value: string; label: string }[] {
  return [{ value: "All", label: allLabel }, ...values.map((value) => ({ value, label: value }))];
}
