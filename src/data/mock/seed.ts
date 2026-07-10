import type {
  AssetType,
  Company,
  FleetTelemetryRecord,
  IntegrationSource,
  Report,
  ShiftCode,
  Site,
  Vehicle,
  VehicleStatus,
  WhatsAppDeliveryLog,
  WhatsAppReportSchedule,
} from "../../types/fleet";
import type { ReportType } from "../../types/reports";
import { reportTypes } from "../../types/reports";
import {
  calculateFuelPerM3,
  calculateFuelPerTrip,
  calculateHemmFuelRate,
  calculateIdlePercentage,
  calculateProduction,
  calculateRunningPercentage,
  calculateTruckEfficiency,
  calculateUtilization,
} from "../../utils/calculations";

export const DUMMY_DATA_END_DATE = "2026-07-08";

export const sites: Site[] = [
  { id: "site-wcl-sasti-ocm", name: "Sasti OCM", location: "WCL", contractType: "Coal", active: true },
  { id: "site-wcl-dhoptala-ocm", name: "Dhoptala OCM", location: "WCL", contractType: "Coal", active: true },
  { id: "site-wcl-lalpeth-ocm", name: "Lalpeth OCM", location: "WCL", contractType: "Coal", active: true },
  { id: "site-wcl-majri-ocm", name: "Majri OCM", location: "WCL", contractType: "Coal", active: true },
  { id: "site-wcl-gauri-pauni", name: "Gauri Pauni OCM", location: "WCL", contractType: "Coal", active: true },
  { id: "site-ncl-jayant-1", name: "Jayant 1", location: "NCL", contractType: "Coal", active: true },
  { id: "site-ncl-jayant-2", name: "Jayant 2", location: "NCL", contractType: "Coal", active: true },
  { id: "site-ncl-dch-west", name: "DCH West", location: "NCL", contractType: "OB", active: true },
  { id: "site-ncl-dch-east", name: "DCH East", location: "NCL", contractType: "OB", active: true },
];

const companies: Company[] = ["Volvo", "Scania", "LiuGong", "Eicher", "Tata Hitachi", "Case", "Komatsu"];
const truckTypes: AssetType[] = ["Tipper", "Truck", "Haul Pack"];
const hemmTypes: AssetType[] = ["Excavator", "Loader", "Grader", "Crane", "Other"];
const statuses: VehicleStatus[] = ["running", "idle", "stopped", "offline", "maintenance"];
const trackerProviders = ["Wialon", "Teltonika", "Trimble", "OEM Cloud", "MineTrack"];

const companyModels: Record<Company, { truck: string[]; hemm: string[] }> = {
  Volvo: { truck: ["FMX 440", "FMX 480", "FMX 520"], hemm: ["EC750D", "L350H", "G946C"] },
  Scania: { truck: ["P410", "G460", "R500"], hemm: ["L280", "G500 Yard"] },
  LiuGong: { truck: ["DW90A", "DW105A"], hemm: ["CLG950E", "CLG856H", "CLG4180D"] },
  Eicher: { truck: ["Pro 6028T", "Pro 8035XM", "Pro 6055"], hemm: ["Site Support 220"] },
  "Tata Hitachi": { truck: ["Prima 3530", "Prima 4030"], hemm: ["EX 210LC", "EX 350LC", "ZW 225"] },
  Case: { truck: ["CX Tipper 2518", "CX Tipper 3123"], hemm: ["770NXe", "845B", "1107EX"] },
  Komatsu: { truck: ["HD465", "HD785", "HM400"], hemm: ["PC450", "PC800", "WA500"] },
};

function makeRandom(seed = 87031) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

const random = makeRandom();

function pick<T>(items: T[], index: number): T {
  return items[index % items.length];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function createVehicles(): Vehicle[] {
  return Array.from({ length: 60 }, (_, index) => {
    const assetCategory = index < 36 ? "Truck" : "HEMM";
    const company = pick(companies, index);
    const site = pick(sites, index);
    const assetType = assetCategory === "Truck" ? pick(truckTypes, index) : pick(hemmTypes, index);
    const modelNumber = assetCategory === "Truck"
      ? pick(companyModels[company].truck, index)
      : pick(companyModels[company].hemm, index);
    const capacityM3 = assetCategory === "Truck" ? [12, 14, 16, 18, 20, 24][index % 6] : [2.5, 3.2, 4, 5.5, 7, 9][index % 6];
    const standardFuelNorm = assetCategory === "Truck" ? [2.4, 2.7, 3, 3.4][index % 4] : [18, 22, 26, 31, 36][index % 5];
    const status = index % 19 === 0 ? "offline" : index % 17 === 0 ? "maintenance" : pick(statuses.slice(0, 3), index);

    return {
      id: `dummy-veh-${String(index + 1).padStart(3, "0")}`,
      source: "DUMMY_SAMPLE",
      vehicleNumber: `${assetCategory === "Truck" ? "TR" : "HE"}-${site.location.slice(0, 2).toUpperCase()}-${String(index + 101).padStart(3, "0")}`,
      assetCategory,
      assetType,
      company,
      modelNumber,
      capacityM3,
      fuelMeasurementUnit: assetCategory === "Truck" ? "km/L" : "L/hr",
      trackerProvider: pick(trackerProviders, index),
      trackerId: `DUMMY-${company.replace(/\s/g, "").toUpperCase()}-${String(index + 1).padStart(4, "0")}`,
      siteId: site.id,
      siteName: site.name,
      contractType: site.contractType,
      status,
      commissioningDate: `202${index % 5}-0${(index % 9) + 1}-15`,
      fuelTankCapacityLitres: assetCategory === "Truck" ? 300 + (index % 4) * 50 : 450 + (index % 6) * 75,
      standardFuelNorm,
      active: index % 23 !== 0,
    };
  });
}

function shiftTimestamp(date: Date, shift: ShiftCode): string {
  const copy = new Date(date);
  copy.setHours(shift === "A" ? 9 : shift === "B" ? 17 : 23, 30, 0, 0);
  return copy.toISOString();
}

function createTelemetry(vehicleList: Vehicle[]): FleetTelemetryRecord[] {
  const records: FleetTelemetryRecord[] = [];
  const endDate = new Date(`${DUMMY_DATA_END_DATE}T00:00:00`);
  const shifts: ShiftCode[] = ["A", "B", "C"];

  for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
    const currentDate = new Date(endDate);
    currentDate.setDate(endDate.getDate() - dayOffset);

    vehicleList.forEach((vehicle, vehicleIndex) => {
      shifts.forEach((shift, shiftIndex) => {
        const site = sites.find((item) => item.id === vehicle.siteId)!;
        const forcedOffline = vehicleIndex % 19 === 0 && dayOffset < 3;
        const abnormalHighFuel = vehicleIndex % 13 === 0 && dayOffset < 8;
        const abnormalIdle = vehicleIndex % 11 === 0 && shift !== "C";
        const abnormalLowProduction = vehicleIndex % 16 === 0 && dayOffset < 10;
        const suddenFuelDrop = vehicleIndex % 21 === 0 && dayOffset === 1 && shift === "B";
        const availableHours = 8;
        const baseActivity = vehicle.status === "maintenance" ? 0.22 : vehicle.status === "offline" ? 0.05 : 0.74 + random() * 0.18;
        const runningHours = forcedOffline ? 0 : round1(Math.max(0, availableHours * baseActivity - (abnormalIdle ? 1.9 : 0)));
        const idleHours = forcedOffline ? 0 : round1(abnormalIdle ? 2.7 + random() : 0.5 + random() * 1.4);
        const stoppedHours = round1(Math.max(0, availableHours - runningHours - idleHours));
        const offlineHours = forcedOffline ? 8 : vehicle.status === "offline" ? round1(3 + random() * 2) : 0;
        const engineHours = round1(runningHours + idleHours);
        const leadKm = [2, 3, 4, 5, 6, 8, 10][(vehicleIndex + dayOffset + shiftIndex) % 7];
        const tripsBase = vehicle.assetCategory === "Truck" ? runningHours * (1.3 + random() * 0.9) : runningHours * (0.45 + random() * 0.5);
        const trips = forcedOffline ? 0 : Math.max(0, Math.round(tripsBase * (abnormalLowProduction ? 0.45 : 1)));
        const productionM3 = calculateProduction(trips, vehicle.capacityM3) ?? 0;
        const distanceKm = vehicle.assetCategory === "Truck" ? round1(trips * leadKm * 2 + random() * 12) : round1(runningHours * (1.8 + random() * 2));
        const normFuel = vehicle.assetCategory === "Truck" ? distanceKm / (vehicle.standardFuelNorm ?? 1) : runningHours * (vehicle.standardFuelNorm ?? 1);
        const fuelConsumedLitres = round1(forcedOffline ? 0 : normFuel * (abnormalHighFuel ? 1.45 : 0.9 + random() * 0.25));
        const fuelFilledLitres = shift === "A" && dayOffset % 3 === 0 ? Math.round(60 + random() * 160) : 0;
        const nominalFuelLevel = (vehicle.fuelTankCapacityLitres ?? 300) * (0.35 + random() * 0.5);
        const fuelLevelLitres = round1(suddenFuelDrop ? (vehicle.fuelTankCapacityLitres ?? 300) * 0.08 : nominalFuelLevel);
        const timestamp = shiftTimestamp(currentDate, shift);
        const status: VehicleStatus = forcedOffline
          ? "offline"
          : vehicle.status === "maintenance"
            ? "maintenance"
            : runningHours > idleHours
              ? "running"
              : idleHours > 2
                ? "idle"
                : "stopped";

        records.push({
          id: `${vehicle.id}-${timestamp.slice(0, 10)}-${shift}`,
          source: "DUMMY_SAMPLE",
          vehicleId: vehicle.id,
          vehicleNumber: vehicle.vehicleNumber,
          trackerId: vehicle.trackerId,
          timestamp,
          date: timestamp.slice(0, 10),
          shift,
          siteId: vehicle.siteId,
          siteName: vehicle.siteName ?? site.name,
          assetCategory: vehicle.assetCategory,
          assetType: vehicle.assetType,
          company: vehicle.company,
          modelNumber: vehicle.modelNumber,
          location: site.location,
          odometerKm: Math.round(12000 + vehicleIndex * 210 + dayOffset * 35 + shiftIndex * 12),
          distanceKm,
          engineHours,
          runningHours,
          idleHours,
          stoppedHours,
          offlineHours,
          availableHours,
          fuelConsumedLitres,
          fuelFilledLitres,
          fuelLevelLitres,
          fuelLevelPercent: round1((fuelLevelLitres / (vehicle.fuelTankCapacityLitres ?? 300)) * 100),
          trips,
          capacityM3: vehicle.capacityM3,
          productionM3,
          leadKm,
          status,
          truckEfficiencyKmPerLitre: vehicle.assetCategory === "Truck" ? calculateTruckEfficiency(distanceKm, fuelConsumedLitres) : null,
          hemmFuelRateLitrePerHour: vehicle.assetCategory === "HEMM" ? calculateHemmFuelRate(fuelConsumedLitres, runningHours) : null,
          fuelPerTrip: calculateFuelPerTrip(fuelConsumedLitres, trips),
          fuelPerM3: calculateFuelPerM3(fuelConsumedLitres, productionM3),
          idlePercentage: calculateIdlePercentage(idleHours, engineHours),
          runningPercentage: calculateRunningPercentage(runningHours, engineHours),
          utilizationPercentage: calculateUtilization(runningHours, availableHours),
          rawMetrics: { source: "Generated dummy fleet sample" },
        });
      });
    });
  }

  return records;
}

export const vehicles = createVehicles();
export const telemetryRecords = createTelemetry(vehicles);

export const integrationSources: IntegrationSource[] = companies.map((company, index) => ({
  id: `dummy-integration-${company.toLowerCase().replace(/\s/g, "-")}`,
  company,
  sourceType: index === 3 ? "SFTP" : index === 5 ? "CSV" : "API",
  status: index === 1 ? "delayed" : index === 4 ? "failed" : index === 6 ? "not_configured" : "connected",
  lastSyncAt: index === 6 ? null : new Date(`2026-07-08T${String(7 + index).padStart(2, "0")}:15:00`).toISOString(),
  nextSyncAt: index === 6 ? null : new Date(`2026-07-08T${String(10 + index).padStart(2, "0")}:30:00`).toISOString(),
  recordsSyncedToday: index === 6 ? 0 : 2200 + index * 375,
  errorMessage: index === 4 ? "Authentication failed in dummy sample." : index === 1 ? "OEM feed delayed in dummy sample." : undefined,
}));

export const reports: Report[] = reportTypes.map((type: ReportType, index) => ({
  id: `dummy-report-${index + 1}`,
  name: type,
  type,
  filters: { date: DUMMY_DATA_END_DATE, site: "All", shift: "All", source: "DUMMY_SAMPLE" },
  generatedAt: new Date(`2026-07-08T${String(6 + (index % 12)).padStart(2, "0")}:45:00`).toISOString(),
  exportFormats: ["PDF", "Excel", "CSV"],
  status: index % 9 === 0 ? "queued" : "ready",
}));

export const whatsAppSchedules: WhatsAppReportSchedule[] = [
  { id: "dummy-wa-sch-001", reportType: "Shift-wise Fuel Report", siteId: "site-wcl-sasti-ocm", shift: "A", recipients: ["Mine Manager", "Fuel Supervisor"], frequency: "shift-wise", enabled: true },
  { id: "dummy-wa-sch-002", reportType: "Daily Fuel Consumption Report", siteId: "site-ncl-jayant-1", shift: "All", recipients: ["Operations Head"], frequency: "daily", enabled: true },
];

export const whatsAppDeliveryLogs: WhatsAppDeliveryLog[] = Array.from({ length: 8 }, (_, index) => ({
  id: `dummy-wa-log-${String(index + 1).padStart(3, "0")}`,
  reportName: reportTypes[index % reportTypes.length],
  pdfFileName: `${reportTypes[index % reportTypes.length].toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${DUMMY_DATA_END_DATE}.pdf`,
  recipientName: ["Mine Manager", "Fuel Supervisor", "Operations Head", "Control Room"][index % 4],
  recipientNumber: `+91 98${String(70000000 + index * 7319).slice(0, 8)}`,
  sentAt: new Date(`2026-07-0${(index % 7) + 1}T${String(7 + (index % 12)).padStart(2, "0")}:10:00`).toISOString(),
  status: index % 6 === 0 ? "failed" : index % 5 === 0 ? "pending" : "sent",
  failureReason: index % 6 === 0 ? "Dummy delivery failure." : undefined,
  retryCount: index % 6 === 0 ? 2 : 0,
}));
