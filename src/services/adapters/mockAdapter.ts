import {
  integrationSources,
  reports,
  sites,
  telemetryRecords,
  vehicles,
  whatsAppDeliveryLogs,
  whatsAppSchedules,
} from "../../data/mock/seed";
import type { FleetDataAdapter } from "../../types/integrations";
import type { FleetTelemetryRecord, Vehicle } from "../../types/fleet";

export const mockAdapter: FleetDataAdapter = {
  async fetchSites() {
    return sites;
  },
  async fetchVehicles() {
    return vehicles;
  },
  async fetchTelemetry() {
    return telemetryRecords;
  },
  async fetchFuel() {
    return telemetryRecords.filter((record) => record.fuelConsumedLitres !== null);
  },
  async fetchTrips() {
    return telemetryRecords.filter((record) => record.trips !== null);
  },
  async fetchIntegrations() {
    return integrationSources;
  },
  async fetchReports() {
    return reports;
  },
  async fetchWhatsAppSchedules() {
    return whatsAppSchedules;
  },
  async fetchWhatsAppDeliveryLogs() {
    return whatsAppDeliveryLogs;
  },
  normalizeVehicle(payload: unknown): Vehicle {
    return payload as Vehicle;
  },
  normalizeTelemetry(payload: unknown): FleetTelemetryRecord {
    return payload as FleetTelemetryRecord;
  },
};
