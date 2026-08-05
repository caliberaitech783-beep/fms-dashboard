import {
  Activity,
  AlertTriangle,
  BarChart3,
  Factory,
  FileText,
  Fuel,
  MapPinned,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { ReportCategory, ReportStatusCounts } from "../../types/reportCategories";
import { formatDateTime } from "../../utils/formatters";

const CATEGORY_ICONS: Record<ReportCategory["icon"], LucideIcon> = {
  Fuel,
  Activity,
  Factory,
  Chart: BarChart3,
  Map: MapPinned,
  AlertTriangle,
  Truck,
  FileText,
};

interface ReportCategoryCardProps {
  category: ReportCategory;
  reportCount: number;
  counts: ReportStatusCounts;
  lastUpdated: string | null;
  onOpen: (route: string) => void;
}

export function ReportCategoryCard({
  category,
  reportCount,
  counts,
  lastUpdated,
  onOpen,
}: ReportCategoryCardProps) {
  const Icon = CATEGORY_ICONS[category.icon];

  return (
    <button
      type="button"
      onClick={() => onOpen(category.route)}
      className="group flex h-full min-h-64 flex-col rounded-xl border border-coal-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-ore-300 hover:shadow-command focus:outline-none focus:ring-2 focus:ring-ore-500 focus:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-ore-50 text-ore-700 transition group-hover:bg-ore-100">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-coal-200 bg-coal-50 px-2.5 py-1 text-xs font-semibold text-coal-700">
          {reportCount} {reportCount === 1 ? "Report" : "Reports"}
        </span>
      </div>

      <h2 className="mt-4 text-lg font-semibold text-coal-950">{category.name}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-coal-600">{category.description}</p>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{counts.ready} Ready</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{counts.queued} Queued</span>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">{counts.processing} Processing</span>
        {counts.failed > 0 && (
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{counts.failed} Failed</span>
        )}
        {counts.not_generated > 0 && (
          <span className="rounded-full bg-coal-100 px-2.5 py-1 text-coal-700">{counts.not_generated} Not Generated</span>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-coal-100 pt-4">
        <span className="text-xs text-coal-500">
          Last updated: {lastUpdated ? formatDateTime(lastUpdated) : "Not generated yet"}
        </span>
        <span className="text-sm font-semibold text-ore-700 group-hover:text-ore-800">View Reports</span>
      </div>
    </button>
  );
}
