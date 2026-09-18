import type { DashboardFilters } from "../types/fleet";
import { getOperationalShiftPeriod } from "./shiftResolver.ts";

type FleetTimePeriod = Pick<DashboardFilters, "dateFrom" | "dateTo" | "timeFrom" | "timeTo">;

function withSelectedShiftPeriod(filters: DashboardFilters, shiftDate: string): DashboardFilters {
  const period = getOperationalShiftPeriod(filters.siteId, shiftDate, filters.shift);
  return period
    ? { ...filters, ...period, timePeriodMode: "schedule" }
    : filters.siteId === "All" ? { ...filters, dateFrom: shiftDate, dateTo: shiftDate, timeFrom: "00:00", timeTo: "23:59", timePeriodMode: "schedule" } : filters;
}

export function applyFleetTimePeriod(
  current: DashboardFilters,
  period: FleetTimePeriod,
): DashboardFilters {
  return { ...current, ...period, timePeriodMode: "custom" };
}

export function applyFleetFilterChange<K extends keyof DashboardFilters>(
  current: DashboardFilters,
  key: K,
  value: DashboardFilters[K],
): DashboardFilters {
  let next = { ...current, [key]: value };

  if (key === "region") {
    next.siteId = "All";
    next.modelNumber = "All";
  } else if (key === "siteId") {
    next.contractType = "All";
    next.assetCategory = "All";
    next.assetType = "All";
    next.modelNumber = "All";
  } else if (key === "contractType") {
    next.assetCategory = "All";
    next.assetType = "All";
    next.company = "All";
    next.modelNumber = "All";
  } else if (key === "assetCategory") {
    next.assetType = "All";
    next.company = "All";
    next.modelNumber = "All";
  } else if (key === "assetType") {
    next.company = "All";
    next.modelNumber = "All";
  } else if (key === "company") {
    next.modelNumber = "All";
    if (value === "LiuGong") next = liuGongDailyFilters(next);
  }

  if (key === "shift" && value === "All") {
    next = { ...next, dateTo: current.dateFrom, timeFrom: "00:00", timeTo: "23:59", timePeriodMode: "schedule" };
  } else if (key === "shift" && ["A", "B", "C"].includes(String(value))) {
    const shiftDate = ["A", "B", "C"].includes(current.shift)
      ? current.dateFrom
      : current.dateTo;
    next = withSelectedShiftPeriod(next, shiftDate);
  } else if (key === "siteId" && ["A", "B", "C"].includes(next.shift)) {
    next = withSelectedShiftPeriod(next, current.dateFrom);
  }

  return next;
}

/** LiuGong NBI exposes calendar-day totals, not shift intervals. */
export function liuGongDailyFilters(filters: DashboardFilters): DashboardFilters {
  return { ...filters, company: "LiuGong", shift: "All", timeFrom: "00:00", timeTo: "23:59", timePeriodMode: "custom", modelNumber: "All" };
}
