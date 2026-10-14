import { equipmentMasterService } from "./equipmentMasterService";
import { fetchSelectedOemFleet } from "./adapters/volvoRfmsAdapter";
import { getAuthSession } from "../auth/sessionService";
import { apiClient } from "./apiClient";
import type {
  DashboardFilters,
  FleetTelemetryRecord,
  IntegrationSource,
  Report,
  Site,
  Vehicle,
  WhatsAppDeliveryLog,
  WhatsAppReportSchedule,
} from "../types/fleet";
import { getWorkbookMakeName, getWorkbookModelName } from "../constants/modelMake";
import { filterTelemetryRecords, filterVehicles, isLiveOemSource } from "../utils/filters";

export interface PortalData {
  sites: Site[];
  vehicles: Vehicle[];
  records: FleetTelemetryRecord[];
  integrations: IntegrationSource[];
  reports: Report[];
  whatsAppSchedules: WhatsAppReportSchedule[];
  whatsAppDeliveryLogs: WhatsAppDeliveryLog[];
}

function normalizeVehicleModel(vehicle: Vehicle): Vehicle {
  const company = getWorkbookMakeName(vehicle.assetType, vehicle.company);
  const modelNumber = getWorkbookModelName(vehicle.assetType, company, vehicle.modelNumber);
  return {
    ...vehicle,
    company: company as Vehicle["company"],
    modelNumber,
  };
}

const portalRequests = new Map<string, Promise<PortalData>>();
export function invalidatePortalData() { portalRequests.clear(); }
export function getPortalData(company = "All"): Promise<PortalData> {
  const key = `${getAuthSession()?.token ?? ""}|${company}`;
  const pending = portalRequests.get(key);
  if (pending) return pending;
  const promise = loadPortalData(company);
  portalRequests.set(key, promise);
  void promise.finally(() => { if (portalRequests.get(key) === promise) portalRequests.delete(key); }).catch(() => undefined);
  return promise;
}
async function loadPortalData(company: string): Promise<PortalData> {
  const selected = await fetchSelectedOemFleet(company);
  const [sites, vehicles, records, masterSites] = await Promise.all([
    apiClient.fleet.fetchSites(),
    selected ? Promise.resolve(selected.vehicles) : apiClient.fleet.fetchVehicles(),
    selected ? Promise.resolve(selected.records) : apiClient.fleet.fetchTelemetry(),
    equipmentMasterService.sites().catch(() => []),
  ]);
  const normalizedVehicles = vehicles.map(normalizeVehicleModel);
  const normalizedVehicleById = new Map(normalizedVehicles.map((vehicle) => [vehicle.id, vehicle]));
  const normalizedRecords = records.map((record) => {
    const vehicle = normalizedVehicleById.get(record.vehicleId);
    if (!vehicle) return record;
    return {
      ...record,
      company: vehicle.company,
      modelNumber: vehicle.modelNumber,
    };
  });

  return {
    sites: sites.map(site => ({ ...site, name: masterSites.find(master => master.id === site.id)?.name || site.name })),
    vehicles: normalizedVehicles,
    records: normalizedRecords,
    integrations: [],
    reports: [],
    whatsAppSchedules: [],
    whatsAppDeliveryLogs: [],
  };
}

export async function getFilteredPortalData(filters: DashboardFilters) {
  const data = await getPortalData(filters.company);
  const filteredVehicles = filterVehicles(data.vehicles, filters);
  const filteredRecords = filterTelemetryRecords(data.records, data.vehicles, filters);
  const filteredVehicleIds = new Set(filteredRecords.map((record) => record.vehicleId));

  return {
    ...data,
    filteredVehicles: filteredVehicles.filter((vehicle) => (
      filteredVehicleIds.has(vehicle.id)
      || isLiveOemSource(vehicle.source)
      || filteredRecords.length === 0
    )),
    filteredRecords,
  };
}
