import { Clock, Download, FileSpreadsheet, FileText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DashboardFilters, Report } from "../../types/fleet";
import type { ReportPreview, ReportType } from "../../types/reports";
import { reportService } from "../../services/reportService";
import { formatDateTime, makeCsvFileName, titleCase } from "../../utils/formatters";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

interface ReportsDashboardProps {
  reports: Report[];
  filters: DashboardFilters;
  loading: boolean;
  onTimingComplete?: (message: string, elapsedMs: number) => void;
}

export function ReportsDashboard({ reports, filters, loading, onTimingComplete }: ReportsDashboardProps) {
  const [selectedReport, setSelectedReport] = useState<ReportType>("Daily Fuel Consumption Report");
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadState, setDownloadState] = useState<{
    open: boolean;
    status: "running" | "done";
    format: "CSV" | "PDF" | "Excel";
    startedAt: number;
    elapsedMs: number;
  } | null>(null);
  const closeDownloadRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let mounted = true;
    setPreviewLoading(true);
    reportService.getReportPreview(selectedReport, filters).then((result) => {
      if (mounted) {
        setPreview(result);
        setPreviewLoading(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, [filters, selectedReport]);

  useEffect(() => {
    if (!downloadState?.open || downloadState.status !== "running") {
      return;
    }

    const interval = window.setInterval(() => {
      setDownloadState((current) => current && current.status === "running"
        ? { ...current, elapsedMs: performance.now() - current.startedAt }
        : current);
    }, 100);

    return () => window.clearInterval(interval);
  }, [downloadState?.open, downloadState?.status]);

  useEffect(() => {
    if (downloadState?.status === "done") {
      closeDownloadRef.current?.focus();
    }
  }, [downloadState?.status]);

  if (loading) {
    return <LoadingState />;
  }

  const reportColumns: DataTableColumn<Report>[] = [
    { header: "Report", render: (row) => <span className="font-semibold text-coal-900">{row.name}</span>, className: "min-w-64" },
    { header: "Type", render: (row) => row.type },
    { header: "Generated", render: (row) => formatDateTime(row.generatedAt) },
    { header: "Formats", render: (row) => row.exportFormats.join(", ") },
    { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  const previewColumns: DataTableColumn<Record<string, string | number | null>>[] = (preview?.columns ?? []).map((column) => ({
    header: titleCase(column),
    render: (row) => String(row[column] ?? "-"),
  }));

  const closeDownloadDialog = () => setDownloadState(null);

  const handleDownload = async (format: "CSV" | "PDF" | "Excel") => {
    if (!preview) {
      return;
    }

    const startedAt = performance.now();
    const csvFileName = makeCsvFileName(selectedReport, filters.siteId, filters.shift, filters.dateTo);
    setDownloadState({ open: true, status: "running", format, startedAt, elapsedMs: 0 });

    if (format === "CSV") {
      reportService.exportCsv(preview, csvFileName);
    } else if (format === "PDF") {
      await reportService.exportPdf(preview, csvFileName.replace(/\.csv$/, ".pdf"));
    } else {
      await reportService.exportExcel(preview, csvFileName.replace(/\.csv$/, ".xlsx"));
    }

    const elapsedMs = performance.now() - startedAt;
    setDownloadState(null);
    onTimingComplete?.("Report downloaded", elapsedMs);
  };

  return (
    <div className="space-y-6">
      <Panel title="Report Catalog" subtitle="Phase 1 report previews are generated from normalized mock records.">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {reports.map((report) => (
            <button
              key={report.id}
              onClick={() => setSelectedReport(report.type as ReportType)}
              className={`rounded-lg border p-4 text-left transition ${
                selectedReport === report.type
                  ? "border-ore-600 bg-ore-50"
                  : "border-coal-200 bg-white hover:border-ore-300"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-coal-900">{report.name}</p>
                  <p className="mt-1 text-xs text-coal-500">{formatDateTime(report.generatedAt)}</p>
                </div>
                <StatusBadge status={report.status} />
              </div>
            </button>
          ))}
        </div>
        <DataTable columns={reportColumns} rows={reports} getRowKey={(row) => row.id} />
      </Panel>

      <Panel
        title={selectedReport}
        subtitle={preview ? `Preview generated ${formatDateTime(preview.generatedAt)}` : "Generating preview"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Download className="h-4 w-4" />}
              variant="primary"
              disabled={!preview}
              onClick={() => handleDownload("CSV")}
            >
              CSV
            </Button>
            <Button
              icon={<FileText className="h-4 w-4" />}
              disabled={!preview}
              onClick={() => handleDownload("PDF")}
            >
              PDF
            </Button>
            <Button
              icon={<FileSpreadsheet className="h-4 w-4" />}
              disabled={!preview}
              onClick={() => handleDownload("Excel")}
            >
              Excel
            </Button>
          </div>
        }
      >
        {previewLoading || !preview ? (
          <LoadingState />
        ) : (
          <DataTable columns={previewColumns} rows={preview.rows} getRowKey={(_, index) => `${selectedReport}-${index}`} maxHeight="max-h-[560px]" />
        )}
      </Panel>

      {downloadState?.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-coal-950/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="download-status-title"
          onKeyDown={(event) => {
            if (downloadState.status === "done" && (event.key === "Enter" || event.key === "Tab")) {
              event.preventDefault();
              closeDownloadDialog();
            }
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-coal-200 bg-white p-5 shadow-command">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ore-50 text-ore-700">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="download-status-title" className="text-lg font-semibold text-coal-950">
                    {downloadState.status === "done" ? "Report download complete" : "Downloading report"}
                  </h3>
                  <p className="mt-1 text-sm text-coal-500">
                    {downloadState.format} export for {selectedReport}
                  </p>
                </div>
              </div>
              {downloadState.status === "done" && (
                <button
                  type="button"
                  onClick={closeDownloadDialog}
                  className="rounded-md p-1 text-coal-500 hover:bg-coal-100 hover:text-coal-800"
                  aria-label="Close download status"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            <div className="mt-5 rounded-md border border-coal-200 bg-coal-50 p-3">
              <p className="text-xs font-semibold uppercase text-coal-500">Time taken</p>
              <p className="mt-1 text-2xl font-semibold text-coal-950">{formatDuration(downloadState.elapsedMs)}</p>
            </div>

            <div className="mt-5 flex justify-end">
              <Button
                ref={closeDownloadRef}
                onClick={closeDownloadDialog}
                disabled={downloadState.status !== "done"}
                variant={downloadState.status === "done" ? "primary" : "secondary"}
              >
                {downloadState.status === "done" ? "Close" : "Please wait"}
              </Button>
            </div>
            {downloadState.status === "done" && (
              <p className="mt-3 text-xs text-coal-500">Press Enter or Tab to close this message.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.max(1, Math.round(milliseconds))} ms`;
  }

  return `${(milliseconds / 1000).toFixed(2)} sec`;
}
