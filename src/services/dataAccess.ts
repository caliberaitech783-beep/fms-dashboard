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

export async function getPortalData(): Promise<PortalData> {
  const [
    sites,
    vehicles,
    records,
    integrations,
    reports,
    whatsAppSchedules,
    whatsAppDeliveryLogs,
  ] = await Promise.all([
    apiClient.fleet.fetchSites(),
    apiClient.fleet.fetchVehicles(),
    apiClient.fleet.fetchTelemetry(),
    apiClient.fleet.fetchIntegrations(),
    apiClient.fleet.fetchReports(),
    apiClient.fleet.fetchWhatsAppSchedules(),
    apiClient.fleet.fetchWhatsAppDeliveryLogs(),
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
    sites,
    vehicles: normalizedVehicles,
    records: normalizedRecords,
    integrations,
    reports,
    whatsAppSchedules,
    whatsAppDeliveryLogs,
  };
}

export async function getFilteredPortalData(filters: DashboardFilters) {
  const data = await getPortalData();
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
