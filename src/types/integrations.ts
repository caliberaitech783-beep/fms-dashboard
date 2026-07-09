import type {
  FleetTelemetryRecord,
  IntegrationSource,
  Report,
  Site,
  Vehicle,
  WhatsAppDeliveryLog,
  WhatsAppReportSchedule,
} from "./fleet";

export interface FleetDataAdapter {
  fetchSites(): Promise<Site[]>;
  fetchVehicles(): Promise<Vehicle[]>;
  fetchTelemetry(): Promise<FleetTelemetryRecord[]>;
  fetchFuel(): Promise<FleetTelemetryRecord[]>;
  fetchTrips(): Promise<FleetTelemetryRecord[]>;
  fetchIntegrations(): Promise<IntegrationSource[]>;
  fetchReports(): Promise<Report[]>;
  fetchWhatsAppSchedules(): Promise<WhatsAppReportSchedule[]>;
  fetchWhatsAppDeliveryLogs(): Promise<WhatsAppDeliveryLog[]>;
  normalizeVehicle(payload: unknown): Vehicle;
  normalizeTelemetry(payload: unknown): FleetTelemetryRecord;
}
