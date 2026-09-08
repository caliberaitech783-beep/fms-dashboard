import type {
  ReportCategory,
  ReportItem,
  ReportStatus,
  ReportStatusCounts,
  ReportView,
} from "../types/reportCategories";

const exportableReport = {
  supportsPdf: true,
  supportsExcel: true,
  supportsGenerate: true,
  requiredPermission: "reports:read",
} as const;

export const reportCategories: ReportCategory[] = [
  {
    id: "fuel-efficiency",
    name: "Fuel & Efficiency",
    description: "Fuel consumption and vehicle efficiency reports.",
    route: "/reports/fuel-efficiency",
    icon: "Fuel",
    reports: [
      {
        ...exportableReport,
        id: "fuel-summary",
        name: "Fuel Summary",
        description: "Consolidated fuel consumption report for selected vehicles and sites.",
        route: "/reports/fuel-efficiency/summary",
        reportType: "Fuel Consumption Report",
        categoryId: "fuel-efficiency",
        existingComponent: "FuelConsumptionReport",
      },
      {
        ...exportableReport,
        id: "daily-fuel-consumption",
        name: "Daily Fuel Consumption",
        description: "Daily vehicle-wise and site-wise fuel consumption.",
        route: "/reports/fuel-efficiency/daily",
        reportType: "Daily Fuel Consumption Report",
        categoryId: "fuel-efficiency",
        existingComponent: "DailyFuelConsumptionReport",
      },
      {
        ...exportableReport,
        id: "shift-wise-fuel",
        name: "Shift-wise Fuel Consumption",
        description: "Fuel consumption separated by working shift.",
        route: "/reports/fuel-efficiency/shift-wise",
        reportType: "Shift-wise Fuel Report",
        categoryId: "fuel-efficiency",
        existingComponent: "ShiftWiseFuelReport",
      },
      {
        ...exportableReport,
        id: "vehicle-efficiency",
        name: "Vehicle Fuel Efficiency",
        description: "Vehicle mileage, litres per hour and fuel-efficiency comparison.",
        route: "/reports/fuel-efficiency/vehicle-efficiency",
        reportType: "Vehicle Efficiency Report",
        categoryId: "fuel-efficiency",
        existingComponent: "VehicleEfficiencyReport",
      },
    ],
  },
  {
    id: "operations-utilization",
    name: "Operations & Utilization",
    description: "Running, idle, standstill and overall utilization reports.",
    route: "/reports/operations-utilization",
    icon: "Activity",
    reports: [
      {
        ...exportableReport,
        id: "running-time",
        name: "Running Time",
        description: "Vehicle running hours and operating-time performance.",
        route: "/reports/operations-utilization/running-time",
        reportType: "Running Time Report",
        categoryId: "operations-utilization",
        existingComponent: "RunningTimeReport",
      },
      {
        ...exportableReport,
        id: "idle-time",
        name: "Idle Time",
        description: "Idle hours and idle percentage by vehicle and site.",
        route: "/reports/operations-utilization/idle-time",
        reportType: "Idle Time Report",
        categoryId: "operations-utilization",
        existingComponent: "IdleTimeReport",
      },
      {
        ...exportableReport,
        id: "utilization",
        name: "Vehicle Utilization",
        description: "Running hours compared with available operating hours.",
        route: "/reports/operations-utilization/utilization",
        reportType: "Utilization Report",
        categoryId: "operations-utilization",
        existingComponent: "UtilizationReport",
      },
      {
        ...exportableReport,
        id: "driver-standstill",
        name: "Driver-wise Standstill",
        description: "Driver and vehicle standstill tracking from configured OEM services.",
        route: "/reports/operations-utilization/driver-standstill",
        reportType: "Driverwise Standstill Tracking",
        categoryId: "operations-utilization",
        existingComponent: "DriverwiseStandstillTracking",
      },
    ],
  },
  {
    id: "performance-analysis",
    name: "Performance Analysis",
    description: "Compare performance by company, model and vehicle.",
    route: "/reports/performance-analysis",
    icon: "Chart",
    reports: [
      {
        ...exportableReport,
        id: "company-wise",
        name: "Company-wise Performance",
        description: "Compare fuel and utilization metrics by company or OEM.",
        route: "/reports/performance-analysis/company-wise",
        reportType: "Company-wise Performance Report",
        categoryId: "performance-analysis",
        existingComponent: "CompanyWisePerformanceReport",
      },
      {
        ...exportableReport,
        id: "model-wise",
        name: "Model-wise Performance",
        description: "Compare operating performance across vehicle models.",
        route: "/reports/performance-analysis/model-wise",
        reportType: "Model-wise Performance Report",
        categoryId: "performance-analysis",
        existingComponent: "ModelWisePerformanceReport",
      },
      {
        ...exportableReport,
        id: "vehicle-efficiency-shortcut",
        name: "Vehicle Efficiency",
        description: "Open the primary vehicle-efficiency report without creating a duplicate report.",
        route: "/reports/performance-analysis/vehicle-efficiency",
        reportType: "Vehicle Efficiency Report",
        categoryId: "performance-analysis",
        isShortcut: true,
        redirectTo: "/reports/fuel-efficiency/vehicle-efficiency",
      },
    ],
  },
  {
    id: "site-fleet",
    name: "Site & Fleet",
    description: "Site-wise vehicle performance, asset details and vehicle counts.",
    route: "/reports/site-fleet",
    icon: "Map",
    reports: [
      {
        ...exportableReport,
        id: "site-wise",
        name: "Site-wise Performance",
        description: "Compare fuel and utilization results across sites.",
        route: "/reports/site-fleet/site-wise",
        reportType: "Site-wise Report",
        categoryId: "site-fleet",
        existingComponent: "SiteWiseReport",
      },
      {
        ...exportableReport,
        id: "site-vehicle-count",
        name: "Site-wise Asset and Vehicle Count",
        description: "Asset and vehicle counts grouped by site and operating status.",
        route: "/reports/site-fleet/vehicle-count",
        reportType: "Site-wise Asset / Vehicle Count Report",
        categoryId: "site-fleet",
        existingComponent: "SiteWiseAssetVehicleCountReport",
      },
    ],
  },
  {
    id: "alerts-tracker",
    name: "Alerts & Tracker Health",
    description: "Operational exceptions, missing data and tracker health.",
    route: "/reports/alerts-tracker",
    icon: "AlertTriangle",
    reports: [
      {
        ...exportableReport,
        id: "exceptions",
        name: "Exception Report",
        description: "Operational exceptions and alert conditions for the selected fleet.",
        route: "/reports/alerts-tracker/exceptions",
        reportType: "Exception Report",
        categoryId: "alerts-tracker",
        existingComponent: "ExceptionReport",
      },
      {
        ...exportableReport,
        id: "tracker-health",
        name: "Tracker Health",
        description: "Last data received, offline duration and tracker availability.",
        route: "/reports/alerts-tracker/tracker-health",
        reportType: "Tracker Health Report",
        categoryId: "alerts-tracker",
        existingComponent: "TrackerHealthReport",
      },
    ],
  },
  {
    id: "oem",
    name: "OEM Reports",
    description: "Brand-specific reports for Eicher, Volvo, Scania, CASE and other OEMs.",
    route: "/reports/oem",
    icon: "Truck",
    reports: [
      {
        ...exportableReport,
        id: "eicher",
        name: "Eicher Report",
        description: "Eicher live vehicle snapshot using the existing secured OEM integration.",
        route: "/reports/oem/eicher",
        reportType: "Eicher Report",
        categoryId: "oem",
        existingComponent: "EicherReport",
      },
      {
        ...exportableReport,
        id: "case",
        name: "CASE Report",
        description: "CASE live fuel, working, idle and utilization report using the secured OEM integration.",
        route: "/reports/oem/case",
        reportType: "CASE Report",
        categoryId: "oem",
        existingComponent: "CaseReport",
      },
    ],
  },
  {
    id: "management-delivery",
    name: "Management & Delivery",
    description: "Management summaries and report-delivery tracking.",
    route: "/reports/management-delivery",
    icon: "FileText",
    reports: [
      {
        ...exportableReport,
        id: "monthly-management",
        name: "Monthly Management Report",
        description: "Monthly fleet and fuel summary for management review.",
        route: "/reports/management-delivery/monthly-management",
        reportType: "Monthly Management Report",
        categoryId: "management-delivery",
        existingComponent: "MonthlyManagementReport",
      },
      {
        ...exportableReport,
        supportsGenerate: false,
        id: "whatsapp-log",
        name: "WhatsApp PDF Delivery Log",
        description: "PDF delivery status, recipients, retry counts and timestamps.",
        route: "/reports/management-delivery/whatsapp-log",
        reportType: "WhatsApp PDF Delivery Log",
        categoryId: "management-delivery",
        existingComponent: "WhatsAppPdfDeliveryLog",
      },
    ],
  },
];

export const oldReportRouteRedirects: Record<string, string> = {
  "/reports/fuel-consumption": "/reports/fuel-efficiency/summary",
  "/reports/fuel-summary": "/reports/fuel-efficiency/summary",
  "/reports/daily-fuel-consumption": "/reports/fuel-efficiency/daily",
  "/reports/shift-wise-fuel": "/reports/fuel-efficiency/shift-wise",
  "/reports/vehicle-efficiency": "/reports/fuel-efficiency/vehicle-efficiency",
  "/reports/fuel-vs-production": "/reports",
  "/reports/fuel-efficiency/fuel-vs-production": "/reports",
  "/reports/running-time": "/reports/operations-utilization/running-time",
  "/reports/idle-time": "/reports/operations-utilization/idle-time",
  "/reports/utilization": "/reports/operations-utilization/utilization",
  "/reports/driver-standstill": "/reports/operations-utilization/driver-standstill",
  "/reports/driverwise-standstill-tracking": "/reports/operations-utilization/driver-standstill",
  "/reports/company-wise": "/reports/performance-analysis/company-wise",
  "/reports/model-wise": "/reports/performance-analysis/model-wise",
  "/reports/site-wise": "/reports/site-fleet/site-wise",
  "/reports/site-vehicle-count": "/reports/site-fleet/vehicle-count",
  "/reports/exceptions": "/reports/alerts-tracker/exceptions",
  "/reports/tracker-health": "/reports/alerts-tracker/tracker-health",
  "/reports/eicher": "/reports/oem/eicher",
  "/reports/case": "/reports/oem/case",
  "/reports/monthly-management": "/reports/management-delivery/monthly-management",
  "/reports/whatsapp-log": "/reports/management-delivery/whatsapp-log",
};

export function normalizeReportPath(pathname: string): string {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const legacyTarget = oldReportRouteRedirects[normalized];
  if (legacyTarget) return legacyTarget;

  const shortcut = reportCategories
    .flatMap((category) => category.reports)
    .find((report) => report.route === normalized && report.isShortcut);

  return shortcut?.redirectTo ?? normalized;
}

export function findReportCategory(pathname: string): ReportCategory | undefined {
  const normalized = normalizeReportPath(pathname);
  return reportCategories.find((category) => (
    category.route === normalized || category.reports.some((report) => report.route === normalized)
  ));
}

export function findReportItem(pathname: string): ReportItem | undefined {
  const normalized = normalizeReportPath(pathname);
  return reportCategories
    .flatMap((category) => category.reports)
    .find((report) => report.route === normalized && !report.isShortcut);
}

export function normalizeReportStatus(status: string | null | undefined): ReportStatus {
  if (status === "ready" || status === "queued" || status === "processing" || status === "failed") {
    return status;
  }
  return "not_generated";
}

export function summarizeReportStatuses(reports: ReportView[]): ReportStatusCounts {
  return reports.reduce<ReportStatusCounts>((counts, report) => {
    counts[report.status] += 1;
    return counts;
  }, {
    ready: 0,
    queued: 0,
    processing: 0,
    failed: 0,
    not_generated: 0,
  });
}

export function latestReportTimestamp(reports: ReportView[]): string | null {
  return reports.reduce<string | null>((latest, report) => {
    if (!report.generatedAt) return latest;
    if (!latest || Date.parse(report.generatedAt) > Date.parse(latest)) return report.generatedAt;
    return latest;
  }, null);
}
