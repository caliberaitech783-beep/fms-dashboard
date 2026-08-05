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
    <article className="flex min-h-56 flex-col rounded-xl border border-coal-200 bg-white p-3 shadow-sm transition hover:border-ore-300 hover:shadow-md">
      <div className="flex flex-1 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-coal-950">{report.item.name}</h3>
            {report.item.isShortcut && (
              <Badge tone="info" className="shrink-0">
                <ExternalLink aria-hidden="true" className="h-3 w-3" /> Shortcut
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs leading-4 text-coal-600">{report.item.description}</p>
        </div>
        <ReportStatusBadge status={report.status} />
      </div>

      <div className="mt-2 rounded-md border border-coal-100 bg-coal-50 px-2 py-1.5 text-[11px] text-coal-600">
        <span className="font-semibold text-coal-700">Last generated:</span>{" "}
        {report.generatedAt ? formatDateTime(report.generatedAt) : "Not generated yet"}
      </div>

      <div className="mt-2 border-t border-coal-100 pt-2">
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
