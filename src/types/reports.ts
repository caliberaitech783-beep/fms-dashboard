export type ReportType =
  | "Daily Fuel Consumption Report"
  | "Shift-wise Fuel Report"
  | "Vehicle Efficiency Report"
  | "Idle Time Report"
  | "Running Time Report"
  | "Production Report"
  | "Fuel vs Production Report"
  | "Company-wise Performance Report"
  | "Model-wise Performance Report"
  | "Site-wise Report"
  | "Lead-wise Report"
  | "Exception Report"
  | "Tracker Health Report"
  | "Monthly Management Report"
  | "Utilization Report"
  | "Fuel Consumption Report"
  | "Site-wise Asset / Vehicle Count Report"
  | "Driverwise Standstill Tracking"
  | "Eicher Report"
  | "CASE Report"
  | "WhatsApp PDF Delivery Log";

export const reportTypes: ReportType[] = [
  "Daily Fuel Consumption Report",
  "Shift-wise Fuel Report",
  "Vehicle Efficiency Report",
  "Idle Time Report",
  "Running Time Report",
  "Production Report",
  "Fuel vs Production Report",
  "Company-wise Performance Report",
  "Model-wise Performance Report",
  "Site-wise Report",
  "Lead-wise Report",
  "Exception Report",
  "Tracker Health Report",
  "Monthly Management Report",
  "Utilization Report",
  "Fuel Consumption Report",
  "Site-wise Asset / Vehicle Count Report",
  "Driverwise Standstill Tracking",
  "Eicher Report",
  "CASE Report",
  "WhatsApp PDF Delivery Log",
];

export interface ReportPreview {
  reportType: ReportType;
  generatedAt: string;
  rows: Record<string, string | number | null>[];
  columns: string[];
  oem?: string;
  live?: boolean;
  source?: string;
  notice?: string | null;
  error?: {
    kind:
      | "authentication"
      | "permission"
      | "timeout"
      | "mapping"
      | "validation"
      | "configuration"
      | "rate_limit"
      | "network"
      | "upstream"
      | "portal_authentication"
      | "portal_permission";
    message: string;
    retryable?: boolean;
    status?: number;
  };
  meta?: {
    endpoint?: string | null;
    httpStatus?: number | null;
    rawRecordCount?: number | null;
    finalFilteredVehicleCount?: number | null;
    filterCounts?: Record<string, number>;
    siteVehicleMasterCount?: number | null;
    sessionId?: string | null;
    unavailableFields?: string[];
    emptyReason?: string | null;
  };
  period?: {
    date: string;
    requestedDate?: string;
    fallbackApplied?: boolean;
    shift: string;
    site?: string;
    scaniaSite?: string;
    start: string;
    end: string;
    timezone: string;
  };
}
