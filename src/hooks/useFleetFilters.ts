import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardFilters, Site, Vehicle } from "../types/fleet";
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
};

export interface FilterOptions {
  sites: { value: string; label: string; group?: string }[];
  contracts: string[];
  categories: string[];
  assetTypes: string[];
  companies: string[];
  models: string[];
  vehicles: string[];
  statuses: string[];
}

interface FleetCatalog {
  sites: Site[];
  vehicles: Vehicle[];
}

const emptyCatalog: FleetCatalog = { sites: [], vehicles: [] };

export function useFleetFilters() {
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const [catalog, setCatalog] = useState<FleetCatalog>(emptyCatalog);

  useEffect(() => {
    let mounted = true;

    getPortalData().then((data) => {
      if (mounted) {
        setCatalog({ sites: data.sites, vehicles: data.vehicles });
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const getOptionsFor = useCallback(
    (draftFilters: DashboardFilters) => buildFilterOptions(catalog, draftFilters),
    [catalog],
  );

  const options = useMemo(() => getOptionsFor(filters), [filters, getOptionsFor]);

  const setFilter = useCallback(
    <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const applyFilters = useCallback((nextFilters: DashboardFilters) => {
    setFilters({ ...nextFilters });
  }, []);

  const resetFilters = useCallback(() => setFilters({ ...defaultFilters }), []);

  return useMemo(
    () => ({ filters, setFilter, setFilters, applyFilters, resetFilters, options, getOptionsFor }),
    [applyFilters, filters, getOptionsFor, options, resetFilters, setFilter],
  );
}

function buildFilterOptions(catalog: FleetCatalog, filters: DashboardFilters): FilterOptions {
  const siteById = new Map(catalog.sites.map((site) => [site.id, site]));
  const matches = (vehicle: Vehicle, except?: keyof DashboardFilters) => {
    const site = vehicle.siteId ? siteById.get(vehicle.siteId) : undefined;
    const contractType = vehicle.contractType ?? site?.contractType ?? null;

    if (except !== "siteId" && filters.siteId !== "All" && vehicle.siteId !== filters.siteId) return false;
    if (except !== "contractType" && filters.contractType !== "All" && contractType !== filters.contractType) return false;
    if (except !== "assetCategory" && filters.assetCategory !== "All" && vehicle.assetCategory !== filters.assetCategory) return false;
    if (except !== "assetType" && filters.assetType !== "All" && vehicle.assetType !== filters.assetType) return false;
    if (except !== "company" && filters.company !== "All" && vehicle.company !== filters.company) return false;
    if (except !== "modelNumber" && filters.modelNumber !== "All" && vehicle.modelNumber !== filters.modelNumber) return false;
    if (except !== "status" && filters.status !== "All" && vehicle.status !== filters.status) return false;
    if (
      except !== "vehicleNumber"
      && filters.vehicleNumber.trim()
      && !vehicle.vehicleNumber.toLowerCase().includes(filters.vehicleNumber.trim().toLowerCase())
    ) return false;
    return true;
  };

  const eligibleSiteIds = new Set(catalog.vehicles.filter((vehicle) => matches(vehicle, "siteId")).map((vehicle) => vehicle.siteId));
  const sites = catalog.sites
    .filter((site) => eligibleSiteIds.has(site.id) || catalog.vehicles.length === 0)
    .sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name))
    .map((site) => ({ value: site.id, label: site.name, group: site.location }));

  return {
    sites: [{ value: "All", label: "All Sites" }, ...sites],
    contracts: uniqueSorted(
      catalog.vehicles
        .filter((vehicle) => matches(vehicle, "contractType"))
        .map((vehicle) => vehicle.contractType ?? (vehicle.siteId ? siteById.get(vehicle.siteId)?.contractType ?? "" : ""))
        .filter(Boolean),
    ),
    categories: uniqueSorted(catalog.vehicles.filter((vehicle) => matches(vehicle, "assetCategory")).map((vehicle) => vehicle.assetCategory)),
    assetTypes: uniqueSorted(
      catalog.vehicles
        .filter((vehicle) => matches(vehicle, "assetType"))
        .map((vehicle) => vehicle.assetType ?? "")
        .filter(Boolean),
    ),
    companies: uniqueSorted(catalog.vehicles.filter((vehicle) => matches(vehicle, "company")).map((vehicle) => vehicle.company)),
    models: uniqueSorted(
      catalog.vehicles
        .filter((vehicle) => matches(vehicle, "modelNumber"))
        .map((vehicle) => vehicle.modelNumber ?? "")
        .filter(Boolean),
    ),
    vehicles: uniqueSorted(catalog.vehicles.filter((vehicle) => matches(vehicle, "vehicleNumber")).map((vehicle) => vehicle.vehicleNumber)),
    statuses: uniqueSorted(catalog.vehicles.filter((vehicle) => matches(vehicle, "status")).map((vehicle) => vehicle.status)),
  };
}
