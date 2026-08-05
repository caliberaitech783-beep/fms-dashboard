export type ContractType = "Coal" | "OB";

export type AssetCategory = "Truck" | "HEMM" | "Unknown";

export type AssetType =
  | "Tipper"
  | "Truck"
  | "Haul Pack"
  | "Excavator"
  | "Loader"
  | "Grader"
  | "Crane"
  | "Other";

export type Company =
  | "Volvo"
  | "Scania"
  | "LiuGong"
  | "Eicher"
  | "Tata Hitachi"
  | "Case"
  | "Komatsu";

export type FuelMeasurementUnit = "km/L" | "L/hr";
export type ExtendedFuelMeasurementUnit = FuelMeasurementUnit | "Unknown";

export type VehicleStatus =
  | "running"
  | "idle"
  | "stopped"
  | "offline"
  | "maintenance"
  | "unknown";

export type ShiftCode = "A" | "B" | "C" | "UNKNOWN" | "ALL_DAY";

export type DataSource = "DUMMY_SAMPLE" | "VOLVO_RFMS_LIVE" | "SCANIA_RFMS_LIVE" | "EICHER_VECV_LIVE";

export interface Site {
  id: string;
  name: string;
  location: string;
  contractType: ContractType;
  active: boolean;
}

export interface Vehicle {
  id: string;
  vehicleNumber: string;
  source?: DataSource;
  assetCategory: AssetCategory;
  assetType: AssetType | null;
  company: Company;
  modelNumber: string | null;
  capacityM3: number | null;
  fuelMeasurementUnit: ExtendedFuelMeasurementUnit;
  trackerProvider: string;
  trackerId: string;
  siteId: string | null;
  siteName?: string | null;
  contractType: ContractType | null;
  status: VehicleStatus;
  commissioningDate: string | null;
  fuelTankCapacityLitres: number | null;
  standardFuelNorm: number | null;
  active: boolean;
}

export interface FleetTelemetryRecord {
  id: string;
  source: DataSource;
  vehicleId: string;
  vehicleNumber: string;
  driverId?: string | null;
  driverName?: string | null;
  driverMobile?: string | null;
  trackerId: string;
  timestamp: string;
  date: string;
  shift: ShiftCode;
  siteId: string | null;
  siteName: string | null;
  assetCategory: AssetCategory;
  assetType: AssetType | null;
  company: Company;
  modelNumber: string | null;
  location: string | null;
  odometerKm: number | null;
  distanceKm: number | null;
  engineHours: number | null;
  runningHours: number | null;
  idleHours: number | null;
  stoppedHours: number | null;
  offlineHours: number | null;
  availableHours: number | null;
  fuelConsumedLitres: number | null;
  fuelFilledLitres: number | null;
  fuelLevelLitres: number | null;
  fuelLevelPercent: number | null;
  trips: number | null;
  capacityM3: number | null;
  productionM3: number | null;
  leadKm: number | null;
  status: VehicleStatus;
  truckEfficiencyKmPerLitre: number | null;
  hemmFuelRateLitrePerHour: number | null;
  fuelPerTrip: number | null;
  fuelPerM3: number | null;
  idlePercentage: number | null;
  runningPercentage: number | null;
  utilizationPercentage: number | null;
  rawMetrics: Record<string, unknown>;
}

export type IntegrationSourceType = "API" | "CSV" | "Excel" | "SFTP" | "Manual";

export type IntegrationStatus =
  | "connected"
  | "sample_data"
  | "delayed"
  | "failed"
  | "not_configured";

export interface IntegrationSource {
  id: string;
  company: Company;
  sourceType: IntegrationSourceType;
  status: IntegrationStatus;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  recordsSyncedToday: number;
  mappedColumnsCount?: number;
  unmappedColumnsCount?: number;
  errorMessage?: string;
}

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertType =
  | "HIGH_FUEL_CONSUMPTION"
  | "LOW_KM_PER_LITRE"
  | "HIGH_L_PER_100KM"
  | "HIGH_LITRE_PER_HOUR"
  | "EXCESSIVE_IDLE"
  | "NO_DATA"
  | "SUDDEN_FUEL_DROP"
  | "LOW_PRODUCTION"
  | "HIGH_FUEL_PER_M3"
  | "OFFLINE_VEHICLE"
  | "WITHOUT_ADBLUE"
  | "LOW_ADBLUE"
  | "LOW_FUEL"
  | "STALE_VEHICLE_DATA"
  | "VOLVO_SYNC_FAILED"
  | "VOLVO_AUTH_FAILURE"
  | "DATA_MISMATCH"
  | "DATA_MAPPING_WARNING";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  type: AlertType;
  vehicleId: string;
  siteId: string | null;
  message: string;
  createdAt: string;
  acknowledged: boolean;
}

export type ReportExportFormat = "PDF" | "Excel" | "CSV";

export interface Report {
  id: string;
  name: string;
  type: string;
  filters: Record<string, string | number | boolean | null>;
  generatedAt: string;
  exportFormats: ReportExportFormat[];
  status: "ready" | "queued" | "failed";
}

export interface WhatsAppReportSchedule {
  id: string;
  reportType: string;
  siteId: string;
  shift: ShiftCode | "All";
  recipients: string[];
  frequency: "shift-wise" | "daily" | "monthly" | "on-demand";
  enabled: boolean;
}

export interface WhatsAppDeliveryLog {
  id: string;
  reportName: string;
  pdfFileName: string;
  recipientName: string;
  recipientNumber: string;
  sentAt: string;
  status: "sent" | "failed" | "pending";
  failureReason?: string;
  retryCount: number;
}

export interface DashboardFilters {
  dateFrom: string;
  dateTo: string;
  shift: ShiftCode | "All";
  siteId: string;
  contractType: ContractType | "All";
  assetCategory: AssetCategory | "All";
  assetType: AssetType | "All";
  company: Company | "All";
  modelNumber: string;
  vehicleNumber: string;
  status: VehicleStatus | "All";
  lead: string;
}

export interface VehicleWithTelemetry {
  vehicle: Vehicle;
  records: FleetTelemetryRecord[];
  latestRecord?: FleetTelemetryRecord;
}
