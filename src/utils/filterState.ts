import type { DashboardFilters } from "../types/fleet";

export function applyFleetFilterChange<K extends keyof DashboardFilters>(
  current: DashboardFilters,
  key: K,
  value: DashboardFilters[K],
): DashboardFilters {
  const next = { ...current, [key]: value };

  if (key === "siteId") {
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
  }

  return next;
}
