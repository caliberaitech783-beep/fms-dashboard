import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw, SlidersHorizontal, X } from "lucide-react";
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
        <FilterSelect label="Shift" value={filters.shift} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.value, label: shift.label }))} onChange={(value) => setFilter("shift", value as DashboardFilters["shift"])} />
        <SiteDrilldownSelect value={filters.siteId} options={options.sites} onChange={(value) => setFilter("siteId", value)} />
        <FilterSelect label="Types of work" value={filters.contractType} options={withAll(options.contracts, "All Work Types")} onChange={(value) => setFilter("contractType", value as DashboardFilters["contractType"])} />
        <FilterSelect label="Category" value={filters.assetCategory} options={withAll(options.categories).map((option) => ({ ...option, label: option.value === "HEMM" ? "Equipment" : option.label }))} onChange={(value) => setFilter("assetCategory", value as DashboardFilters["assetCategory"])} />
        <FilterSelect label="OEM" value={filters.company} options={withAll(options.companies)} onChange={(value) => setFilter("company", value as DashboardFilters["company"])} />
        <FilterSelect label="Model" value={filters.modelNumber} options={withAll(options.models)} onChange={(value) => setFilter("modelNumber", value)} />
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

interface SiteDrilldownSelectProps {
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

function SiteDrilldownSelect({ value, options, onChange }: SiteDrilldownSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption
    ? selectedOption.group
      ? `${selectedOption.group} / ${selectedOption.label}`
      : selectedOption.label
    : "All Sites";
  const groups = useMemo(
    () => [...new Set(options.map((option) => option.group).filter((group): group is string => Boolean(group)))],
    [options],
  );
  const groupSites = activeGroup ? options.filter((option) => option.group === activeGroup) : [];

  const close = () => {
    setOpen(false);
    setActiveGroup(null);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        close();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    close();
  };

  return (
    <div ref={wrapperRef} className="relative">
      <span className="mb-1 block text-xs font-semibold text-coal-500">Sites</span>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => {
            if (current) {
              setActiveGroup(null);
              return false;
            }

            setActiveGroup(null);
            return true;
          });
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-coal-200 bg-white px-3 text-left text-sm text-coal-800 outline-none transition focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-coal-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className={`absolute left-0 top-full z-40 mt-1 flex max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-coal-200 bg-white shadow-command ${activeGroup ? "w-[32rem]" : "w-40"}`}>
          <div className="w-40 shrink-0 border-r border-coal-200 bg-coal-50 p-1">
            {groups.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => setActiveGroup(group)}
                onFocus={() => setActiveGroup(group)}
                aria-expanded={activeGroup === group}
                className={`flex h-9 w-full items-center justify-between gap-2 rounded px-2 text-left text-sm font-medium focus:outline-none ${
                  activeGroup === group ? "bg-white text-coal-950" : "text-coal-800 hover:bg-white focus:bg-white"
                }`}
              >
                <span>{group}</span>
                <ChevronRight className="h-4 w-4 text-coal-400" />
              </button>
            ))}
          </div>

          {activeGroup && (
            <div className="min-w-0 flex-1 p-1">
              {groupSites.map((site) => (
                <button
                  key={site.value}
                  type="button"
                  onClick={() => handleSelect(site.value)}
                  className={`flex min-h-9 w-full items-center rounded px-2 py-2 text-left text-sm hover:bg-coal-50 focus:bg-coal-50 focus:outline-none ${
                    site.value === value ? "font-semibold text-ore-700" : "font-medium text-coal-800"
                  }`}
                >
                  {site.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
