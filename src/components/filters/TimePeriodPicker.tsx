import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";

export interface TimePeriodValue {
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
}

interface TimePeriodPickerProps extends TimePeriodValue {
  onApply: (value: TimePeriodValue) => void;
}

type PresetKey =
  | "today"
  | "yesterday"
  | "last-7-days"
  | "this-week"
  | "last-week"
  | "fortnight"
  | "last-30-days"
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "this-year";

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last-7-days", label: "Last 7 days" },
  { key: "this-week", label: "This week" },
  { key: "last-week", label: "Last week" },
  { key: "fortnight", label: "Fortnight" },
  { key: "last-30-days", label: "Last 30 days" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-quarter", label: "This quarter" },
  { key: "this-year", label: "This year" },
];

const START_OF_DAY = "00:00";
const END_OF_DAY = "23:59";

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(value: Date): Date {
  const offsetFromMonday = (value.getDay() + 6) % 7;
  return addDays(value, -offsetFromMonday);
}

function endOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0);
}

function presetRange(key: PresetKey, today = new Date()): Pick<TimePeriodValue, "dateFrom" | "dateTo"> {
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let from = current;
  let to = current;

  if (key === "yesterday") {
    from = addDays(current, -1);
    to = from;
  } else if (key === "last-7-days") {
    from = addDays(current, -6);
  } else if (key === "this-week") {
    from = startOfWeek(current);
  } else if (key === "last-week") {
    to = addDays(startOfWeek(current), -1);
    from = addDays(to, -6);
  } else if (key === "fortnight") {
    from = addDays(current, -13);
  } else if (key === "last-30-days") {
    from = addDays(current, -29);
  } else if (key === "this-month") {
    from = new Date(current.getFullYear(), current.getMonth(), 1);
  } else if (key === "last-month") {
    from = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    to = endOfMonth(from);
  } else if (key === "this-quarter") {
    from = new Date(current.getFullYear(), Math.floor(current.getMonth() / 3) * 3, 1);
  } else if (key === "this-year") {
    from = new Date(current.getFullYear(), 0, 1);
  }

  return { dateFrom: toDateKey(from), dateTo: toDateKey(to) };
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options).format(parseDateKey(value));
}

function formatRange(from: string, to: string): string {
  if (from === to) {
    return formatDate(from, { month: "short", day: "numeric", year: "numeric" });
  }

  const fromDate = parseDateKey(from);
  const toDate = parseDateKey(to);
  if (fromDate.getFullYear() === toDate.getFullYear() && fromDate.getMonth() === toDate.getMonth()) {
    return `${formatDate(from, { month: "short", day: "numeric" })} – ${toDate.getDate()}, ${toDate.getFullYear()}`;
  }

  return `${formatDate(from, { month: "short", day: "numeric", year: "numeric" })} – ${formatDate(to, { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
    .format(new Date(2026, 0, 1, hours, minutes));
}

function matchingPreset(value: TimePeriodValue): PresetKey | null {
  if (value.timeFrom !== START_OF_DAY || value.timeTo !== END_OF_DAY) return null;
  return PRESETS.find(({ key }) => {
    const range = presetRange(key);
    return range.dateFrom === value.dateFrom && range.dateTo === value.dateTo;
  })?.key ?? null;
}

export function TimePeriodPicker({ dateFrom, dateTo, timeFrom, timeTo, onApply }: TimePeriodPickerProps) {
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TimePeriodValue>({ dateFrom, dateTo, timeFrom, timeTo });
  const [viewMonth, setViewMonth] = useState(() => new Date(parseDateKey(dateFrom).getFullYear(), parseDateKey(dateFrom).getMonth(), 1));
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const todayKey = toDateKey(new Date());
  const activePreset = matchingPreset(draft);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const daysInMonth = endOfMonth(firstDay).getDate();
    const cellCount = Math.ceil((firstDay.getDay() + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - firstDay.getDay() + 1;
      return day >= 1 && day <= daysInMonth
        ? new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day)
        : null;
    });
  }, [viewMonth]);

  const openPicker = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - 320)), top: Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 440)) });
    const nextDraft = { dateFrom, dateTo, timeFrom, timeTo };
    setDraft(nextDraft);
    const fromDate = parseDateKey(dateFrom);
    setViewMonth(new Date(fromDate.getFullYear(), fromDate.getMonth(), 1));
    setSelectingEnd(false);
    setError(null);
    setOpen(true);
  };

  const applyPreset = (key: PresetKey) => {
    const range = presetRange(key);
    setDraft({ ...range, timeFrom: START_OF_DAY, timeTo: END_OF_DAY });
    const fromDate = parseDateKey(range.dateFrom);
    setViewMonth(new Date(fromDate.getFullYear(), fromDate.getMonth(), 1));
    setSelectingEnd(false);
    setError(null);
  };

  const selectDate = (date: Date) => {
    const selected = toDateKey(date);
    if (!selectingEnd) {
      setDraft((current) => ({ ...current, dateFrom: selected, dateTo: selected }));
      setSelectingEnd(true);
    } else {
      setDraft((current) => selected < current.dateFrom
        ? { ...current, dateFrom: selected, dateTo: current.dateFrom }
        : { ...current, dateTo: selected });
      setSelectingEnd(false);
    }
    setError(null);
  };

  const apply = () => {
    const start = new Date(`${draft.dateFrom}T${draft.timeFrom}:00`);
    const end = new Date(`${draft.dateTo}T${draft.timeTo}:59`);
    if (end < start) {
      setError("End time must be after start time.");
      return;
    }
    onApply(draft);
    setOpen(false);
  };

  const visibleSummary = `${formatTime(timeFrom)} – ${formatTime(timeTo)}`;

  return (
    <div ref={wrapperRef} className="relative md:col-span-2 xl:col-span-2 2xl:col-span-2">
      <span className="mb-1 block text-xs font-semibold text-coal-500">Time period</span>
      <button
        type="button"
        onClick={() => open ? setOpen(false) : openPicker()}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-10 w-full items-center justify-between gap-3 rounded-md border border-coal-200 bg-white px-3 text-left outline-none transition focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-coal-900">{formatRange(dateFrom, dateTo)}</span>
          <span className="block truncate text-[11px] text-coal-500">{visibleSummary}</span>
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 text-coal-600" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose time period"
          style={position}
          className="fixed z-50 max-h-[min(27rem,calc(100dvh-2rem))] w-[19rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-coal-200 bg-white shadow-command"
        >
          <div className="p-3">
            <label className="flex items-center gap-2 text-xs font-medium text-coal-600">
              Quick range
              <select aria-label="Quick range" value={activePreset ?? "custom"} onChange={(event) => { if (event.target.value !== "custom") applyPreset(event.target.value as PresetKey); }} className="h-8 min-w-0 flex-1 rounded-md border border-coal-200 bg-white px-2 text-xs text-coal-800">
                <option value="custom">Custom dates</option>
                {PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
              </select>
            </label>

            <div className="mt-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                  className="grid h-8 w-8 place-items-center rounded-full text-coal-600 hover:bg-coal-100 focus:outline-none focus:ring-2 focus:ring-ore-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <p className="text-sm font-semibold text-coal-900">
                  {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(viewMonth)}
                </p>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                  className="grid h-8 w-8 place-items-center rounded-full text-coal-600 hover:bg-coal-100 focus:outline-none focus:ring-2 focus:ring-ore-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-7 text-center text-xs font-medium text-coal-500">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`} className="py-1">{day}</span>)}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((date, index) => {
                  if (!date) return <span key={`blank-${index}`} className="h-7" />;
                  const key = toDateKey(date);
                  const isSelected = key === draft.dateFrom || key === draft.dateTo;
                  const isInRange = key > draft.dateFrom && key < draft.dateTo;
                  const isFuture = key > todayKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={formatDate(key, { month: "long", day: "numeric", year: "numeric" })}
                      aria-pressed={isSelected}
                      disabled={isFuture}
                      onClick={() => selectDate(date)}
                      className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-sm transition focus:outline-none focus:ring-2 focus:ring-ore-200 ${
                        isSelected
                          ? "bg-coal-950 font-semibold text-white"
                          : isInRange
                            ? "bg-coal-100 font-medium text-coal-900"
                            : isFuture
                              ? "cursor-not-allowed text-coal-300"
                              : "text-coal-800 hover:bg-coal-100"
                      }`}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-3 border-t border-coal-100 pt-2">
              <TimeInput
                label="Start time"
                value={draft.timeFrom}
                date={draft.dateFrom}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, timeFrom: value }));
                  setError(null);
                }}
              />
              <TimeInput
                label="End time"
                value={draft.timeTo}
                date={draft.dateTo}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, timeTo: value }));
                  setError(null);
                }}
              />
            </div>

            {error && <p className="mt-3 text-xs font-medium text-safety-red">{error}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-8 rounded-md px-4 text-sm font-medium text-coal-700 hover:bg-coal-100 focus:outline-none focus:ring-2 focus:ring-coal-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="h-8 rounded-md bg-coal-950 px-5 text-sm font-semibold text-white hover:bg-coal-800 focus:outline-none focus:ring-2 focus:ring-coal-300"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TimeInputProps {
  label: string;
  value: string;
  date: string;
  onChange: (value: string) => void;
}

function TimeInput({ label, value, date, onChange }: TimeInputProps) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs font-medium text-coal-600">{label}</span>
      <span className="relative mt-1 block">
        <input
          type="time"
          step="60"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full border-0 border-b border-coal-400 bg-transparent pr-7 text-sm text-coal-900 outline-none focus:border-coal-950"
        />
        <Clock3 className="pointer-events-none absolute right-1 top-2.5 h-4 w-4 text-coal-700" />
      </span>
      <span className="mt-1 block truncate text-xs text-coal-500">{formatDate(date, { month: "short", day: "numeric", year: "numeric" })}</span>
    </label>
  );
}
