import type { Permission } from "./auth";
import type { Report, ReportExportFormat } from "./fleet";
import type { ReportType } from "./reports";

export type ReportStatus = "ready" | "queued" | "processing" | "failed" | "not_generated";
export type ReportStatusFilterValue = "all" | ReportStatus;

export type ReportCategoryId =
  | "fuel-efficiency"
  | "operations-utilization"
  | "production-haulage"
  | "performance-analysis"
  | "site-fleet"
  | "alerts-tracker"
  | "oem"
  | "management-delivery";

export type ReportCategoryIcon =
  | "Fuel"
  | "Activity"
  | "Factory"
  | "Chart"
  | "Map"
  | "AlertTriangle"
  | "Truck"
  | "FileText";

export interface ReportItem {
  id: string;
  name: string;
  description: string;
  route: string;
  reportType: ReportType;
  existingComponent?: string;
  apiKey?: string;
  categoryId: ReportCategoryId;
  isShortcut?: boolean;
  redirectTo?: string;
  supportsPdf?: boolean;
  supportsExcel?: boolean;
  supportsGenerate?: boolean;
  requiredPermission?: Permission;
}

export interface ReportCategory {
  id: ReportCategoryId;
  name: string;
  description: string;
  route: string;
  icon: ReportCategoryIcon;
  reports: ReportItem[];
}

export interface ReportView {
  item: ReportItem;
  source: Report | null;
  status: ReportStatus;
  generatedAt: string | null;
  exportFormats: ReportExportFormat[];
}

export type ReportStatusCounts = Record<ReportStatus, number>;
