const TIME_ZONE = "Asia/Kolkata";
const KOLKATA_OFFSET = "+05:30";

const SITE_GROUPS = [
  {
    name: "Sasti/Dhoptala/Dudhichua/Gauri",
    sites: ["sasti", "dhoptala", "dudhichua", "dch", "dhc", "gauri"],
    shifts: [
      { name: "A", startMinute: 5 * 60, endMinute: 13 * 60 },
      { name: "B", startMinute: 13 * 60, endMinute: 21 * 60 },
      { name: "C", startMinute: 21 * 60, endMinute: 5 * 60, crossesMidnight: true },
    ],
  },
  {
    name: "Majri/Jayant",
    sites: ["majri", "jayant"],
    shifts: [
      { name: "A", startMinute: 4 * 60, endMinute: 12 * 60 },
      { name: "B", startMinute: 12 * 60, endMinute: 20 * 60 },
      { name: "C", startMinute: 21 * 60, endMinute: 4 * 60, crossesMidnight: true },
    ],
  },
];

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function normalizeSiteName(siteName) {
  return String(siteName || "").trim().toLowerCase();
}

function findSiteGroup(siteName) {
  const normalized = normalizeSiteName(siteName);
  return SITE_GROUPS.find((group) => group.sites.some((site) => (
    normalized === site || normalized.includes(site)
  ))) || null;
}

function parseDateTime(value) {
  if (value instanceof Date) {
    return value;
  }

  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const hasTimeZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (hasTimeZone) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
    const utcMs = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 5,
      Number(minute) - 30,
      Number(second),
    );
    return new Date(utcMs);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getKolkataParts(date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function localIso(dateString, minuteOfDay) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${dateString}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${KOLKATA_OFFSET}`;
}

function shiftWindow(localDate, minuteOfDay, shift) {
  if (!shift.crossesMidnight) {
    return {
      shiftDate: localDate,
      shiftStart: localIso(localDate, shift.startMinute),
      shiftEnd: localIso(localDate, shift.endMinute),
    };
  }

  if (minuteOfDay < shift.endMinute) {
    const previousDate = addDays(localDate, -1);
    return {
      shiftDate: previousDate,
      shiftStart: localIso(previousDate, shift.startMinute),
      shiftEnd: localIso(localDate, shift.endMinute),
    };
  }

  return {
    shiftDate: localDate,
    shiftStart: localIso(localDate, shift.startMinute),
    shiftEnd: localIso(addDays(localDate, 1), shift.endMinute),
  };
}

function isMinuteInShift(minuteOfDay, shift) {
  if (shift.crossesMidnight) {
    return minuteOfDay >= shift.startMinute || minuteOfDay < shift.endMinute;
  }

  return minuteOfDay >= shift.startMinute && minuteOfDay < shift.endMinute;
}

function resolveShift(siteName, dateTimeValue) {
  const siteGroup = findSiteGroup(siteName);
  const parsedDate = parseDateTime(dateTimeValue);

  if (!siteGroup || !parsedDate) {
    return {
      active: false,
      siteGroup: siteGroup?.name || null,
      shiftName: null,
      shiftStart: null,
      shiftEnd: null,
      shiftDate: null,
      timezone: TIME_ZONE,
    };
  }

  const parts = getKolkataParts(parsedDate);
  const localDate = dateKey(parts);
  const minuteOfDay = parts.hour * 60 + parts.minute + parts.second / 60;
  const shift = siteGroup.shifts.find((candidate) => isMinuteInShift(minuteOfDay, candidate));

  if (!shift) {
    return {
      active: false,
      siteGroup: siteGroup.name,
      shiftName: null,
      shiftStart: null,
      shiftEnd: null,
      shiftDate: null,
      timezone: TIME_ZONE,
    };
  }

  return {
    active: true,
    siteGroup: siteGroup.name,
    shiftName: shift.name,
    ...shiftWindow(localDate, minuteOfDay, shift),
    timezone: TIME_ZONE,
  };
}

function getShiftWindow(siteName, shiftDate, shiftName) {
  const siteGroup = findSiteGroup(siteName);
  const normalizedDate = String(shiftDate || "").trim();
  const normalizedShift = String(shiftName || "").trim().toUpperCase();
  const shift = siteGroup?.shifts.find((candidate) => candidate.name === normalizedShift);

  if (!siteGroup || !shift || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    return {
      active: false,
      siteGroup: siteGroup?.name || null,
      shiftName: null,
      shiftStart: null,
      shiftEnd: null,
      shiftDate: null,
      timezone: TIME_ZONE,
    };
  }

  return {
    active: true,
    siteGroup: siteGroup.name,
    shiftName: shift.name,
    ...shiftWindow(normalizedDate, shift.startMinute, shift),
    timezone: TIME_ZONE,
  };
}

function getReportWindow(siteName, shiftDate, shiftName, startTime, stopTime) {
  const scheduledWindow = getShiftWindow(siteName, shiftDate, shiftName);
  const normalizedStart = String(startTime || "").trim();
  const normalizedStop = String(stopTime || "").trim();
  const customTimeRange = Boolean(normalizedStart || normalizedStop);

  if (!scheduledWindow.active || !customTimeRange) {
    return {
      ...scheduledWindow,
      customTimeRange,
      validationError: null,
    };
  }

  if (!normalizedStart || !normalizedStop) {
    return {
      ...scheduledWindow,
      active: false,
      customTimeRange: true,
      validationError: "Both startTime and stopTime are required for a custom report period.",
    };
  }

  const start = parseDateTime(normalizedStart);
  const stop = parseDateTime(normalizedStop);
  const scheduledStart = parseDateTime(scheduledWindow.shiftStart);
  const scheduledEnd = parseDateTime(scheduledWindow.shiftEnd);
  if (!start || !stop || start >= stop) {
    return {
      ...scheduledWindow,
      active: false,
      customTimeRange: true,
      validationError: "The custom report start and stop times are invalid.",
    };
  }

  if (start < scheduledStart || stop > scheduledEnd) {
    return {
      ...scheduledWindow,
      active: false,
      customTimeRange: true,
      validationError: "The custom report period must fall within the selected shift.",
    };
  }

  return {
    ...scheduledWindow,
    shiftStart: start.toISOString(),
    shiftEnd: stop.toISOString(),
    customTimeRange: true,
    validationError: null,
  };
}

module.exports = {
  getReportWindow,
  getShiftWindow,
  resolveShift,
  TIME_ZONE,
};
