import type { DashboardFilters } from "../types/fleet";

const KOLKATA_OFFSET = "+05:30";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function localDateTime(date: string, time: string): string {
  return `${date}T${time}:00${KOLKATA_OFFSET}`;
}

export function buildVolvoDriverReportQuery(filters: DashboardFilters): URLSearchParams {
  const hasValidPeriod = DATE_PATTERN.test(filters.dateFrom)
    && DATE_PATTERN.test(filters.dateTo)
    && TIME_PATTERN.test(filters.timeFrom)
    && TIME_PATTERN.test(filters.timeTo);
  const hasExplicitPeriod = hasValidPeriod && (
    filters.timePeriodMode === "custom"
    || !(filters.timeFrom === "00:00" && filters.timeTo === "23:59")
  );

  const query = new URLSearchParams({
    date: hasExplicitPeriod ? filters.dateFrom : filters.dateTo,
    shift: ["A", "B", "C"].includes(filters.shift) ? filters.shift : "A",
    site: !filters.siteId || filters.siteId === "All" ? "Gauri" : filters.siteId,
  });

  if (hasExplicitPeriod) {
    query.set("startTime", localDateTime(filters.dateFrom, filters.timeFrom));
    query.set("stopTime", localDateTime(filters.dateTo, filters.timeTo));
  }

  return query;
}
