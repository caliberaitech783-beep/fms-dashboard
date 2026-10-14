import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardFilters, Site, Vehicle } from "../types/fleet";

import {
  getConfiguredMakes,
  getConfiguredModels,
  getWorkbookMakeName,
  getWorkbookModelName,
} from "../constants/modelMake";
import { vehicles as seedVehicles } from "../data/mock/seed";
import { getPortalData } from "../services/dataAccess";
import { applyFleetFilterChange } from "../utils/filterState";
import { DASHBOARD_SITES, dashboardSiteId } from "../constants/sites";
import { uniqueSorted } from "../utils/filters";

export const defaultFilters: DashboardFilters = {
  dateFrom: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
  dateTo: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
  timeFrom: "00:00",
  timeTo: "23:59",
  timePeriodMode: "schedule",
  shift: "A",
  siteId: "All",
  region: "WCL",
  contractType: "All",
  assetCategory: "All",
  assetType: "All",
  company: "All",
  modelNumber: "All",
  vehicleNumber: "",
  status: "All",
  lead: "All",
};

export interface FilterOptions {
  sites: { value: string; label: string; group?: string }[];
  contracts: string[];
  categories: string[];
  assetTypes: string[];
  companies: string[];
  models: string[];
  statuses: string[];
}

const initialFilterVehicles = seedVehicles.map((vehicle) => {
  const company = getWorkbookMakeName(vehicle.assetType, vehicle.company);
  return {
    ...vehicle,
    siteId: dashboardSiteId(vehicle.siteId),
    company: company as Vehicle["company"],
    modelNumber: getWorkbookModelName(vehicle.assetType, company, vehicle.modelNumber),
  };
});

const LIVE_REPORT_OEMS: Vehicle["company"][] = ["Volvo", "Scania", "Eicher", "LiuGong"];
const CATEGORY_OEMS: Partial<Record<Vehicle["assetCategory"], Vehicle["company"][]>> = {
  Truck: ["Volvo", "Scania", "Eicher", "LiuGong"],
  HEMM: ["Case", "Komatsu", "LiuGong", "Tata Hitachi"],
};

export function useFleetFilters() {
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const sites: Site[] = DASHBOARD_SITES;
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialFilterVehicles);

  useEffect(() => {
    let mounted = true;

    getPortalData().then((data) => {
      if (!mounted) {
        return;
      }

      setVehicles(data.vehicles);
    }).catch(() => { /* Site options remain available even if OEM data is unavailable. */ });

    return () => {
      mounted = false;
    };
  }, []);

  const options = useMemo<FilterOptions>(() => {
    const siteVehicles = vehicles.filter((vehicle) => (
      (filters.siteId === "All" || vehicle.siteId === filters.siteId) && (!filters.region || Boolean(vehicle.siteId?.toLowerCase().includes(`-${filters.region.toLowerCase()}-`)))
    ));
    const contractVehicles = siteVehicles.filter((vehicle) => (
      filters.contractType === "All" || vehicle.contractType === filters.contractType
    ));
    const categoryVehicles = contractVehicles.filter((vehicle) => (
      filters.assetCategory === "All" || vehicle.assetCategory === filters.assetCategory
    ));
    const typeVehicles = categoryVehicles.filter((vehicle) => (
      filters.assetType === "All" || vehicle.assetType === filters.assetType
    ));
    const companyVehicles = typeVehicles.filter((vehicle) => (
      filters.company === "All" || vehicle.company === filters.company
    ));

    const configuredMakes = filters.assetType === "All"
      ? null
      : getConfiguredMakes(filters.assetType);
    const configuredModels = filters.assetType === "All"
      ? null
      : getConfiguredModels(filters.assetType, filters.company);
    const categoryCompanies = uniqueSorted(typeVehicles.map((vehicle) => vehicle.company));
    const categoryOems = filters.assetCategory === "All"
      ? null
      : CATEGORY_OEMS[filters.assetCategory];
    const availableCompanies = categoryOems
      ?? configuredMakes
      ?? uniqueSorted([...categoryCompanies, ...LIVE_REPORT_OEMS]);

    return {
      sites: sites.map((site) => ({ value: site.id, label: site.name, group: site.location })),
      contracts: uniqueSorted(sites.map((site) => site.contractType)),
      categories: ["Truck", "HEMM"],
      assetTypes: uniqueSorted(categoryVehicles.map((vehicle) => vehicle.assetType)),
      companies: uniqueSorted(availableCompanies),
      models: configuredModels ?? uniqueSorted(companyVehicles.map((vehicle) => vehicle.modelNumber)),
      statuses: uniqueSorted(companyVehicles.map((vehicle) => vehicle.status)),
    };
  }, [
    filters.assetCategory,
    filters.assetType,
    filters.company,
    filters.contractType,
    filters.siteId,
    filters.region,
    sites,
    vehicles,
  ]);

  const setFilter = useCallback(
    <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
      setFilters((current) => applyFleetFilterChange(current, key, value));
    },
    [],
  );

  const resetFilters = useCallback(() => setFilters(defaultFilters), []);

  return useMemo(
    () => ({ filters, setFilter, setFilters, resetFilters, options }),
    [filters, options, resetFilters, setFilter],
  );
}
