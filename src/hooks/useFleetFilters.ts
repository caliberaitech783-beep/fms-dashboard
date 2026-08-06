import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardFilters, Site, Vehicle } from "../types/fleet";
import { MOCK_DATE_FROM, MOCK_DATE_TO } from "../constants/dateRange";
import {
  getConfiguredMakes,
  getConfiguredModels,
  getWorkbookMakeName,
  getWorkbookModelName,
} from "../constants/modelMake";
import { sites as seedSites, vehicles as seedVehicles } from "../data/mock/seed";
import { getPortalData } from "../services/dataAccess";
import { applyFleetFilterChange } from "../utils/filterState";
import { uniqueSorted } from "../utils/filters";

export const defaultFilters: DashboardFilters = {
  dateFrom: MOCK_DATE_FROM,
  dateTo: MOCK_DATE_TO,
  timeFrom: "00:00",
  timeTo: "23:59",
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
    company: company as Vehicle["company"],
    modelNumber: getWorkbookModelName(vehicle.assetType, company, vehicle.modelNumber),
  };
});

const LIVE_REPORT_OEMS: Vehicle["company"][] = ["Volvo", "Scania", "Eicher"];
const CATEGORY_OEMS: Partial<Record<Vehicle["assetCategory"], Vehicle["company"][]>> = {
  Truck: ["Volvo", "Scania", "Eicher"],
  HEMM: ["Case", "Komatsu", "LiuGong", "Tata Hitachi"],
};

export function useFleetFilters() {
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const [sites, setSites] = useState<Site[]>(seedSites);
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialFilterVehicles);

  useEffect(() => {
    let mounted = true;

    getPortalData().then((data) => {
      if (!mounted) {
        return;
      }

      setSites(data.sites);
      setVehicles(data.vehicles);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const options = useMemo<FilterOptions>(() => {
    const siteVehicles = vehicles.filter((vehicle) => (
      filters.siteId === "All" || vehicle.siteId === filters.siteId
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
      categories: uniqueSorted(contractVehicles.map((vehicle) => vehicle.assetCategory)),
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
