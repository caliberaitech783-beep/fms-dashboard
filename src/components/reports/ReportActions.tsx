import { Download, FileSpreadsheet, FileText, Play, RefreshCw } from "lucide-react";
import type { ReportView } from "../../types/reportCategories";
import { Button } from "../ui/Button";

interface ReportActionsProps {
  report: ReportView;
  canExport: boolean;
  busy?: boolean;
  onOpen: (report: ReportView) => void;
  onGenerate: (report: ReportView) => void;
  onDownload: (report: ReportView, format: "PDF" | "Excel") => void;
}

export function ReportActions({
  report,
  canExport,
  busy = false,
  onOpen,
  onGenerate,
  onDownload,
}: ReportActionsProps) {
  const isReady = report.status === "ready";
  const canDownloadPdf = canExport && isReady && report.item.supportsPdf && report.exportFormats.includes("PDF");
  const canDownloadExcel = canExport && isReady && report.item.supportsExcel && report.exportFormats.includes("Excel");
  const isWaiting = report.status === "queued" || report.status === "processing";

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        size="sm"
        variant="primary"
        icon={<Play aria-hidden="true" className="h-3.5 w-3.5" />}
        onClick={() => onOpen(report)}
      >
        Open Report
      </Button>
      {report.item.supportsGenerate && (
        <Button
          size="sm"
          icon={<RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />}
          disabled={busy || isWaiting}
          onClick={() => onGenerate(report)}
        >
          {report.status === "failed" ? "Retry" : isWaiting ? "In Progress" : "Generate Report"}
        </Button>
      )}
      {canDownloadPdf && (
        <Button
          size="sm"
          icon={<FileText aria-hidden="true" className="h-3.5 w-3.5" />}
          disabled={busy}
          onClick={() => onDownload(report, "PDF")}
        >
          Download PDF
        </Button>
      )}
      {canDownloadExcel && (
        <Button
          size="sm"
          icon={<FileSpreadsheet aria-hidden="true" className="h-3.5 w-3.5" />}
          disabled={busy}
          onClick={() => onDownload(report, "Excel")}
        >
          Download Excel
        </Button>
      )}
      {canExport && isReady && !canDownloadPdf && !canDownloadExcel && (
        <span className="inline-flex items-center gap-1 text-xs text-coal-500">
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          No PDF or Excel file available
        </span>
      )}
    </div>
  );
}
