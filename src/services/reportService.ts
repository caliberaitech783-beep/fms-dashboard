import { buildTabularPdf, type TabularPdfContext } from "../utils/tabularPdf";
import { dashboardPeriodRecords } from "./dashboardPeriodService";
import { fetchLiuGongReport } from "./liugongService";
import { prepareScaniaStandstill, scaniaExportRows } from "../utils/scaniaStandstill";
import { apiClient } from "./apiClient";
import { invalidateVolvoReportCache } from "./volvoDriverReportService";
import type { DashboardFilters, FleetTelemetryRecord, ShiftCode } from "../types/fleet";
import { reportTypes, type ReportPreview, type ReportType } from "../types/reports";
import { formatDateTime, titleCase } from "../utils/formatters";
import {
  aggregateByCompany,
  aggregateByLead,
  aggregateByModel,
  aggregateByShift,
  aggregateBySite,
  aggregateDashboardKpis,
  calculateFuelPerM3,
  calculateIdlePercentage,
  calculateUtilization,
  generateAlerts,
  getVehiclePerformanceRows,
  sumRecords,
} from "../utils/calculations";
import { getFilteredPortalData } from "./dataAccess";
import { fetchVolvoDriverStandstillReport } from "./volvoDriverReportService";
import {
  fetchScaniaDriverStandstillReport,
  fetchScaniaShiftSummaryReport,
  invalidateScaniaReportCache,
} from "./scaniaReportService";
import {
  fetchEicherLiveSnapshot,
  invalidateEicherLiveCache,
} from "./adapters/eicherLiveService";
import {
  fetchCaseEquipmentReport,
  invalidateCaseEquipmentCache,
} from "./adapters/caseEquipmentService";
import { removeHiddenReportColumns } from "../utils/reportColumns";
import { getOperationalShiftPeriod, resolveOperationalShift } from "../utils/shiftResolver";
import { buildEicherReportRow, EICHER_REPORT_COLUMNS } from "../utils/eicherReport";
import {
  buildDriverwiseStandstillPdf,
  isDriverwiseStandstillReport,
} from "../utils/driverwisePdf";

export const reportService = {
  async getReports() {
    const reports = await apiClient.fleet.fetchReports();
    return reports.filter((report) => reportTypes.includes(report.type as ReportType));
  },

  async getReportPreview(
    reportType: ReportType,
    filters: DashboardFilters,
    options: { forceRefresh?: boolean } = {},
  ): Promise<ReportPreview> {
    if (reportType === "LiuGong Report") return fetchLiuGongReport(reportType, { ...filters, company: "LiuGong" });
    if (filters.company === "LiuGong" && ["Driverwise Standstill Tracking", "Daily Fuel Consumption Report", "Fuel Consumption Report", "Idle Time Report", "Running Time Report", "Utilization Report", "Vehicle Efficiency Report"].includes(reportType)) return fetchLiuGongReport(reportType, filters);
    if (reportType === "Eicher Report") {
      return buildEicherReport(filters, options);
    }

    if (reportType === "CASE Report") {
      return buildCaseReport(filters, options);
    }

    if (reportType === "Shift-wise Fuel Report") {
      return buildShiftWiseFuelReport(filters, options);
    }

    if (reportType === "Driverwise Standstill Tracking") {
      const fetchReport = filters.company === "Scania" ? fetchScaniaDriverStandstillReport : fetchVolvoDriverStandstillReport;
      const allShifts = filters.shift === "All";
      const allSites = filters.siteId === "All" && Boolean(filters.region);
      const sites = allSites
        ? (await apiClient.fleet.fetchSites()).filter((site) => site.location === filters.region).map((site) => site.id)
        : [filters.siteId];
      if (!sites.length) return { reportType, generatedAt: new Date().toISOString(), columns: [], rows: [], notice: "No sites are configured for the selected region." };
      const previews: ReportPreview[] = [];
      let nextSite = 0;
      await Promise.all(Array.from({ length: Math.min(3, sites.length) }, async () => {
      while (nextSite < sites.length) {
        const siteId = sites[nextSite++];
        let selected = { ...filters, siteId };
        if (allShifts) {
          const first = getOperationalShiftPeriod(siteId, filters.dateFrom, "A");
          const last = getOperationalShiftPeriod(siteId, filters.dateTo, "C");
          selected = { ...selected, shift: "A", timePeriodMode: "custom", ...(filters.timePeriodMode !== "custom" && first && last ? { dateFrom: first.dateFrom, timeFrom: first.timeFrom, dateTo: last.dateTo, timeTo: last.timeTo } : {}) };
        }
        previews.push(await fetchReport(selected, options));
      }
      }));
      const valid = previews.filter((preview) => preview.period && !preview.error);
      if (!valid.length) return removeHiddenReportColumns(previews[0]);
      const preview = { ...valid[0], rows: valid.flatMap((item) => item.rows), summary: valid.length === 1 ? valid[0].summary : undefined };
      if (preview.period) preview.period = {
        ...preview.period,
        shift: allShifts ? "All Shifts" : preview.period.shift,
        site: allSites ? `${filters.region} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· All sites` : preview.period.site,
        customTimeRange: filters.timePeriodMode === "custom",
        start: valid.map((item) => item.period!.start).sort((a, b) => Date.parse(a) - Date.parse(b))[0],
        end: valid.map((item) => item.period!.end).sort((a, b) => Date.parse(b) - Date.parse(a))[0],
      };
      const notices = previews.map((item) => item.notice || item.error?.message).filter(Boolean);
      if (valid.length !== previews.length) notices.push("Some selected sites did not return report data. Displaying the available sites.");
      preview.notice = [...new Set(notices)].join(" ") || undefined;
      return removeHiddenReportColumns(prepareScaniaStandstill(preview));
    }

    const data = await getFilteredPortalData(filters);
    const { sites, vehicles, filteredVehicles } = data;
    const periodData = ["Fuel Consumption Report", "Daily Fuel Consumption Report"].includes(reportType)
      ? await dashboardPeriodRecords(filters, filteredVehicles, data.records, data.filteredRecords)
      : { records: data.filteredRecords, notice: "" };
    if (!periodData.records.length && periodData.notice) return {
      reportType, generatedAt: new Date().toISOString(), columns: [], rows: [], notice: periodData.notice,
    };
    const filteredRecords = periodData.records;
    const siteMap = new Map(sites.map((site) => [site.id, site.name]));
    const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const vehicleRows = getVehiclePerformanceRows(filteredRecords, filteredVehicles);
    const totals = sumRecords(filteredRecords);
    const rows: Record<string, string | number | null>[] = [];

    if (reportType === "WhatsApp PDF Delivery Log") {
      return {
        reportType,
        generatedAt: new Date().toISOString(),
        columns: ["reportName", "pdfFileName", "recipientName", "sentAt", "status", "retryCount"],
        rows: (await apiClient.fleet.fetchWhatsAppDeliveryLogs()).map((log) => ({
          reportName: log.reportName,
          pdfFileName: log.pdfFileName,
          recipientName: log.recipientName,
          sentAt: log.sentAt,
          status: log.status,
          retryCount: log.retryCount,
        })),
      };
    }

    if (reportType.includes("Company-wise")) {
      aggregateByCompany(filteredRecords, vehicles).forEach((metric) => rows.push({ ...Object.fromEntries(Object.entries(metric).filter(([key]) => key !== "efficiency")) }));
    } else if (reportType.includes("Model-wise")) {
      aggregateByModel(filteredRecords, vehicles).forEach((metric) => rows.push({ ...Object.fromEntries(Object.entries(metric).filter(([key]) => key !== "efficiency")) }));
    } else if (reportType.includes("Site-wise")) {
      aggregateBySite(filteredRecords).forEach((metric) => rows.push({ ...Object.fromEntries(Object.entries(metric).filter(([key]) => key !== "efficiency")), name: siteMap.get(metric.name) ?? metric.name }));
    } else if (reportType.includes("Lead-wise")) {
      aggregateByLead(filteredRecords).forEach((metric) => rows.push({ ...Object.fromEntries(Object.entries(metric).filter(([key]) => key !== "efficiency")) }));
    } else if (reportType.includes("Shift-wise")) {
      aggregateByShift(filteredRecords).forEach((metric) => rows.push({ ...Object.fromEntries(Object.entries(metric).filter(([key]) => key !== "efficiency")) }));
    } else if (reportType.includes("Exception")) {
      generateAlerts(filteredRecords, filteredVehicles).slice(0, 25).forEach((alert) => rows.push({
        type: alert.type,
        severity: alert.severity,
        vehicleId: alert.vehicleId,
        site: alert.siteId ? siteMap.get(alert.siteId) ?? alert.siteId : "Not available",
        message: alert.message,
        createdAt: alert.createdAt,
        acknowledged: String(alert.acknowledged),
      }));
    } else if (reportType.includes("Tracker Health")) {
      vehicleRows.forEach((row) => rows.push({
        vehicleNumber: row.vehicle.vehicleNumber,
        company: row.vehicle.company,
        model: row.vehicle.modelNumber ?? "Not available",
        status: row.vehicle.status,
        lastDataReceived: row.latestRecord?.timestamp ?? null,
        offlineHours: row.latestRecord?.offlineHours ?? 0,
      }));
    } else if (reportType.includes("Utilization")) {
      vehicleRows.forEach((row) => rows.push({
        vehicleNumber: row.vehicle.vehicleNumber,
        site: row.vehicle.siteId ? siteMap.get(row.vehicle.siteId) ?? row.vehicle.siteId : "Not available",
        runningHours: row.runningHours,
        availableHours: row.latestRecord?.availableHours ?? 8,
        utilizationPercentage: calculateUtilization(row.runningHours, filteredRecords.length ? filteredRecords.filter((record) => record.vehicleId === row.vehicle.id).length * 8 : 0),
      }));
    } else {
      vehicleRows.forEach((row) => rows.push({
        vehicleNumber: row.vehicle.vehicleNumber,
        site: row.vehicle.siteId ? siteMap.get(row.vehicle.siteId) ?? row.vehicle.siteId : "Not available",
        category: row.vehicle.assetCategory,
        company: row.vehicle.company,
        model: row.vehicle.modelNumber ?? "Not available",
        fuelConsumedLitres: row.fuelConsumedLitres,
        runningHours: row.runningHours,
        idleHours: row.idleHours,
        idlePercentage: calculateIdlePercentage(row.idleHours, row.runningHours + row.idleHours),
        trips: row.trips,
        productionM3: row.productionM3,
        fuelPerM3: calculateFuelPerM3(row.fuelConsumedLitres, row.productionM3),
        efficiency: row.efficiency,
        unit: row.vehicle.fuelMeasurementUnit,
      }));
    }

    if (rows.length === 0) {
      const kpis = aggregateDashboardKpis(filteredRecords, filteredVehicles, filters);
      rows.push({
        vehicles: kpis.totalVehicles,
        fuelConsumedLitres: totals.fuelConsumedLitres,
        trips: totals.trips,
        productionM3: totals.productionM3,
      });
    }

    return {
      reportType,
      generatedAt: new Date().toISOString(),
      columns: Object.keys(rows[0] ?? {}),
      rows,
      notice: periodData.notice || undefined,
    };
  },

  async prefetchReportPreview(reportType: ReportType, filters: DashboardFilters) {
    if (filters.company === "LiuGong") return;
    if (reportType === "Driverwise Standstill Tracking") {
      if (filters.company === "Scania") {
        await fetchScaniaDriverStandstillReport(filters);
      } else {
        await fetchVolvoDriverStandstillReport(filters);
      }
    }
  },

  invalidateLiveReportCache() {
    invalidateScaniaReportCache();
    invalidateVolvoReportCache();
  },

  exportCsv(preview: ReportPreview, fileName: string) {
    const visiblePreview = removeHiddenReportColumns(preview);
    const csv = rowsToCsv(scaniaExportRows(visiblePreview), visiblePreview.columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, fileName);
  },

  exportPdf(preview: ReportPreview, fileName: string, context?: TabularPdfContext) {
    const visiblePreview = removeHiddenReportColumns(preview);
    const pdf = isDriverwiseStandstillReport(visiblePreview.reportType) && visiblePreview.oem !== "LiuGong"
      ? buildDriverwiseStandstillPdf(visiblePreview, context)
      : buildTabularPdf(visiblePreview, context);
    const blob = new Blob([pdf], { type: "application/pdf" });
    downloadBlob(blob, fileName);
  },

  exportExcel(preview: ReportPreview, fileName: string) {
    const blob = new Blob([buildXlsxWorkbook(removeHiddenReportColumns(preview))], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    downloadBlob(blob, fileName);
  },
};

const CASE_REPORT_COLUMNS = [
  "Machine",
  "Total Fuel",
  "Average fuel per hour",
  "Working",
  "Idle",
  "Utilization",
];

const SHIFT_REPORT_COLUMNS = [
  "Shift",
  "Site",
  "Vehicles",
  "Fuel consumed (L)",
  "Distance (km)",
  "Running hours",
  "Idle hours",
  "Idle (%)",
  "Efficiency (km/L)",
  "Trips",
  "Production (m3)",
  "Coverage",
];

async function buildEicherReport(
  filters: DashboardFilters,
  options: { forceRefresh?: boolean },
): Promise<ReportPreview> {
  if (options.forceRefresh) {
    invalidateEicherLiveCache();
  }

  const snapshot = await fetchEicherLiveSnapshot();
  if (!snapshot) {
    return {
      reportType: "Eicher Report",
      generatedAt: new Date().toISOString(),
      columns: EICHER_REPORT_COLUMNS,
      rows: [],
      oem: "Eicher",
      live: false,
      source: "EICHER_VECV_LIVE",
      error: {
        kind: "upstream",
        message: "Eicher live data is temporarily unavailable.",
        retryable: true,
      },
    };
  }

  const latestByVehicle = latestRecordsByVehicle(snapshot.telemetry);
  const vehicleSearch = filters.vehicleNumber.trim().toLowerCase();
  const rows = snapshot.vehicles
    .filter((vehicle) => vehicle.source === "EICHER_VECV_LIVE")
    .filter((vehicle) => filters.status === "All" || vehicle.status === filters.status)
    .filter((vehicle) => !vehicleSearch || vehicle.vehicleNumber.toLowerCase().includes(vehicleSearch))
    .map((vehicle) => buildEicherReportRow(vehicle, latestByVehicle.get(vehicle.id)))
    .sort((left, right) => String(left.regNo ?? left.chassisNo).localeCompare(
      String(right.regNo ?? right.chassisNo),
      undefined,
      { numeric: true },
    ));

  return {
    reportType: "Eicher Report",
    generatedAt: new Date().toISOString(),
    columns: EICHER_REPORT_COLUMNS,
    rows,
    oem: "Eicher",
    live: true,
    source: snapshot.source,
    notice: "Generated from the Eicher VECV vehicle fuel-data payload.",
    meta: {
      rawRecordCount: snapshot.meta?.rawRecordCount ?? snapshot.telemetry.length,
      finalFilteredVehicleCount: rows.length,
    },
  };
}

function caseReportTimestamp(date: string, time: string, endOfMinute: boolean): string {
  const normalizedTime = /^\d{2}:\d{2}$/.test(time)
    ? `${time}:${endOfMinute ? "59" : "00"}`
    : time;
  return new Date(`${date}T${normalizedTime}`).toISOString();
}

function caseMetricValue(value: number | null): number | string {
  return roundNullable(value, 2) ?? "--";
}

async function buildCaseReport(
  filters: DashboardFilters,
  options: { forceRefresh?: boolean },
): Promise<ReportPreview> {
  if (options.forceRefresh) {
    invalidateCaseEquipmentCache();
  }

  const snapshot = await fetchCaseEquipmentReport({
    from: caseReportTimestamp(filters.dateFrom, filters.timeFrom || "00:00", false),
    to: caseReportTimestamp(filters.dateTo, filters.timeTo || "23:59", true),
    forceRefresh: options.forceRefresh,
  });
  if (!snapshot) {
    return {
      reportType: "CASE Report",
      generatedAt: new Date().toISOString(),
      columns: CASE_REPORT_COLUMNS,
      rows: [],
      oem: "CASE",
      live: false,
      source: "CASE_EQUIPMENT_METRICS_LIVE",
      error: {
        kind: "upstream",
        message: "CASE data unavailable",
        retryable: true,
      },
    };
  }

  const vehicleSearch = filters.vehicleNumber.trim().toLowerCase();
  const selectedModel = filters.modelNumber === "All" ? "" : filters.modelNumber.trim().toLowerCase();
  const rows = snapshot.rows
    .filter((row) => !vehicleSearch || row.machine.toLowerCase().includes(vehicleSearch))
    .filter((row) => !selectedModel || (row.model ?? "").toLowerCase() === selectedModel)
    .map((row) => ({
      Machine: row.machine,
      "Total Fuel": caseMetricValue(row.totalFuel),
      "Average fuel per hour": caseMetricValue(row.averageFuelPerHour),
      Working: caseMetricValue(row.workingHours),
      Idle: caseMetricValue(row.idleHours),
      Utilization: caseMetricValue(row.utilization),
    }))
    .sort((left, right) => left.Machine.localeCompare(right.Machine, undefined, { numeric: true }));

  return {
    reportType: "CASE Report",
    generatedAt: new Date().toISOString(),
    columns: CASE_REPORT_COLUMNS,
    rows,
    oem: "CASE",
    period: { date: filters.dateFrom, shift: filters.shift, site: filters.siteId === "All" ? "All sites" : filters.siteId.replace(/^site-(wcl|ncl)-/, "").replace(/-/g, " "), start: caseReportTimestamp(filters.dateFrom, filters.timeFrom || "00:00", false), end: caseReportTimestamp(filters.dateTo, filters.timeTo || "23:59", true), timezone: "Asia/Kolkata" },
    live: true,
    source: snapshot.source,
    notice: "Generated from live CASE Equipment, Cumulative Fuel Used, Cumulative Operating Hours and Cumulative Idle Hours APIs. Fuel is in litres, Working and Idle are hours, and Utilization is percent. Missing API values are shown as --.",
    meta: {
      rawRecordCount: snapshot.equipmentCount,
      finalFilteredVehicleCount: rows.length,
    },
  };
}

async function buildShiftWiseFuelReport(
  filters: DashboardFilters,
  options: { forceRefresh?: boolean },
): Promise<ReportPreview> {
  if (filters.company === "Scania") {
    return buildScaniaShiftWiseFuelReport(filters, options);
  }

  const data = await getFilteredPortalData({ ...filters, shift: "All" });
  const vehicleById = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const selectedShift = filters.shift === "All" ? null : filters.shift as ShiftCode;
  const records = data.filteredRecords
    .map((record) => {
      if (record.shift !== "UNKNOWN") return record;
      const vehicle = vehicleById.get(record.vehicleId);
      return {
        ...record,
        shift: resolveOperationalShift(record.siteName || vehicle?.siteName, record.timestamp),
      };
    })
    .filter((record) => !selectedShift || record.shift === selectedShift);

  if (!records.length) {
    const oem = filters.company === "All" ? "selected OEM" : filters.company;
    const shift = selectedShift ? shiftLabel(selectedShift) : "selected shifts";
    return unavailableShiftReport(
      `No ${oem} telemetry could be assigned to ${shift}. Check the site mapping and live integration status.`,
    );
  }

  const groups = new Map<ShiftCode, FleetTelemetryRecord[]>();
  records.forEach((record) => {
    const group = groups.get(record.shift) ?? [];
    group.push(record);
    groups.set(record.shift, group);
  });
  const shiftOrder: ShiftCode[] = ["A", "B", "C", "ALL_DAY", "UNKNOWN"];
  const rows = [...groups.entries()]
    .sort(([left], [right]) => shiftOrder.indexOf(left) - shiftOrder.indexOf(right))
    .map(([shift, shiftRecords]) => {
      const latestByVehicle = latestRecordsByVehicle(shiftRecords);
      const totals = sumRecords(recordsForShiftTotals(shiftRecords));
      return shiftReportRow({
        shift: shiftLabel(shift),
        site: selectedSiteLabel(filters, data.sites),
        vehicles: latestByVehicle.size,
        fuel: totals.fuelConsumedLitres,
        distance: totals.distanceKm,
        runningHours: totals.runningHours,
        idleHours: totals.idleHours,
        engineHours: totals.engineHours,
        trips: totals.trips,
        production: totals.productionM3,
        coverage: shiftCoverage(shiftRecords),
      });
    });
  const live = records.some((record) => record.source !== "DUMMY_SAMPLE");

  return {
    reportType: "Shift-wise Fuel Report",
    generatedAt: new Date().toISOString(),
    columns: SHIFT_REPORT_COLUMNS,
    rows,
    live,
    notice: live
      ? "Live Volvo rows use each vehicle's latest cumulative RFMS snapshot, assigned by mapped site and Asia/Kolkata event time."
      : "Generated from normalized period records.",
  };
}

async function buildScaniaShiftWiseFuelReport(
  filters: DashboardFilters,
  options: { forceRefresh?: boolean },
): Promise<ReportPreview> {
  const siteIds = filters.siteId && filters.siteId !== "All"
    ? [filters.siteId]
    : ["All"];
  const shifts: Extract<ShiftCode, "A" | "B" | "C">[] = (
    filters.shift === "A" || filters.shift === "B" || filters.shift === "C"
      ? [filters.shift]
      : filters.shift === "All" || filters.shift === "ALL_DAY"
        ? ["A", "B", "C"]
        : []
  );
  if (!shifts.length) {
    return unavailableShiftReport("Select All Shifts, All Day, Shift A, Shift B, or Shift C for the Scania report.");
  }

  const scopes = siteIds.flatMap((siteId) => shifts.map((shift) => ({ siteId, shift })));
  const previews: ReportPreview[] = [];
  for (let index = 0; index < scopes.length; index += 3) {
    const batch = scopes.slice(index, index + 3);
    const batchPreviews = await Promise.all(batch.map((scope) => (
      fetchScaniaShiftSummaryReport(
        { ...filters, siteId: scope.siteId, shift: scope.shift },
        options,
      )
    )));
    previews.push(...batchPreviews);
  }

  const successful = previews.filter((preview) => preview.live && !preview.error && preview.rows.length);
  if (!successful.length) {
    const firstError = previews.find((preview) => preview.error)?.error;
    const firstNotice = previews.find((preview) => preview.notice)?.notice;
    const unavailable = unavailableShiftReport(
      firstError?.message
        ?? firstNotice
        ?? "Scania returned no live records for the selected sites and shifts.",
    );
    return firstError ? { ...unavailable, error: firstError, source: "SCANIA_LIVE_API" } : unavailable;
  }

  const rows = successful.flatMap((preview) => preview.rows);
  const failures = previews.length - successful.length;

  return {
    reportType: "Shift-wise Fuel Report",
    generatedAt: new Date().toISOString(),
    columns: SHIFT_REPORT_COLUMNS,
    rows,
    oem: "Scania",
    live: true,
    source: "SCANIA_LIVE_API",
    notice: failures
      ? `${successful.length} Scania site/shift reports loaded; ${failures} could not be loaded. Retry or narrow the filters for details.`
      : "Generated from Scania live cumulative RFMS snapshots, imported site mappings, and Asia/Kolkata event-time shifts.",
  };
}

function unavailableShiftReport(message: string): ReportPreview {
  return {
    reportType: "Shift-wise Fuel Report",
    generatedAt: new Date().toISOString(),
    columns: ["Status", "Message"],
    rows: [{ Status: "No shift data", Message: message }],
    live: false,
    notice: message,
  };
}

function latestRecordsByVehicle(records: FleetTelemetryRecord[]): Map<string, FleetTelemetryRecord> {
  const latest = new Map<string, FleetTelemetryRecord>();
  records.forEach((record) => {
    const current = latest.get(record.vehicleId);
    if (!current || record.timestamp > current.timestamp) latest.set(record.vehicleId, record);
  });
  return latest;
}

function recordsForShiftTotals(records: FleetTelemetryRecord[]): FleetTelemetryRecord[] {
  const periodRecords = records.filter((record) => record.source === "DUMMY_SAMPLE");
  const liveRecords = records.filter((record) => record.source !== "DUMMY_SAMPLE");
  return [...periodRecords, ...latestRecordsByVehicle(liveRecords).values()];
}

function shiftReportRow(values: {
  shift: string;
  site: string;
  vehicles: number;
  fuel: number;
  distance: number;
  runningHours: number;
  idleHours: number;
  engineHours: number;
  trips: number;
  production: number;
  coverage: string;
}) {
  return {
    Shift: values.shift,
    Site: values.site,
    Vehicles: values.vehicles,
    "Fuel consumed (L)": roundNumber(values.fuel),
    "Distance (km)": roundNumber(values.distance),
    "Running hours": roundNumber(values.runningHours),
    "Idle hours": roundNumber(values.idleHours),
    "Idle (%)": calculateIdlePercentage(
      values.idleHours,
      values.engineHours || values.runningHours + values.idleHours,
    ),
    "Efficiency (km/L)": values.fuel > 0 ? roundNumber(values.distance / values.fuel) : null,
    Trips: roundNumber(values.trips),
    "Production (m3)": roundNumber(values.production),
    Coverage: values.coverage,
  };
}

function selectedSiteLabel(filters: DashboardFilters, sites: { id: string; name: string }[]) {
  if (!filters.siteId || filters.siteId === "All") return "All sites";
  return sites.find((site) => site.id === filters.siteId)?.name ?? filters.siteId;
}

function shiftLabel(shift: ShiftCode | undefined): string {
  if (shift === "ALL_DAY") return "All day";
  if (shift === "UNKNOWN" || !shift) return "Unresolved shift";
  return `Shift ${shift}`;
}

function shiftCoverage(records: FleetTelemetryRecord[]): string {
  const sources = new Set(records.map((record) => record.source));
  const labels: string[] = [];
  if (sources.has("VOLVO_RFMS_LIVE")) labels.push("Volvo live cumulative snapshot");
  if (sources.has("SCANIA_RFMS_LIVE")) labels.push("Scania live cumulative snapshot");
  if (sources.has("EICHER_VECV_LIVE")) labels.push("Eicher live location snapshot");
  if (sources.has("DUMMY_SAMPLE")) labels.push("Sample period data");
  return labels.join(" + ") || "No source";
}

function roundNumber(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

function roundNullable(value: number | null | undefined, digits = 2): number | null {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : roundNumber(value, digits);
}

function rowsToCsv(rows: Record<string, string | number | null>[], columns: string[]) {
  const escapeCell = (value: string | number | null) => {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  return [
    columns.map(escapeCell).join(","),
    ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(",")),
  ].join("\n");
}

function buildXlsxWorkbook(preview: ReportPreview) {
  const sheetName = sanitizeWorksheetName(preview.reportType);
  const sheetRows = [
    preview.columns.map((column) => titleCase(column)),
    ...scaniaExportRows(preview).map((row) => preview.columns.map((column) => cellToText(row[column]))),
  ];
  const worksheetXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    "<sheetData>",
    sheetRows.map((row, rowIndex) => (
      `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => xlsxCell(value, rowIndex + 1, columnIndex + 1)).join("")}</row>`
    )).join(""),
    "</sheetData>",
    "</worksheet>",
  ].join("");

  return createZip({
    "[Content_Types].xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      "</Types>",
    ].join(""),
    "_rels/.rels": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
      "</Relationships>",
    ].join(""),
    "xl/workbook.xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      "<sheets>",
      `<sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/>`,
      "</sheets>",
      "</workbook>",
    ].join(""),
    "xl/_rels/workbook.xml.rels": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      "</Relationships>",
    ].join(""),
    "xl/styles.xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>',
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>',
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
      '<cellXfs count="1"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>',
      "</styleSheet>",
    ].join(""),
    "xl/worksheets/sheet1.xml": worksheetXml,
  });
}

function xlsxCell(value: string, rowIndex: number, columnIndex: number) {
  const reference = `${columnName(columnIndex)}${rowIndex}`;
  return `<c r="${reference}" t="inlineStr" s="0"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function sanitizeWorksheetName(name: string) {
  const sanitized = name.replace(/[\[\]:*?/\\]/g, " ").trim() || "Report";
  return sanitized.slice(0, 31);
}

function cellToText(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function createZip(files: Record<string, string>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  Object.entries(files).forEach(([fileName, content]) => {
    const nameBytes = encoder.encode(fileName);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centralParts.length, true);
  endView.setUint16(10, centralParts.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concatUint8Arrays([...localParts, ...centralParts, endRecord]);
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  data.forEach((byte) => {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  });

  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function columnName(index: number) {
  let value = index;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}
