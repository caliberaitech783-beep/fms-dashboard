import { Clock, Download, FileSpreadsheet, FileText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardFilters, Report } from "../../types/fleet";
import type { ReportPreview, ReportType } from "../../types/reports";
import { reportService } from "../../services/reportService";
import { formatDateTime, makeCsvFileName, titleCase } from "../../utils/formatters";
import { visibleReportColumns } from "../../utils/reportColumns";
import {
  emptyReportExplorerState,
  normalizeReportExplorerState,
  sortReportRows,
  type ReportExplorerState,
  type ReportRow,
} from "../../utils/reportExplorer";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";
import {
  DriverStandstillReportPreview,
  driverStandstillColumns,
} from "./DriverStandstillReportPreview";
import { ReportDrilldownRows } from "./ReportDrilldownRows";
import { ReportExplorerControls } from "./ReportExplorerControls";

interface ReportsDashboardProps {
  reports: Report[];
  filters: DashboardFilters;
  loading: boolean;
  refreshKey: number;
  onTimingComplete?: (message: string, elapsedMs: number) => void;
}

const REPORT_SORT_METRIC_HINTS = [
  "standstill",
  "idling",
  "fuel",
  "production",
  "efficiency",
  "utilization",
  "running",
  "idle",
  "trips",
  "distance",
  "percentage",
  "hours",
  "count",
  "score",
  "retry",
];

function defaultReportSortColumn(
  reportType: ReportType,
  company: DashboardFilters["company"],
  columns: string[],
  rows: ReportRow[],
): string {
  const driverwiseDefault = company === "Scania"
    ? "Idling (% of engine running time)"
    : "Standstill (%)";

  if (reportType === "Driverwise Standstill Tracking" && columns.includes(driverwiseDefault)) {
    return driverwiseDefault;
  }

  const metricColumn = columns.find((column) => {
    const normalizedColumn = column.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return REPORT_SORT_METRIC_HINTS.some((hint) => normalizedColumn.includes(hint));
  });
  if (metricColumn) {
    return metricColumn;
  }

  const numericColumn = columns.find((column) => rows.some((row) => {
    const value = row[column];
    return typeof value === "number" || (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()));
  }));

  return numericColumn ?? columns[0] ?? "";
}

export function ReportsDashboard({
  reports,
  filters,
  loading,
  refreshKey,
  onTimingComplete,
}: ReportsDashboardProps) {
  const [selectedReport, setSelectedReport] = useState<ReportType>("Daily Fuel Consumption Report");
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [explorerState, setExplorerState] = useState<ReportExplorerState>(emptyReportExplorerState);
  const [downloadState, setDownloadState] = useState<{
    open: boolean;
    status: "running" | "done";
    format: "CSV" | "PDF" | "Excel";
    startedAt: number;
    elapsedMs: number;
  } | null>(null);
  const closeDownloadRef = useRef<HTMLButtonElement | null>(null);
  const timingCompleteRef = useRef(onTimingComplete);

  useEffect(() => {
    timingCompleteRef.current = onTimingComplete;
  }, [onTimingComplete]);

  useEffect(() => {
    let mounted = true;
    const startedAt = performance.now();
    setPreviewLoading(true);
    reportService.getReportPreview(selectedReport, filters, { forceRefresh: true })
      .then((result) => {
        if (mounted) {
          setPreview(result);
          setPreviewLoading(false);
          timingCompleteRef.current?.("Report loaded", performance.now() - startedAt);
        }
      })
      .catch(() => {
        if (mounted) {
          setPreview(null);
          setPreviewLoading(false);
          timingCompleteRef.current?.("Report failed", performance.now() - startedAt);
        }
      });

    return () => {
      mounted = false;
    };
  }, [filters, refreshKey, selectedReport]);

  useEffect(() => {
    setExplorerState({
      ...emptyReportExplorerState,
      sortDirection: "desc",
    });
  }, [filters.company, selectedReport]);

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

  const explorerColumns = useMemo(() => (
    selectedReport === "Driverwise Standstill Tracking" && preview?.period
      ? driverStandstillColumns(preview).filter((column) => preview?.columns.includes(column))
      : visibleReportColumns(preview?.columns ?? [])
  ), [preview?.columns, preview?.period, selectedReport]);

  useEffect(() => {
    if (previewLoading || explorerColumns.length === 0) {
      return;
    }

    setExplorerState((current) => {
      if (current.sortColumn && explorerColumns.includes(current.sortColumn)) {
        return current;
      }

      const sortColumn = defaultReportSortColumn(
        selectedReport,
        filters.company,
        explorerColumns,
        preview?.rows ?? [],
      );
      return sortColumn
        ? { ...current, sortColumn, sortDirection: "desc" }
        : current;
    });
  }, [explorerColumns, filters.company, preview?.rows, previewLoading, selectedReport]);

  const activeExplorerState = useMemo(
    () => normalizeReportExplorerState(explorerState, explorerColumns),
    [explorerColumns, explorerState],
  );
  const exploredRows = useMemo(
    () => sortReportRows(preview?.rows ?? [], activeExplorerState),
    [activeExplorerState, preview?.rows],
  );
  const canExport = Boolean(
    preview
    && !previewLoading
    && !preview.error
    && exploredRows.length > 0
    && (filters.company !== "Scania" || preview.live === true),
  );

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

  const closeDownloadDialog = () => setDownloadState(null);

  const handleDownload = async (format: "CSV" | "PDF" | "Excel") => {
    if (!preview || !canExport) {
      return;
    }

    const startedAt = performance.now();
    const exploredPreview: ReportPreview = {
      ...preview,
      oem: filters.company,
      columns: explorerColumns,
      rows: exploredRows,
    };
    const csvFileName = makeCsvFileName(selectedReport, filters.siteId, filters.shift, filters.dateTo);
    setDownloadState({ open: true, status: "running", format, startedAt, elapsedMs: 0 });

    if (format === "CSV") {
      reportService.exportCsv(exploredPreview, csvFileName);
    } else if (format === "PDF") {
      await reportService.exportPdf(
        exploredPreview,
        csvFileName.replace(/\.csv$/, ".pdf"),
        { company: filters.company, shift: filters.shift },
      );
    } else {
      await reportService.exportExcel(exploredPreview, csvFileName.replace(/\.csv$/, ".xlsx"));
    }

    const elapsedMs = performance.now() - startedAt;
    setDownloadState(null);
    onTimingComplete?.("Report downloaded", elapsedMs);
  };

  return (
    <div className="space-y-6">
      <Panel title="Report Catalog" subtitle="Report previews use each OEM's configured live service when available.">
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
      </Panel>

      <Panel
        title={selectedReport}
        subtitle={preview ? `Preview generated ${formatDateTime(preview.generatedAt)}` : "Generating preview"}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            {preview && !previewLoading && (
              <ReportExplorerControls
                columns={explorerColumns}
                state={activeExplorerState}
                onChange={setExplorerState}
                singleSort
                explicitSortDirections
              />
            )}
            <Button
              icon={<Download className="h-4 w-4" />}
              variant="primary"
              disabled={!canExport}
              onClick={() => handleDownload("CSV")}
            >
              CSV
            </Button>
            <Button
              icon={<FileText className="h-4 w-4" />}
              disabled={!canExport}
              onClick={() => handleDownload("PDF")}
            >
              PDF
            </Button>
            <Button
              icon={<FileSpreadsheet className="h-4 w-4" />}
              disabled={!canExport}
              onClick={() => handleDownload("Excel")}
            >
              Excel
            </Button>
          </div>
        }
      >
        {previewLoading || !preview ? (
          <LoadingState />
        ) : selectedReport === "Driverwise Standstill Tracking" && preview.period ? (
          <DriverStandstillReportPreview
            preview={preview}
            rows={exploredRows}
            drilldownColumn={activeExplorerState.drilldownColumn}
            subDrilldownColumn={activeExplorerState.subDrilldownColumn}
          />
        ) : (
          <div className="space-y-3">
            {preview.error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                {preview.error.message}
              </div>
            )}
            {!preview.error && preview.notice && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {preview.notice}
              </div>
            )}
            <ReportPreviewTable
              reportType={selectedReport}
              columns={explorerColumns}
              rows={exploredRows}
              drilldownColumn={activeExplorerState.drilldownColumn}
              subDrilldownColumn={activeExplorerState.subDrilldownColumn}
            />
          </div>
        )}
      </Panel>

      <Panel
        title="Report Register"
        subtitle="Generated report status and available formats."
      >
        <DataTable columns={reportColumns} rows={reports} getRowKey={(row) => row.id} />
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

interface ReportPreviewTableProps {
  reportType: ReportType;
  columns: string[];
  rows: ReportRow[];
  drilldownColumn: string;
  subDrilldownColumn: string;
}

function ReportPreviewTable({
  reportType,
  columns,
  rows,
  drilldownColumn,
  subDrilldownColumn,
}: ReportPreviewTableProps) {
  if (!rows.length) {
    return <EmptyState title="No data available" message="Try changing the selected filters." />;
  }

  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 bg-coal-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="whitespace-nowrap border-b border-coal-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-coal-500"
              >
                {reportType === "Eicher Report" ? column : titleCase(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <ReportDrilldownRows
            rows={rows}
            drilldownColumn={drilldownColumn}
            subDrilldownColumn={subDrilldownColumn}
            columnCount={columns.length}
            renderRow={(row, index) => (
              <tr key={`${reportType}-${String(row[columns[0]] ?? "row")}-${index}`}>
                {columns.map((column) => (
                  <td key={column} className="border-b border-coal-100 px-3 py-2 text-coal-700">
                    {String(row[column] ?? "-")}
                  </td>
                ))}
              </tr>
            )}
          />
        </tbody>
      </table>
    </div>
  );
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.max(1, Math.round(milliseconds))} ms`;
  }

  return `${(milliseconds / 1000).toFixed(2)} sec`;
}
