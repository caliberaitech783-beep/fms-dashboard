export type DieselSite = "Chandrapur" | "Majri" | "Sasti";
export type DieselStatus = "OK" | "WATCH" | "EXCESS";
export type DieselAssetClass = "Loading" | "Haulage" | "Support" | "Power";
export type DieselConfidence = "Low" | "Medium" | "High";

export interface DieselEquipmentRecord {
  id: string;
  type: string;
  assetClass: DieselAssetClass;
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
  source: string;
  asOf: string;
  confidence: DieselConfidence;
  measurementContext: string;
}

export interface DieselLossCause {
  cause: string;
  site: DieselSite;
  litres: number;
  affectedUnits: string[];
  note: string;
}

export interface DieselSiteAction {
  id: string;
  site: DieselSite;
  priority: "Critical" | "High" | "Medium";
  title: string;
  owner: string;
  due: string;
  affectedUnits: string[];
  expectedSavingLitres: number;
  status: "Open" | "In progress" | "Verify";
  evidence: string;
}

export const DIESEL_REPORT_META = {
  title: "Diesel Consumption Command Centre",
  company: "Caliber Mining & Logistics Ltd.",
  reportingPeriod: "June 2026 (30 days)",
  dieselPricePerLitre: 89.5,
  dataStatus: "DEMO",
  source: "Supplied diesel study dashboard",
  sourceType: "Illustrative static snapshot",
  asOf: "30 Jun 2026, end of day",
  freshness: "Static monthly sample — not a live telemetry feed",
  confidence: "Low — values have not been reconciled with HMR, fuel issue, weighbridge, or energy-meter records",
  sourceNote: "Illustrative values from the supplied diesel study. They are isolated from live fleet totals and must not be used for production, payment, or disciplinary decisions until site records are reconciled.",
} as const;

const source = DIESEL_REPORT_META.source;
const asOf = DIESEL_REPORT_META.asOf;
const confidence: DieselConfidence = "Low";

export const dieselEquipmentRecords: DieselEquipmentRecord[] = [
  { id: "EX-01", type: "Excavator PC-450", assetClass: "Loading", site: "Chandrapur", engineHours: 512, fuelLitres: 21800, tonnes: 148000, distanceKm: null, idleHours: 46, actualLph: 42.58, oemLph: 40, litresPerTonne: 0.147, idleFuelPercent: 5.3, operator: "Operator 01", status: "WATCH", source, asOf, confidence, measurementContext: "Loaded-tonnage proxy; do not add to hauled tonnes." },
  { id: "EX-02", type: "Excavator EC-480", assetClass: "Loading", site: "Chandrapur", engineHours: 488, fuelLitres: 22400, tonnes: 132500, distanceKm: null, idleHours: 62, actualLph: 45.9, oemLph: 42, litresPerTonne: 0.169, idleFuelPercent: 7.2, operator: "Operator 02", status: "WATCH", source, asOf, confidence, measurementContext: "Loaded-tonnage proxy; do not add to hauled tonnes." },
  { id: "EX-03", type: "Excavator PC-450", assetClass: "Loading", site: "Majri", engineHours: 470, fuelLitres: 19300, tonnes: 129800, distanceKm: null, idleHours: 38, actualLph: 41.06, oemLph: 40, litresPerTonne: 0.149, idleFuelPercent: 5, operator: "Operator 03", status: "OK", source, asOf, confidence, measurementContext: "Loaded-tonnage proxy; do not add to hauled tonnes." },
  { id: "DT-11", type: "Dumper 100T", assetClass: "Haulage", site: "Chandrapur", engineHours: 540, fuelLitres: 16200, tonnes: 96500, distanceKm: 6800, idleHours: 58, actualLph: 30, oemLph: 27, litresPerTonne: 0.168, idleFuelPercent: 8.8, operator: "Operator 04", status: "WATCH", source, asOf, confidence, measurementContext: "Hauled-tonnage proxy; verify against weighbridge and dispatch records." },
  { id: "DT-12", type: "Dumper 100T", assetClass: "Haulage", site: "Chandrapur", engineHours: 528, fuelLitres: 17900, tonnes: 91200, distanceKm: 6650, idleHours: 88, actualLph: 33.9, oemLph: 27, litresPerTonne: 0.196, idleFuelPercent: 12.7, operator: "Operator 05", status: "EXCESS", source, asOf, confidence, measurementContext: "Hauled-tonnage proxy; verify against weighbridge and dispatch records." },
  { id: "DT-13", type: "Dumper 100T", assetClass: "Haulage", site: "Majri", engineHours: 515, fuelLitres: 15400, tonnes: 94800, distanceKm: 6400, idleHours: 44, actualLph: 29.9, oemLph: 27, litresPerTonne: 0.162, idleFuelPercent: 6.8, operator: "Operator 06", status: "WATCH", source, asOf, confidence, measurementContext: "Hauled-tonnage proxy; verify against weighbridge and dispatch records." },
  { id: "DT-14", type: "Dumper 60T", assetClass: "Haulage", site: "Sasti", engineHours: 498, fuelLitres: 10900, tonnes: 55600, distanceKm: 5900, idleHours: 52, actualLph: 21.89, oemLph: 20, litresPerTonne: 0.196, idleFuelPercent: 10.8, operator: "Operator 07", status: "WATCH", source, asOf, confidence, measurementContext: "Hauled-tonnage proxy; verify against weighbridge and dispatch records." },
  { id: "DT-15", type: "Dumper 60T", assetClass: "Haulage", site: "Sasti", engineHours: 505, fuelLitres: 12100, tonnes: 52300, distanceKm: 6050, idleHours: 96, actualLph: 23.96, oemLph: 20, litresPerTonne: 0.231, idleFuelPercent: 17.7, operator: "Operator 08", status: "EXCESS", source, asOf, confidence, measurementContext: "Hauled-tonnage proxy; verify against weighbridge and dispatch records." },
  { id: "DZ-21", type: "Dozer D-155", assetClass: "Support", site: "Chandrapur", engineHours: 402, fuelLitres: 13500, tonnes: null, distanceKm: null, idleHours: 40, actualLph: 33.58, oemLph: 31, litresPerTonne: null, idleFuelPercent: 9.2, operator: "Operator 09", status: "WATCH", source, asOf, confidence, measurementContext: "Support HEMM; assess L/productive-hour, not L/tonne." },
  { id: "DZ-22", type: "Dozer D-155", assetClass: "Support", site: "Majri", engineHours: 388, fuelLitres: 12400, tonnes: null, distanceKm: null, idleHours: 31, actualLph: 31.96, oemLph: 31, litresPerTonne: null, idleFuelPercent: 7.1, operator: "Operator 10", status: "OK", source, asOf, confidence, measurementContext: "Support HEMM; assess L/productive-hour, not L/tonne." },
  { id: "MG-31", type: "Motor Grader", assetClass: "Support", site: "Sasti", engineHours: 356, fuelLitres: 5700, tonnes: null, distanceKm: 3100, idleHours: 25, actualLph: 16.01, oemLph: 15, litresPerTonne: null, idleFuelPercent: 7.2, operator: "Operator 11", status: "WATCH", source, asOf, confidence, measurementContext: "Road-support equipment; assess L/productive-hour and km maintained." },
  { id: "DG-41", type: "DG Set 500 kVA", assetClass: "Power", site: "Chandrapur", engineHours: 610, fuelLitres: 44200, tonnes: null, distanceKm: null, idleHours: 0, actualLph: 72.46, oemLph: 70, litresPerTonne: null, idleFuelPercent: 0, operator: "Power Custodian 01", status: "OK", source, asOf, confidence, measurementContext: "Provisional L/hr only. Add generated kWh and load factor before assessing DG efficiency." },
];

export const dieselLossCauses: DieselLossCause[] = [
  { cause: "Avoidable idling", site: "Chandrapur", litres: 2600, affectedUnits: ["DT-11", "DT-12"], note: "Illustrative avoidable subset of the estimated 3,699 L total idle fuel; validate shovel wait above 6 min/trip at face 2." },
  { cause: "Poor haul road", site: "Majri", litres: 8400, affectedUnits: ["DT-13", "DZ-22"], note: "Rolling resistance increased post-monsoon at Majri ramp 3." },
  { cause: "Under-loaded dumpers", site: "Chandrapur", litres: 6200, affectedUnits: ["DT-11", "DT-12"], note: "Average payload is 82% of rated capacity on the 100T class." },
  { cause: "Steep gradients", site: "Sasti", litres: 5500, affectedUnits: ["DT-14", "DT-15"], note: "Sasti pit exit at 11.5% versus the 8–10% operating guideline." },
  { cause: "Driving / braking", site: "Sasti", litres: 3800, affectedUnits: ["DT-15"], note: "Illustrative harsh-event pattern; validate from telematics event logs." },
  { cause: "Tyres / maintenance", site: "Majri", litres: 2900, affectedUnits: ["EX-03", "DT-13"], note: "Injector, tyre-pressure, and clogged-filter checks are pending." },
  { cause: "Leakage / variance", site: "Chandrapur", litres: 2500, affectedUnits: ["DG-41"], note: "Fill-versus-burn variance at the DG yard requires stock reconciliation." },
];

export const dieselSiteActions: DieselSiteAction[] = [
  { id: "ACT-CP-01", site: "Chandrapur", priority: "Critical", title: "Remove face-2 queue idling", owner: "Dispatch Manager", due: "15 Jul 2026", affectedUnits: ["DT-11", "DT-12"], expectedSavingLitres: 1800, status: "In progress", evidence: "Verify median and P90 shovel-wait time for seven shifts before closing." },
  { id: "ACT-CP-02", site: "Chandrapur", priority: "High", title: "Restore 100T payload compliance", owner: "Site Operations", due: "18 Jul 2026", affectedUnits: ["DT-11", "DT-12"], expectedSavingLitres: 2500, status: "Open", evidence: "Reconcile dispatch payload with weighbridge and reject overloaded/underloaded trips." },
  { id: "ACT-CP-03", site: "Chandrapur", priority: "High", title: "Reconcile DG-yard fuel variance", owner: "Fuel Controller", due: "14 Jul 2026", affectedUnits: ["DG-41"], expectedSavingLitres: 1000, status: "Verify", evidence: "Match opening stock, receipts, issues, closing dip, engine burn, and generated kWh." },
  { id: "ACT-MJ-01", site: "Majri", priority: "Critical", title: "Grade and compact ramp 3", owner: "Road Maintenance", due: "16 Jul 2026", affectedUnits: ["DT-13", "DZ-22"], expectedSavingLitres: 3600, status: "In progress", evidence: "Record gradient, rolling resistance proxy, cycle time, and fuel before/after work." },
  { id: "ACT-MJ-02", site: "Majri", priority: "Medium", title: "Close air/fuel-filter backlog", owner: "Workshop Manager", due: "17 Jul 2026", affectedUnits: ["EX-03", "DT-13"], expectedSavingLitres: 1300, status: "Open", evidence: "Capture work order, replaced parts, HMR, and seven-day consumption-index result." },
  { id: "ACT-SA-01", site: "Sasti", priority: "Critical", title: "Reduce pit-exit effective gradient", owner: "Mine Planning", due: "20 Jul 2026", affectedUnits: ["DT-14", "DT-15"], expectedSavingLitres: 3200, status: "Open", evidence: "Approve road profile and verify loaded-cycle fuel after correction." },
  { id: "ACT-SA-02", site: "Sasti", priority: "High", title: "Coach high-idle dumper operation", owner: "Shift In-charge", due: "15 Jul 2026", affectedUnits: ["DT-15"], expectedSavingLitres: 2100, status: "In progress", evidence: "Compare idle share, harsh events, payload, and queue time over seven matched shifts." },
];

export const dieselActionGroups = [
  { title: "Operational", actions: ["Reduce avoidable idle below the approved site target", "Match excavator and dumper capacity", "Optimize haul routes", "Control payload compliance"] },
  { title: "Maintenance", actions: ["Inspect air and fuel filters", "Calibrate injectors", "Tune engines to OEM specification", "Monitor hydraulic health"] },
  { title: "Haul Road", actions: ["Control effective gradients", "Improve drainage", "Measure rolling-resistance indicators", "Grade and compact to plan"] },
  { title: "Operator", actions: ["Use smooth acceleration", "Avoid harsh braking", "Maintain recommended RPM", "Apply site-approved eco-driving practices"] },
  { title: "Controls", actions: ["Reconcile issue versus burn", "Track source freshness", "Use geofenced fuel issues", "Verify savings before closure"] },
] as const;

export const dieselImprovementTargets = [
  { label: "Reduce avoidable idle fuel", low: 20, high: 40 },
  { label: "Haul-road efficiency", low: 5, high: 15 },
  { label: "Operator coaching", low: 5, high: 10 },
  { label: "Maintenance optimization", low: 3, high: 8 },
  { label: "Dispatch optimization", low: 5, high: 12 },
] as const;

export const dieselImprovementCycle = [
  "Collect source data",
  "Validate completeness",
  "Calculate duty KPIs",
  "Compare matched norms",
  "Find root causes",
  "Assign corrective action",
  "Verify the result",
  "Standardize the control",
  "Review and benchmark",
] as const;
