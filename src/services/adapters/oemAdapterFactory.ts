import type { FleetTelemetryRecord, Vehicle } from "../../types/fleet";
import type { FleetDataAdapter } from "../../types/integrations";

export function createOemAdapterStub(company: string, envPrefix: string): FleetDataAdapter {
  return {
    async fetchSites() {
      return [];
    },
    async fetchVehicles(): Promise<Vehicle[]> {
      // TODO: Read `${envPrefix}_API_BASE_URL` and `${envPrefix}_API_KEY` from environment config.
      // TODO: Call the OEM vehicle endpoint and map payload fields in normalizeVehicle().
      console.info(`${company} adapter is not configured yet.`);
      return [];
    },
    async fetchTelemetry(): Promise<FleetTelemetryRecord[]> {
      // TODO: Call the OEM telemetry endpoint, then normalize timestamps, shifts, hours, fuel, trips, and status.
      return [];
    },
    async fetchFuel(): Promise<FleetTelemetryRecord[]> {
      // TODO: Call fuel-specific endpoints when available, or derive from normalized telemetry.
      return [];
    },
    async fetchTrips(): Promise<FleetTelemetryRecord[]> {
      // TODO: Call trip/production endpoints and normalize to FleetTelemetryRecord fields.
      return [];
    },
    async fetchIntegrations() {
      return [];
    },
    async fetchReports() {
      return [];
    },
    async fetchWhatsAppSchedules() {
      return [];
    },
    async fetchWhatsAppDeliveryLogs() {
      return [];
    },
    normalizeVehicle(payload: unknown): Vehicle {
      throw new Error(`${company} normalizeVehicle mapping is pending for payload: ${JSON.stringify(payload).slice(0, 120)}`);
    },
    normalizeTelemetry(payload: unknown): FleetTelemetryRecord {
      throw new Error(`${company} normalizeTelemetry mapping is pending for payload: ${JSON.stringify(payload).slice(0, 120)}`);
    },
  };
}
