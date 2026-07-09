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
  "WhatsApp PDF Delivery Log",
];

export interface ReportPreview {
  reportType: ReportType;
  generatedAt: string;
  rows: Record<string, string | number | null>[];
  columns: string[];
}
