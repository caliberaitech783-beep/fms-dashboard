import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ReportCategory,
  ReportStatusFilterValue,
  ReportView,
} from "../../types/reportCategories";
import { Button } from "../ui/Button";
import { EmptyReportState } from "./EmptyReportState";
import { ReportBreadcrumb } from "./ReportBreadcrumb";
import { ReportCard } from "./ReportCard";
import { ReportSearch } from "./ReportSearch";
import { ReportStatusFilter } from "./ReportStatusFilter";

interface ReportCategoryPageProps {
  category: ReportCategory;
  reports: ReportView[];
  canExport: boolean;
  busyReportType?: string | null;
  onNavigate: (route: string) => void;
  onOpen: (report: ReportView) => void;
  onGenerate: (report: ReportView) => void;
  onDownload: (report: ReportView, format: "PDF" | "Excel") => void;
}

export function ReportCategoryPage({
  category,
  reports,
  canExport,
  busyReportType,
  onNavigate,
  onOpen,
  onGenerate,
  onDownload,
}: ReportCategoryPageProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ReportStatusFilterValue>("all");
  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesSearch = !query
        || report.item.name.toLowerCase().includes(query)
        || report.item.description.toLowerCase().includes(query);
      const matchesStatus = status === "all" || report.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [reports, search, status]);

  return (
    <div className="space-y-5">
      <ReportBreadcrumb
        items={[{ label: "Reports", route: "/reports" }, { label: category.name }]}
        onNavigate={onNavigate}
      />

      <div className="rounded-xl border border-coal-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ore-700">Report category</p>
            <h1 className="mt-2 text-2xl font-semibold text-coal-950">{category.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-coal-600">{category.description}</p>
          </div>
          <Button
            icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
            onClick={() => onNavigate("/reports")}
          >
            Back to All Reports
          </Button>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-coal-100 pt-5 sm:flex-row">
          <ReportSearch value={search} onChange={setSearch} />
          <ReportStatusFilter value={status} onChange={setStatus} />
        </div>
      </div>

      {filteredReports.length === 0 ? (
        <EmptyReportState filtered={Boolean(search.trim()) || status !== "all"} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {filteredReports.map((report) => (
            <ReportCard
              key={report.item.id}
              report={report}
              canExport={canExport}
              busy={busyReportType === report.item.reportType}
              onOpen={onOpen}
              onGenerate={onGenerate}
              onDownload={onDownload}
            />
          ))}
        </div>
      )}
    </div>
  );
}
