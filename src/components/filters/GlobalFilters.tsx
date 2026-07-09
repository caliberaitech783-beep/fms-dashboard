import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
import type { DashboardFilters } from "../../types/fleet";
import type { FilterOptions } from "../../hooks/useFleetFilters";
import { SHIFT_OPTIONS } from "../../constants/shifts";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface GlobalFiltersProps {
  filters: DashboardFilters;
  options: FilterOptions;
  setFilter: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void;
  resetFilters: () => void;
  onRefresh: () => void;
  showLoadingPointFilters?: boolean;
}

export function GlobalFilters({
  filters,
  options,
  setFilter,
  resetFilters,
  onRefresh,
  showLoadingPointFilters = true,
}: GlobalFiltersProps) {
  useEffect(() => {
    if (showLoadingPointFilters) {
      return;
    }

    if (filters.loadingPoint !== "All") {
      setFilter("loadingPoint", "All");
    }

    if (filters.unloadingPoint !== "All") {
      setFilter("unloadingPoint", "All");
    }
  }, [filters.loadingPoint, filters.unloadingPoint, setFilter, showLoadingPointFilters]);

  return (
    <div className="sticky top-0 z-20 border-b border-coal-200 bg-coal-50/95 px-4 py-3 backdrop-blur lg:px-6">
      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-coal-950">Unified Mining Fleet Fuel Monitoring Portal</h1>
            <Badge tone="good">Dummy Data Mode</Badge>
            <Badge tone="info">API Ready</Badge>
          </div>
          <p className="mt-1 text-sm text-coal-500">Fleet fuel, production, utilization, alerts, and tracker health command center.</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh} variant="primary">Refresh</Button>
          <Button icon={<RotateCcw className="h-4 w-4" />} onClick={resetFilters}>Reset</Button>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-10">
        <FilterInput label="From" type="date" value={filters.dateFrom} onChange={(value) => setFilter("dateFrom", value)} />
        <FilterInput label="To" type="date" value={filters.dateTo} onChange={(value) => setFilter("dateTo", value)} />
        <FilterSelect label="Shift" value={filters.shift} options={SHIFT_OPTIONS.map((shift) => ({ value: shift.value, label: shift.label }))} onChange={(value) => setFilter("shift", value as DashboardFilters["shift"])} />
        <SiteDrilldownSelect value={filters.siteId} options={options.sites} onChange={(value) => setFilter("siteId", value)} />
        <FilterSelect label="Types of work" value={filters.contractType} options={withAll(options.contracts, "All Work Types")} onChange={(value) => setFilter("contractType", value as DashboardFilters["contractType"])} />
        <FilterSelect label="Category" value={filters.assetCategory} options={withAll(options.categories)} onChange={(value) => setFilter("assetCategory", value as DashboardFilters["assetCategory"])} />
        <FilterSelect label="Type" value={filters.assetType} options={withAll(options.assetTypes)} onChange={(value) => setFilter("assetType", value as DashboardFilters["assetType"])} />
        <FilterSelect label="OEM" value={filters.company} options={withAll(options.companies)} onChange={(value) => setFilter("company", value as DashboardFilters["company"])} />
        <FilterSelect label="Model" value={filters.modelNumber} options={withAll(options.models)} onChange={(value) => setFilter("modelNumber", value)} />
        <FilterInput label="Vehicle" value={filters.vehicleNumber} placeholder="Search vehicle" onChange={(value) => setFilter("vehicleNumber", value)} />
        <FilterSelect label="Status" value={filters.status} options={withAll(options.statuses)} onChange={(value) => setFilter("status", value as DashboardFilters["status"])} />
        <FilterInput
          label="Lead"
          type="number"
          value={filters.lead === "All" ? "" : filters.lead}
          placeholder="Manual"
          min="0"
          step="0.1"
          onChange={(value) => setFilter("lead", value.trim() === "" ? "All" : value)}
        />
        {showLoadingPointFilters && (
          <>
            <FilterSelect label="Loading" value={filters.loadingPoint} options={withAll(options.loadingPoints, "All Loading")} onChange={(value) => setFilter("loadingPoint", value)} />
            <FilterSelect label="Unloading" value={filters.unloadingPoint} options={withAll(options.unloadingPoints, "All Unloading")} onChange={(value) => setFilter("unloadingPoint", value)} />
          </>
        )}
      </div>
    </div>
  );
}

interface FilterInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  min?: string;
  step?: string;
}

function FilterInput({ label, value, onChange, type = "text", placeholder, min, step }: FilterInputProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-coal-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        min={min}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-coal-200 bg-white px-3 text-sm text-coal-800 outline-none transition focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
      />
    </label>
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
