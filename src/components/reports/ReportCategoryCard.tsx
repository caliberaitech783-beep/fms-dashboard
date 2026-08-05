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
      className="group flex h-full min-h-40 flex-col rounded-xl border border-coal-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-ore-300 hover:shadow-command focus:outline-none focus:ring-2 focus:ring-ore-500 focus:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ore-50 text-ore-700 transition group-hover:bg-ore-100">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </div>
        <span className="rounded-full border border-coal-200 bg-coal-50 px-1.5 py-0.5 text-[11px] font-semibold text-coal-700">
          {reportCount} {reportCount === 1 ? "Report" : "Reports"}
        </span>
      </div>

      <h2 className="mt-2 text-sm font-semibold text-coal-950">{category.name}</h2>
      <p className="mt-1 flex-1 text-xs leading-4 text-coal-600">{category.description}</p>

      <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-semibold">
        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{counts.ready} Ready</span>
        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700">{counts.queued} Queued</span>
        <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-blue-700">{counts.processing} Processing</span>
        {counts.failed > 0 && (
          <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-red-700">{counts.failed} Failed</span>
        )}
        {counts.not_generated > 0 && (
          <span className="rounded-full bg-coal-100 px-1.5 py-0.5 text-coal-700">{counts.not_generated} Not Generated</span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-coal-100 pt-2">
        <span className="text-[11px] text-coal-500">
          Last updated: {lastUpdated ? formatDateTime(lastUpdated) : "Not generated yet"}
        </span>
        <span className="text-[11px] font-semibold text-ore-700 group-hover:text-ore-800">View Reports</span>
      </div>
    </button>
  );
}
