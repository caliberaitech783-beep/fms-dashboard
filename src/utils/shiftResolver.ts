import type { ShiftCode } from "../types/fleet";

const TIME_ZONE = "Asia/Kolkata";

interface ShiftDefinition {
  name: Extract<ShiftCode, "A" | "B" | "C">;
  startMinute: number;
  endMinute: number;
  crossesMidnight?: boolean;
}

interface SiteGroup {
  sites: string[];
  shifts: ShiftDefinition[];
}

const SITE_GROUPS: SiteGroup[] = [
  {
    sites: ["sasti", "satsti", "dhoptala", "dudhichua", "dch", "dhc", "gauri", "pauni", "lalpeth"],
    shifts: [
      { name: "A", startMinute: 5 * 60, endMinute: 13 * 60 },
      { name: "B", startMinute: 13 * 60, endMinute: 21 * 60 },
      { name: "C", startMinute: 21 * 60, endMinute: 5 * 60, crossesMidnight: true },
    ],
  },
  {
    sites: ["majri", "jayant"],
    shifts: [
      { name: "A", startMinute: 4 * 60, endMinute: 12 * 60 },
      { name: "B", startMinute: 12 * 60, endMinute: 20 * 60 },
      { name: "C", startMinute: 20 * 60, endMinute: 4 * 60, crossesMidnight: true },
    ],
  },
];

const kolkataFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function matchingSiteGroup(siteName: string | null | undefined): SiteGroup | null {
  const normalized = String(siteName || "").trim().toLowerCase();
  if (!normalized) return null;
  return SITE_GROUPS.find((group) => group.sites.some((site) => (
    normalized === site || normalized.includes(site)
  ))) ?? null;
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function minuteToTime(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export interface OperationalShiftPeriod {
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
}

export function getOperationalShiftPeriod(
  siteName: string | null | undefined,
  shiftDate: string,
  shiftName: ShiftCode | "All",
): OperationalShiftPeriod | null {
  const group = matchingSiteGroup(siteName);
  const shift = group?.shifts.find((candidate) => candidate.name === shiftName);
  if (!shift || !/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) return null;

  return {
    dateFrom: shiftDate,
    dateTo: shift.crossesMidnight ? addDays(shiftDate, 1) : shiftDate,
    timeFrom: minuteToTime(shift.startMinute),
    timeTo: minuteToTime(shift.endMinute),
  };
}

function isMinuteInShift(minuteOfDay: number, shift: ShiftDefinition): boolean {
  if (shift.crossesMidnight) {
    return minuteOfDay >= shift.startMinute || minuteOfDay < shift.endMinute;
  }
  return minuteOfDay >= shift.startMinute && minuteOfDay < shift.endMinute;
}

export function resolveOperationalShift(
  siteName: string | null | undefined,
  timestamp: string | Date | null | undefined,
): ShiftCode {
  const group = matchingSiteGroup(siteName);
  const date = timestamp instanceof Date ? timestamp : new Date(String(timestamp || ""));
  if (!group || Number.isNaN(date.getTime())) return "UNKNOWN";

  const parts = Object.fromEntries(
    kolkataFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
  return group.shifts.find((shift) => isMinuteInShift(minuteOfDay, shift))?.name ?? "UNKNOWN";
}
