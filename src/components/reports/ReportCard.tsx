import { ExternalLink } from "lucide-react";
import type { ReportView } from "../../types/reportCategories";
import { formatDateTime } from "../../utils/formatters";
import { Badge } from "../ui/Badge";
import { ReportActions } from "./ReportActions";
import { ReportStatusBadge } from "./ReportStatusBadge";

interface ReportCardProps {
  report: ReportView;
  canExport: boolean;
  busy?: boolean;
  onOpen: (report: ReportView) => void;
  onGenerate: (report: ReportView) => void;
  onDownload: (report: ReportView, format: "PDF" | "Excel") => void;
}

export function ReportCard({
  report,
  canExport,
  busy,
  onOpen,
  onGenerate,
  onDownload,
}: ReportCardProps) {
  return (
    <article className="flex min-h-72 flex-col rounded-xl border border-coal-200 bg-white p-5 shadow-sm transition hover:border-ore-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-coal-950">{report.item.name}</h3>
            {report.item.isShortcut && (
              <Badge tone="info" className="shrink-0">
                <ExternalLink aria-hidden="true" className="h-3 w-3" /> Shortcut
              </Badge>
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-coal-600">{report.item.description}</p>
        </div>
        <ReportStatusBadge status={report.status} />
      </div>

      <div className="mt-4 flex-1 rounded-md border border-coal-100 bg-coal-50 px-3 py-2 text-xs text-coal-600">
        <span className="font-semibold text-coal-700">Last generated:</span>{" "}
        {report.generatedAt ? formatDateTime(report.generatedAt) : "Not generated yet"}
      </div>

      <div className="mt-4 border-t border-coal-100 pt-4">
        <ReportActions
          report={report}
          canExport={canExport}
          busy={busy}
          onOpen={onOpen}
          onGenerate={onGenerate}
          onDownload={onDownload}
        />
      </div>
    </article>
  );
}
