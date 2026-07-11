export type DieselSite = "Chandrapur" | "Majri" | "Sasti";
export type DieselStatus = "OK" | "WATCH" | "EXCESS";

export interface DieselEquipmentRecord {
  id: string;
  type: string;
  site: DieselSite;
  engineHours: number;
  fuelLitres: number;
  tonnes: number | null;
  distanceKm: number | null;
  idleHours: number;
  actualLph: number;
  oemLph: number;
  litresPerTonne: number | null;
  idleFuelPercent: number;
  operator: string;
  status: DieselStatus;
}

export interface DieselLossCause {
  cause: string;
  litres: number;
  note: string;
}

export const DIESEL_REPORT_META = {
  title: "Diesel Consumption Dashboard Report",
  company: "Caliber Mining & Logistics Ltd.",
  reportingPeriod: "June 2026 (30 days)",
  dieselPricePerLitre: 89.5,
  sourceNote: "Illustrative sample from the supplied diesel study dashboard; replace with verified site DGMS/HMR logs.",
} as const;

export const dieselEquipmentRecords: DieselEquipmentRecord[] = [
  { id: "EX-01", type: "Excavator PC-450", site: "Chandrapur", engineHours: 512, fuelLitres: 21800, tonnes: 148000, distanceKm: null, idleHours: 46, actualLph: 42.58, oemLph: 40, litresPerTonne: 0.147, idleFuelPercent: 5.3, operator: "A. Kumar", status: "WATCH" },
  { id: "EX-02", type: "Excavator EC-480", site: "Chandrapur", engineHours: 488, fuelLitres: 22400, tonnes: 132500, distanceKm: null, idleHours: 62, actualLph: 45.9, oemLph: 42, litresPerTonne: 0.169, idleFuelPercent: 7.2, operator: "R. Meshram", status: "WATCH" },
  { id: "EX-03", type: "Excavator PC-450", site: "Majri", engineHours: 470, fuelLitres: 19300, tonnes: 129800, distanceKm: null, idleHours: 38, actualLph: 41.06, oemLph: 40, litresPerTonne: 0.149, idleFuelPercent: 5, operator: "S. Gedam", status: "OK" },
  { id: "DT-11", type: "Dumper 100T", site: "Chandrapur", engineHours: 540, fuelLitres: 16200, tonnes: 96500, distanceKm: 6800, idleHours: 58, actualLph: 30, oemLph: 27, litresPerTonne: 0.168, idleFuelPercent: 8.8, operator: "V. Rathod", status: "WATCH" },
  { id: "DT-12", type: "Dumper 100T", site: "Chandrapur", engineHours: 528, fuelLitres: 17900, tonnes: 91200, distanceKm: 6650, idleHours: 88, actualLph: 33.9, oemLph: 27, litresPerTonne: 0.196, idleFuelPercent: 12.7, operator: "M. Sheikh", status: "EXCESS" },
  { id: "DT-13", type: "Dumper 100T", site: "Majri", engineHours: 515, fuelLitres: 15400, tonnes: 94800, distanceKm: 6400, idleHours: 44, actualLph: 29.9, oemLph: 27, litresPerTonne: 0.162, idleFuelPercent: 6.8, operator: "P. Wankhede", status: "WATCH" },
  { id: "DT-14", type: "Dumper 60T", site: "Sasti", engineHours: 498, fuelLitres: 10900, tonnes: 55600, distanceKm: 5900, idleHours: 52, actualLph: 21.89, oemLph: 20, litresPerTonne: 0.196, idleFuelPercent: 10.8, operator: "K. Yadav", status: "WATCH" },
  { id: "DT-15", type: "Dumper 60T", site: "Sasti", engineHours: 505, fuelLitres: 12100, tonnes: 52300, distanceKm: 6050, idleHours: 96, actualLph: 23.96, oemLph: 20, litresPerTonne: 0.231, idleFuelPercent: 17.7, operator: "D. Bhoyar", status: "EXCESS" },
  { id: "DZ-21", type: "Dozer D-155", site: "Chandrapur", engineHours: 402, fuelLitres: 13500, tonnes: null, distanceKm: null, idleHours: 40, actualLph: 33.58, oemLph: 31, litresPerTonne: null, idleFuelPercent: 9.2, operator: "N. Tekam", status: "WATCH" },
  { id: "DZ-22", type: "Dozer D-155", site: "Majri", engineHours: 388, fuelLitres: 12400, tonnes: null, distanceKm: null, idleHours: 31, actualLph: 31.96, oemLph: 31, litresPerTonne: null, idleFuelPercent: 7.1, operator: "G. Uike", status: "OK" },
  { id: "MG-31", type: "Motor Grader", site: "Sasti", engineHours: 356, fuelLitres: 5700, tonnes: null, distanceKm: 3100, idleHours: 25, actualLph: 16.01, oemLph: 15, litresPerTonne: null, idleFuelPercent: 7.2, operator: "H. Ali", status: "WATCH" },
  { id: "DG-41", type: "DG Set 500 kVA", site: "Chandrapur", engineHours: 610, fuelLitres: 44200, tonnes: null, distanceKm: null, idleHours: 0, actualLph: 72.46, oemLph: 70, litresPerTonne: null, idleFuelPercent: 0, operator: "Shift Elec.", status: "OK" },
];

export const dieselLossCauses: DieselLossCause[] = [
  { cause: "Excessive idling", litres: 12600, note: "Shovel wait above 6 min/trip at Chandrapur face 2" },
  { cause: "Poor haul road", litres: 8400, note: "Rolling resistance increased post-monsoon at Majri ramp 3" },
  { cause: "Under-loaded dumpers", litres: 6200, note: "Average payload is 82% of rated capacity on the 100T class" },
  { cause: "Steep gradients", litres: 5500, note: "Sasti pit exit at 11.5% versus the 8–10% norm" },
  { cause: "Driving / braking", litres: 3800, note: "Telematics harsh-event alerts" },
  { cause: "Tyres / maintenance", litres: 2900, note: "Injector and clogged-filter backlog" },
  { cause: "Leakage / theft", litres: 2500, note: "Fill-versus-burn variance at the DG set yard" },
];

export const dieselActionGroups = [
  { title: "Operational", actions: ["Reduce idle time below 10%", "Match excavator and truck capacity", "Optimize haul routes", "Improve dispatching", "Eliminate unnecessary movements", "Maintain optimum payload"] },
  { title: "Maintenance", actions: ["Clean air filters", "Replace clogged fuel filters", "Calibrate injectors", "Tune engines", "Complete preventive maintenance on time", "Monitor hydraulic system health"] },
  { title: "Haul Road", actions: ["Keep gradients below 8–10%", "Improve drainage", "Reduce rolling resistance", "Control dust", "Grade and compact regularly"] },
  { title: "Operator Training", actions: ["Use smooth acceleration", "Avoid harsh braking", "Maintain recommended RPM", "Minimize idling", "Apply eco-driving practices"] },
  { title: "Technology", actions: ["GPS fleet management", "Fuel-level sensors", "IoT telematics", "AI-based dispatch", "Geofencing", "Predictive maintenance", "Digital fuel dashboards"] },
] as const;

export const dieselImprovementTargets = [
  { label: "Reduce idle fuel", low: 20, high: 40 },
  { label: "Haul road efficiency", low: 5, high: 15 },
  { label: "Operator training savings", low: 5, high: 10 },
  { label: "Maintenance optimization", low: 3, high: 8 },
  { label: "Dispatch optimization", low: 5, high: 12 },
] as const;

export const dieselImprovementCycle = [
  "Collect fuel data",
  "Validate data quality",
  "Calculate KPIs",
  "Compare with targets",
  "Identify root causes",
  "Corrective actions",
  "Monitor results",
  "Standardize practices",
  "Review and benchmark",
] as const;
