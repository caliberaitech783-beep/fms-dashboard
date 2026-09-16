import type {
  Alert,
  FleetTelemetryRecord,
  IntegrationSource,
  Vehicle,
} from "./fleet";

export interface KpiMetric {
  label: string;
  value: string;
  subLabel?: string;
  tone?: "neutral" | "good" | "warning" | "danger" | "info";
}

export interface NamedMetric {
  name: string;
  fuelConsumedLitres: number;
  productionM3: number;
  distanceKm?: number;
  runningHours?: number;
  idleHours?: number;
  trips?: number;
  efficiency?: number | null;
  efficiencyUnit?: "km/L" | "L/hr";
}

export interface ShiftMetric extends NamedMetric {
  shift: string;
}

export interface StatusDistribution {
  status: string;
  value: number;
}

export interface DashboardOverview {
  kpis: KpiMetric[];
  productionFuelTrend: NamedMetric[];
  shiftComparison: ShiftMetric[];
  sitePerformance: NamedMetric[];
  companyPerformance: NamedMetric[];
  modelPerformance: NamedMetric[];
  statusDistribution: StatusDistribution[];
  categoryFuel: NamedMetric[];
  runningIdleTrend: NamedMetric[];
  highFuelVehicles: VehiclePerformanceRow[];
  lowEfficiencyVehicles: VehiclePerformanceRow[];
  idleVehicles: VehiclePerformanceRow[];
  criticalAlerts: Alert[];
  integrationHealth: IntegrationSource[];
  eicherLiveLocations?: EicherLiveDashboardRow[];
}

export interface VehiclePerformanceRow {
  vehicle: Vehicle;
  fuelConsumedLitres: number;
  distanceKm: number;
  runningHours: number;
  idleHours: number;
  trips: number;
  productionM3: number;
  efficiency: number | null;
  fuelPerM3: number | null;
  latestRecord?: FleetTelemetryRecord;
}

export interface EicherLiveDashboardRow {
  vehicleId: string;
  registrationNumber: string;
  chassisNumber: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  odometerKm: number | null;
  vehicleDirection: number | null;
  deviceId: string | null;
  currentLocation: string | null;
  gpsTimestamp: string | null;
  lastSuccessfulUpdate: string | null;
}
