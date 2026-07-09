import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardFilters } from "../types/fleet";
import { MOCK_DATE_FROM, MOCK_DATE_TO } from "../constants/dateRange";
import { getPortalData } from "../services/dataAccess";
import { uniqueSorted } from "../utils/filters";

export const defaultFilters: DashboardFilters = {
  dateFrom: MOCK_DATE_FROM,
  dateTo: MOCK_DATE_TO,
  shift: "All",
  siteId: "All",
  contractType: "All",
  assetCategory: "All",
  assetType: "All",
  company: "All",
  modelNumber: "All",
  vehicleNumber: "",
  status: "All",
  lead: "All",
  loadingPoint: "All",
  unloadingPoint: "All",
};

export interface FilterOptions {
  sites: { value: string; label: string; group?: string }[];
  contracts: string[];
  categories: string[];
  assetTypes: string[];
  companies: string[];
  models: string[];
  statuses: string[];
  loadingPoints: string[];
  unloadingPoints: string[];
}

export function useFleetFilters() {
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const [options, setOptions] = useState<FilterOptions>({
    sites: [],
    contracts: [],
    categories: [],
    assetTypes: [],
    companies: [],
    models: [],
    statuses: [],
    loadingPoints: [],
    unloadingPoints: [],
  });

  useEffect(() => {
    let mounted = true;

    getPortalData().then((data) => {
      if (!mounted) {
        return;
      }

      setOptions({
        sites: data.sites.map((site) => ({ value: site.id, label: site.name, group: site.location })),
        contracts: uniqueSorted(data.sites.map((site) => site.contractType)),
        categories: uniqueSorted(data.vehicles.map((vehicle) => vehicle.assetCategory)),
        assetTypes: uniqueSorted(data.vehicles.map((vehicle) => vehicle.assetType)),
        companies: uniqueSorted(data.vehicles.map((vehicle) => vehicle.company)),
        models: uniqueSorted(data.vehicles.map((vehicle) => vehicle.modelNumber)),
        statuses: uniqueSorted(data.vehicles.map((vehicle) => vehicle.status)),
        loadingPoints: uniqueSorted(data.records.map((record) => record.loadingPoint)),
        unloadingPoints: uniqueSorted(data.records.map((record) => record.unloadingPoint)),
      });
    });

    return () => {
      mounted = false;
    };
  }, []);

  const setFilter = useCallback(
    <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const resetFilters = useCallback(() => setFilters(defaultFilters), []);

  return useMemo(
    () => ({ filters, setFilter, setFilters, resetFilters, options }),
    [filters, options, resetFilters, setFilter],
  );
}
