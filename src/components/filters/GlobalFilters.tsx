import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import type { DashboardFilters } from "../../types/fleet";
import type { FilterOptions } from "../../hooks/useFleetFilters";
import { defaultFilters } from "../../hooks/useFleetFilters";
import { SHIFT_DEFINITIONS, SHIFT_OPTIONS } from "../../constants/shifts";
import { getShiftFromTimestamp } from "../../utils/shift";
import { activeDataSource } from "../../services/adapters";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";

interface GlobalFiltersProps {
  filters: DashboardFilters;
  options: FilterOptions;
  getOptionsFor?: (filters: DashboardFilters) => FilterOptions;
  applyFilters: (filters: DashboardFilters) => void;
  resetFilters: () => void;
  onRefresh: () => void;
}

export function GlobalFilters({
  filters,
  options,
  getOptionsFor,
  applyFilters,
  resetFilters,
  onRefresh,
}: GlobalFiltersProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardFilters>(filters);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const activeFilterCount = countActiveFilters(filters);
  const draftOptions = useMemo(
    () => getOptionsFor?.(draft) ?? options,
    [draft, getOptionsFor, options],
  );
  const selectedSite = options.sites.find((site) => site.value === filters.siteId);

  useEffect(() => {
    if (!drawerOpen) {
      setDraft(filters);
    }
  }, [drawerOpen, filters]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [drawerOpen]);

  const updateDraft = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
    setDraft((current) => {
      let next = { ...current, [key]: value };

      if (key === "dateFrom" && next.dateFrom > next.dateTo) {
        next = { ...next, dateTo: next.dateFrom };
      }
      if (key === "dateTo" && next.dateTo < next.dateFrom) {
        next = { ...next, dateFrom: next.dateTo };
      }

      return getOptionsFor ? reconcileDependentFilters(next, key, getOptionsFor) : next;
    });
  };

  const applyPreset = (preset: DatePreset) => {
    setDraft((current) => ({ ...current, ...preset.filters }));
  };

  const handleApply = () => {
    applyFilters(draft);
    setDrawerOpen(false);
  };

  const handleReset = () => {
    setDraft({ ...defaultFilters });
    resetFilters();
    setDrawerOpen(false);
  };

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-coal-200 bg-coal-50/95 px-4 py-3 backdrop-blur lg:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-coal-950 lg:text-xl">Mining Operations Command Centre</h1>
              <Badge tone="warning">Demo data</Badge>
              <Badge tone="info">API ready</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-coal-600">
              <span className="inline-flex items-center gap-1 font-medium">
                <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
                {formatPeriod(filters.dateFrom, filters.dateTo)}
              </span>
              <span aria-hidden="true">•</span>
              <span>{shiftLabel(filters.shift)}</span>
              <span aria-hidden="true">•</span>
              <span>{selectedSite?.label ?? "All Sites"}</span>
              {filters.vehicleNumber && (
                <>
                  <span aria-hidden="true">•</span>
                  <span>Vehicle: {filters.vehicleNumber}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              icon={<Filter aria-hidden="true" className="h-4 w-4" />}
              onClick={() => setDrawerOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              variant={activeFilterCount > 0 ? "primary" : "secondary"}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Button>
            <Button
              icon={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
              onClick={onRefresh}
              variant="secondary"
            >
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-coal-950/55"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close filters"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="global-filter-title"
            className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col bg-coal-50 shadow-command"
          >
            <div className="flex items-center justify-between border-b border-coal-200 bg-white px-4 py-4 sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ore-700">Operational drill-down</p>
                <h2 id="global-filter-title" className="text-xl font-semibold text-coal-950">Filter dashboard data</h2>
                <p className="mt-1 text-sm text-coal-500">Selections are staged until you apply them.</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close filters"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-coal-200 bg-white text-coal-700 hover:bg-coal-50"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <FilterSection title="Reporting period" description="Use a quick period or set exact dates and shift.">
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {buildDatePresets(
                    activeDataSource.mode === "demo" ? new Date(`${activeDataSource.asOf}T12:00:00`) : new Date(),
                    activeDataSource.mode === "demo",
                  ).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={cx(
                        "min-h-11 rounded-md border px-3 py-2 text-sm font-medium transition",
                        matchesPreset(draft, preset)
                          ? "border-ore-600 bg-ore-600 text-white"
                          : "border-coal-200 bg-white text-coal-700 hover:border-coal-300 hover:bg-coal-50",
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FilterInput label="From date" type="date" value={draft.dateFrom} onChange={(value) => updateDraft("dateFrom", value)} />
                  <FilterInput label="To date" type="date" value={draft.dateTo} onChange={(value) => updateDraft("dateTo", value)} />
                  <FilterSelect
                    label="Shift"
                    value={draft.shift}
                    options={SHIFT_OPTIONS.map((shift) => ({ value: shift.value, label: shift.label }))}
                    onChange={(value) => updateDraft("shift", value as DashboardFilters["shift"])}
                  />
                </div>
              </FilterSection>

              <FilterSection title="Mine and work context" description="Site choices narrow automatically by work type and available fleet.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <SiteDrilldownSelect value={draft.siteId} options={draftOptions.sites} onChange={(value) => updateDraft("siteId", value)} />
                  <FilterSelect
                    label="Work type"
                    value={draft.contractType}
                    options={withAll(draftOptions.contracts, "All Work Types")}
                    onChange={(value) => updateDraft("contractType", value as DashboardFilters["contractType"])}
                  />
                  <FilterInput
                    label="Lead distance (km)"
                    type="number"
                    value={draft.lead === "All" ? "" : draft.lead}
                    placeholder="Any lead"
                    min="0"
                    step="0.1"
                    onChange={(value) => updateDraft("lead", value.trim() === "" ? "All" : value)}
                  />
                </div>
              </FilterSection>

              <FilterSection title="Equipment drill-down" description="Each dropdown reflects the selections above, preventing incompatible combinations.">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <FilterSelect label="Category" value={draft.assetCategory} options={withAll(draftOptions.categories)} onChange={(value) => updateDraft("assetCategory", value as DashboardFilters["assetCategory"])} />
                  <FilterSelect label="Equipment type" value={draft.assetType} options={withAll(draftOptions.assetTypes)} onChange={(value) => updateDraft("assetType", value as DashboardFilters["assetType"])} />
                  <FilterSelect label="OEM" value={draft.company} options={withAll(draftOptions.companies)} onChange={(value) => updateDraft("company", value as DashboardFilters["company"])} />
                  <FilterSelect label="Model" value={draft.modelNumber} options={withAll(draftOptions.models)} onChange={(value) => updateDraft("modelNumber", value)} />
                  <FilterSelect label="Status" value={draft.status} options={withAll(draftOptions.statuses)} onChange={(value) => updateDraft("status", value as DashboardFilters["status"])} />
                  <FilterInput
                    label="Vehicle number"
                    value={draft.vehicleNumber}
                    placeholder="Type or select vehicle"
                    listId="vehicle-number-options"
                    onChange={(value) => updateDraft("vehicleNumber", value)}
                  />
                  <datalist id="vehicle-number-options">
                    {draftOptions.vehicles.map((vehicle) => <option key={vehicle} value={vehicle} />)}
                  </datalist>
                </div>
              </FilterSection>
            </div>

            <div className="border-t border-coal-200 bg-white px-4 py-3 sm:px-6">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />} onClick={handleReset} variant="ghost">
                  Reset all
                </Button>
                <div className="flex gap-2">
                  <Button className="flex-1 sm:flex-none" onClick={() => setDrawerOpen(false)}>Cancel</Button>
                  <Button
                    className="flex-1 sm:flex-none"
                    icon={<Check aria-hidden="true" className="h-4 w-4" />}
                    onClick={handleApply}
                    variant="primary"
                  >
                    Apply filters
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function FilterSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-xl border border-coal-200 bg-white p-4 last:mb-0 sm:p-5">
      <h3 className="font-semibold text-coal-950">{title}</h3>
      <p className="mb-4 mt-1 text-sm text-coal-500">{description}</p>
      {children}
    </section>
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
  listId?: string;
}

function FilterInput({ label, value, onChange, type = "text", placeholder, min, step, listId }: FilterInputProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-coal-600">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        min={min}
        step={step}
        list={listId}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-md border border-coal-200 bg-white px-3 text-sm text-coal-800 outline-none transition focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
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

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  const ungroupedOptions = options.filter((option) => !option.group);
  const groupedOptions = groupOptions(options);

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-coal-600">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-md border border-coal-200 bg-white px-3 text-sm text-coal-800 outline-none transition focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
      >
        {ungroupedOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
        {Object.entries(groupedOptions).map(([group, grouped]) => (
          <optgroup key={group} label={group}>
            {grouped.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

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
    ? selectedOption.group ? `${selectedOption.group} / ${selectedOption.label}` : selectedOption.label
    : "All Sites";
  const groups = useMemo(
    () => [...new Set(options.map((option) => option.group).filter((group): group is string => Boolean(group)))],
    [options],
  );
  const allOption = options.find((option) => option.value === "All");
  const groupSites = activeGroup ? options.filter((option) => option.group === activeGroup) : [];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActiveGroup(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setActiveGroup(null);
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
    setOpen(false);
    setActiveGroup(null);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <span className="mb-1 block text-xs font-semibold text-coal-600">Mine / Site</span>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setActiveGroup(selectedOption?.group ?? null);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-11 w-full items-center justify-between gap-2 rounded-md border border-coal-200 bg-white px-3 text-left text-sm text-coal-800 outline-none transition focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown aria-hidden="true" className={cx("h-4 w-4 shrink-0 text-coal-400 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Select mine and site"
          className="absolute left-0 top-full z-40 mt-1 flex w-[min(32rem,calc(100vw-3rem))] max-w-full overflow-hidden rounded-lg border border-coal-200 bg-white shadow-command"
        >
          <div className="w-40 shrink-0 border-r border-coal-200 bg-coal-50 p-1">
            {allOption && (
              <button
                type="button"
                role="menuitem"
                onClick={() => handleSelect(allOption.value)}
                className={cx(
                  "flex min-h-10 w-full items-center rounded px-2 text-left text-sm font-medium hover:bg-white focus:bg-white focus:outline-none",
                  value === "All" ? "text-ore-700" : "text-coal-800",
                )}
              >
                {allOption.label}
              </button>
            )}
            {groups.map((group) => (
              <button
                key={group}
                type="button"
                role="menuitem"
                onClick={() => setActiveGroup(group)}
                onFocus={() => setActiveGroup(group)}
                aria-expanded={activeGroup === group}
                className={cx(
                  "flex min-h-10 w-full items-center justify-between gap-2 rounded px-2 text-left text-sm font-medium focus:outline-none",
                  activeGroup === group ? "bg-white text-coal-950" : "text-coal-800 hover:bg-white focus:bg-white",
                )}
              >
                <span className="truncate">{group}</span>
                <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-coal-400" />
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 p-1">
            {activeGroup ? groupSites.map((site) => (
              <button
                key={site.value}
                type="button"
                role="menuitemradio"
                aria-checked={site.value === value}
                onClick={() => handleSelect(site.value)}
                className={cx(
                  "flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm hover:bg-coal-50 focus:bg-coal-50 focus:outline-none",
                  site.value === value ? "font-semibold text-ore-700" : "font-medium text-coal-800",
                )}
              >
                {site.label}
              </button>
            )) : (
              <p className="p-3 text-sm text-coal-500">Choose a mine or area to see its sites.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface DatePreset {
  id: string;
  label: string;
  filters: Pick<DashboardFilters, "dateFrom" | "dateTo" | "shift">;
}

function buildDatePresets(now = new Date(), anchoredToSource = false): DatePreset[] {
  const today = formatLocalDate(now);
  const yesterdayDate = addDays(now, -1);
  const yesterday = formatLocalDate(yesterdayDate);
  const currentShift = getShiftFromTimestamp(now.toISOString());
  const shiftDate = now.getHours() < 5 ? yesterday : today;

  return [
    {
      id: "current-shift",
      label: `${anchoredToSource ? "Latest" : "Current"} (${currentShift})`,
      filters: { dateFrom: shiftDate, dateTo: shiftDate, shift: currentShift },
    },
    { id: "today", label: anchoredToSource ? "As-of Day" : "Today", filters: { dateFrom: today, dateTo: today, shift: "All" } },
    { id: "yesterday", label: anchoredToSource ? "Previous Day" : "Yesterday", filters: { dateFrom: yesterday, dateTo: yesterday, shift: "All" } },
    {
      id: "last-7-days",
      label: anchoredToSource ? "Last 7 Data Days" : "Last 7 Days",
      filters: { dateFrom: formatLocalDate(addDays(now, -6)), dateTo: today, shift: "All" },
    },
  ];
}

function matchesPreset(filters: DashboardFilters, preset: DatePreset): boolean {
  return filters.dateFrom === preset.filters.dateFrom
    && filters.dateTo === preset.filters.dateTo
    && filters.shift === preset.filters.shift;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatPeriod(from: string, to: string): string {
  if (from === to) return formatReadableDate(from);
  return `${formatReadableDate(from)} – ${formatReadableDate(to)}`;
}

function formatReadableDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function shiftLabel(shift: DashboardFilters["shift"]): string {
  if (shift === "All") return "All Shifts";
  if (shift === "ALL_DAY") return "All Day";
  if (shift === "UNKNOWN") return "Unknown Shift";
  return `${SHIFT_DEFINITIONS[shift].label} (${SHIFT_DEFINITIONS[shift].start}–${SHIFT_DEFINITIONS[shift].end})`;
}

function countActiveFilters(filters: DashboardFilters): number {
  let count = filters.dateFrom !== defaultFilters.dateFrom || filters.dateTo !== defaultFilters.dateTo ? 1 : 0;
  const keys: Array<Exclude<keyof DashboardFilters, "dateFrom" | "dateTo">> = [
    "shift",
    "siteId",
    "contractType",
    "assetCategory",
    "assetType",
    "company",
    "modelNumber",
    "vehicleNumber",
    "status",
    "lead",
  ];
  for (const key of keys) {
    if (filters[key] !== defaultFilters[key]) count += 1;
  }
  return count;
}

function reconcileDependentFilters(
  filters: DashboardFilters,
  changedKey: keyof DashboardFilters,
  getOptionsFor: (filters: DashboardFilters) => FilterOptions,
): DashboardFilters {
  let next = { ...filters };
  const dependencyKeys: Array<keyof DashboardFilters> = [
    "siteId",
    "contractType",
    "assetCategory",
    "assetType",
    "company",
    "modelNumber",
    "status",
    "vehicleNumber",
  ];

  for (let pass = 0; pass < 3; pass += 1) {
    const options = getOptionsFor(next);
    let changed = false;
    for (const key of dependencyKeys) {
      if (key === changedKey) continue;
      const value = next[key];
      if (value === "All" || value === "") continue;

      const available = optionValuesForKey(options, key);
      const isAvailable = key === "vehicleNumber"
        ? available.some((option) => option.toLowerCase().includes(String(value).toLowerCase()))
        : available.includes(String(value));
      if (!isAvailable) {
        next = { ...next, [key]: key === "vehicleNumber" ? "" : "All" };
        changed = true;
      }
    }
    if (!changed) break;
  }

  return next;
}

function optionValuesForKey(options: FilterOptions, key: keyof DashboardFilters): string[] {
  switch (key) {
    case "siteId": return options.sites.map((option) => option.value);
    case "contractType": return options.contracts;
    case "assetCategory": return options.categories;
    case "assetType": return options.assetTypes;
    case "company": return options.companies;
    case "modelNumber": return options.models;
    case "status": return options.statuses;
    case "vehicleNumber": return options.vehicles;
    default: return [];
  }
}

function groupOptions(options: FilterOption[]): Record<string, FilterOption[]> {
  return options.reduce<Record<string, FilterOption[]>>((groups, option) => {
    if (option.group) {
      groups[option.group] = [...(groups[option.group] ?? []), option];
    }
    return groups;
  }, {});
}

function withAll(values: string[], allLabel = "All"): FilterOption[] {
  return [{ value: "All", label: allLabel }, ...values.map((value) => ({ value, label: value }))];
}
