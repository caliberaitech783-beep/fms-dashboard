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
import { filterTelemetryRecords, filterVehicles } from "../utils/filters";

export interface PortalData {
  sites: Site[];
  vehicles: Vehicle[];
  records: FleetTelemetryRecord[];
  integrations: IntegrationSource[];
  reports: Report[];
  whatsAppSchedules: WhatsAppReportSchedule[];
  whatsAppDeliveryLogs: WhatsAppDeliveryLog[];
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

  return {
    sites,
    vehicles,
    records,
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
      || vehicle.source === "VOLVO_RFMS_LIVE"
      || filteredRecords.length === 0
    )),
    filteredRecords,
  };
}
