import { ArrowLeft, Clock, Download, FileSpreadsheet, FileText, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import {
  findReportCategory,
  findReportItem,
  latestReportTimestamp,
  normalizeReportPath,
  normalizeReportStatus,
  reportCategories,
  summarizeReportStatuses,
} from "../../config/reportCategories";
import type { DashboardFilters, Report } from "../../types/fleet";
import type { ReportView } from "../../types/reportCategories";
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
import { EmptyReportState } from "../reports/EmptyReportState";
import { ReportBreadcrumb } from "../reports/ReportBreadcrumb";
import { ReportCategoryCard } from "../reports/ReportCategoryCard";
import { ReportCategoryPage } from "../reports/ReportCategoryPage";
import { ReportStatusBadge } from "../reports/ReportStatusBadge";
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
  const { currentUser } = useAuth();
  const [currentPath, setCurrentPath] = useState(() => {
    const pathname = window.location.pathname.startsWith("/reports")
      ? window.location.pathname
      : "/reports";
    return normalizeReportPath(pathname);
  });
  const [previewRequestKey, setPreviewRequestKey] = useState(0);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busyReportType, setBusyReportType] = useState<ReportType | null>(null);
  const [explorerState, setExplorerState] = useState<ReportExplorerState>(emptyReportExplorerState);
  const [downloadState, setDownloadState] = useState<{
    open: boolean;
    status: "running" | "done";
    format: "CSV" | "PDF" | "Excel";
    reportType: ReportType;
    startedAt: number;
    elapsedMs: number;
  } | null>(null);
  const closeDownloadRef = useRef<HTMLButtonElement | null>(null);
  const timingCompleteRef = useRef(onTimingComplete);

  const categoryViews = useMemo(() => {
    const reportsByType = new Map(reports.map((report) => [report.type, report]));

    return reportCategories.map((category) => ({
      category,
      reports: category.reports
        .filter((item) => !item.requiredPermission || hasPermission(currentUser, item.requiredPermission))
        .map<ReportView>((item) => {
          const source = reportsByType.get(item.reportType) ?? null;
          return {
            item,
            source,
            status: normalizeReportStatus(source?.status),
            generatedAt: source?.generatedAt ?? null,
            exportFormats: source?.exportFormats ?? [],
          };
        }),
    }));
  }, [currentUser, reports]);
  const visibleCategoryViews = categoryViews.filter((entry) => entry.reports.length > 0);
  const activeCategory = findReportCategory(currentPath);
  const activeCategoryView = visibleCategoryViews.find((entry) => entry.category.id === activeCategory?.id);
  const activeItem = findReportItem(currentPath);
  const activeReport = visibleCategoryViews
    .flatMap((entry) => entry.reports)
    .find((report) => report.item.route === activeItem?.route);
  const selectedReport = activeItem?.reportType ?? "Daily Fuel Consumption Report";
  const canExportReports = hasPermission(currentUser, "reports:export");

  useEffect(() => {
    const syncPath = () => {
      if (!window.location.pathname.startsWith("/reports")) {
        return;
      }

      const requestedPath = window.location.pathname;
      const normalizedPath = normalizeReportPath(requestedPath);
      if (requestedPath !== normalizedPath || window.location.search) {
        window.history.replaceState({}, "", normalizedPath);
      }
      setCurrentPath(normalizedPath);
    };

    if (
      !window.location.pathname.startsWith("/reports")
      && new URLSearchParams(window.location.search).get("section") === "reports"
    ) {
      window.history.replaceState({}, "", "/reports");
    }
    syncPath();
    window.addEventListener("popstate", syncPath);
    window.addEventListener("reports:root", syncPath);
    return () => {
      window.removeEventListener("popstate", syncPath);
      window.removeEventListener("reports:root", syncPath);
    };
  }, []);

  useEffect(() => {
    timingCompleteRef.current = onTimingComplete;
  }, [onTimingComplete]);

  useEffect(() => {
    if (!activeItem || !activeReport) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }

    let mounted = true;
    const startedAt = performance.now();
    setPreviewLoading(true);
    reportService.getReportPreview(selectedReport, filters, { forceRefresh: true })
      .then((result) => {
        if (mounted) {
          setPreview(result);
          setPreviewLoading(false);
          setBusyReportType(null);
          timingCompleteRef.current?.("Report loaded", performance.now() - startedAt);
        }
      })
      .catch(() => {
        if (mounted) {
          setPreview(null);
          setPreviewLoading(false);
          setBusyReportType(null);
          timingCompleteRef.current?.("Report failed", performance.now() - startedAt);
        }
      });

    return () => {
      mounted = false;
    };
  }, [activeItem, activeReport, filters, previewRequestKey, refreshKey, selectedReport]);

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
  const canExportPreview = Boolean(
    canExportReports
    && preview
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

  const navigate = (route: string) => {
    const normalizedRoute = normalizeReportPath(route);
    if (window.location.pathname !== normalizedRoute || window.location.search) {
      window.history.pushState({}, "", normalizedRoute);
    }
    setCurrentPath(normalizedRoute);
  };

  const openReport = (report: ReportView) => {
    navigate(report.item.redirectTo ?? report.item.route);
  };

  const generateReport = (report: ReportView) => {
    const route = normalizeReportPath(report.item.redirectTo ?? report.item.route);
    setBusyReportType(report.item.reportType);
    if (currentPath === route) {
      setPreviewRequestKey((current) => current + 1);
    } else {
      navigate(route);
    }
  };

  const handleDownload = async (format: "CSV" | "PDF" | "Excel") => {
    if (!preview || !canExportPreview) {
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
    setDownloadState({
      open: true,
      status: "running",
      format,
      reportType: selectedReport,
      startedAt,
      elapsedMs: 0,
    });

    try {
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
      setDownloadState({
        open: true,
        status: "done",
        format,
        reportType: selectedReport,
        startedAt,
        elapsedMs,
      });
      onTimingComplete?.("Report downloaded", elapsedMs);
    } catch {
      setDownloadState(null);
      onTimingComplete?.("Report download failed", performance.now() - startedAt);
    }
  };

  const handleCardDownload = async (report: ReportView, format: "PDF" | "Excel") => {
    if (!canExportReports || report.status !== "ready") {
      return;
    }

    const startedAt = performance.now();
    setBusyReportType(report.item.reportType);
    setDownloadState({
      open: true,
      status: "running",
      format,
      reportType: report.item.reportType,
      startedAt,
      elapsedMs: 0,
    });

    try {
      const reportPreview = await reportService.getReportPreview(report.item.reportType, filters, { forceRefresh: true });
      if (reportPreview.error || reportPreview.rows.length === 0) {
        throw new Error(reportPreview.error?.message ?? "No report data is available to export.");
      }
      if (filters.company === "Scania" && reportPreview.live !== true) {
        throw new Error("A live Scania report is required before export.");
      }

      const fileName = makeCsvFileName(report.item.reportType, filters.siteId, filters.shift, filters.dateTo);
      if (format === "PDF") {
        await reportService.exportPdf(
          { ...reportPreview, oem: filters.company },
          fileName.replace(/\.csv$/, ".pdf"),
          { company: filters.company, shift: filters.shift },
        );
      } else {
        await reportService.exportExcel(
          { ...reportPreview, oem: filters.company },
          fileName.replace(/\.csv$/, ".xlsx"),
        );
      }

      const elapsedMs = performance.now() - startedAt;
      setDownloadState({
        open: true,
        status: "done",
        format,
        reportType: report.item.reportType,
        startedAt,
        elapsedMs,
      });
      onTimingComplete?.("Report downloaded", elapsedMs);
    } catch {
      setDownloadState(null);
      onTimingComplete?.("Report download failed", performance.now() - startedAt);
    } finally {
      setBusyReportType(null);
    }
  };

  let pageContent: ReactNode;

  if (currentPath === "/reports") {
    pageContent = (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {visibleCategoryViews.map(({ category, reports: categoryReports }) => (
          <ReportCategoryCard
            key={category.id}
            category={category}
            reportCount={categoryReports.length}
            counts={summarizeReportStatuses(categoryReports)}
            lastUpdated={latestReportTimestamp(categoryReports)}
            onOpen={navigate}
          />
        ))}
      </div>
    );
  } else if (activeCategory && activeCategoryView && currentPath === activeCategory.route) {
    const categoryReports = activeCategoryView.reports;
    pageContent = (
      <ReportCategoryPage
        key={activeCategory.id}
        category={activeCategory}
        reports={categoryReports}
        canExport={canExportReports}
        busyReportType={busyReportType}
        onNavigate={navigate}
        onOpen={openReport}
        onGenerate={generateReport}
        onDownload={handleCardDownload}
      />
    );
  } else if (activeCategory && activeCategoryView && activeItem && activeReport) {
    const isWaiting = activeReport.status === "queued" || activeReport.status === "processing";
    pageContent = (
      <div className="space-y-6">
        <ReportBreadcrumb
          items={[
            { label: "Reports", route: "/reports" },
            { label: activeCategory.name, route: activeCategory.route },
            { label: activeItem.name },
          ]}
          onNavigate={navigate}
        />

        <div className="rounded-xl border border-coal-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-coal-950">{activeItem.name}</h1>
                <ReportStatusBadge status={activeReport.status} />
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-coal-600">{activeItem.description}</p>
            </div>
            <Button
              icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
              onClick={() => navigate(activeCategory.route)}
            >
              Back to {activeCategory.name}
            </Button>
          </div>
        </div>

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
              {activeItem.supportsGenerate && (
                <Button
                  icon={<RefreshCw className={`h-4 w-4 ${busyReportType === selectedReport ? "animate-spin" : ""}`} />}
                  disabled={busyReportType === selectedReport || isWaiting}
                  onClick={() => generateReport(activeReport)}
                >
                  {activeReport.status === "failed" ? "Retry" : isWaiting ? "In Progress" : "Generate"}
                </Button>
              )}
              {canExportReports && (
                <>
                  <Button
                    icon={<Download className="h-4 w-4" />}
                    variant="primary"
                    disabled={!canExportPreview}
                    onClick={() => handleDownload("CSV")}
                  >
                    CSV
                  </Button>
                  <Button
                    icon={<FileText className="h-4 w-4" />}
                    disabled={!canExportPreview}
                    onClick={() => handleDownload("PDF")}
                  >
                    PDF
                  </Button>
                  <Button
                    icon={<FileSpreadsheet className="h-4 w-4" />}
                    disabled={!canExportPreview}
                    onClick={() => handleDownload("Excel")}
                  >
                    Excel
                  </Button>
                </>
              )}
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

        <Panel title="Report Register" subtitle="Generated report status and available formats.">
          {activeReport.source ? (
            <DataTable columns={reportColumns} rows={[activeReport.source]} getRowKey={(row) => row.id} />
          ) : (
            <EmptyReportState />
          )}
        </Panel>
      </div>
    );
  } else {
    pageContent = (
      <div className="space-y-5">
        <ReportBreadcrumb items={[{ label: "Reports", route: "/reports" }, { label: "Unavailable" }]} onNavigate={navigate} />
        <EmptyReportState />
        <Button icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate("/reports")}>
          Back to Reports
        </Button>
      </div>
    );
  }

  return (
    <>
      {pageContent}
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
                    {downloadState.format} export for {downloadState.reportType}
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
    </>
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
