import type { DashboardFilters, FleetTelemetryRecord, ShiftCode } from "../types/fleet";
import type { ReportPreview, ReportType } from "../types/reports";
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
import { getFilteredPortalData, getPortalData } from "./dataAccess";
import { fetchVolvoDriverStandstillReport } from "./volvoDriverReportService";
import {
  fetchScaniaDriverStandstillReport,
  fetchScaniaShiftSummaryReport,
  invalidateScaniaReportCache,
} from "./scaniaReportService";
import { removeHiddenReportColumns } from "../utils/reportColumns";
import { resolveOperationalShift } from "../utils/shiftResolver";
import {
  buildDriverwiseStandstillPdf,
  isDriverwiseStandstillReport,
  type DriverwisePdfContext,
} from "../utils/driverwisePdf";

export const reportService = {
  async getReports() {
    const data = await getPortalData();
    return data.reports;
  },

  async getReportPreview(
    reportType: ReportType,
    filters: DashboardFilters,
    options: { forceRefresh?: boolean } = {},
  ): Promise<ReportPreview> {
    if (reportType === "Shift-wise Fuel Report") {
      return buildShiftWiseFuelReport(filters, options);
    }

    if (reportType === "Driverwise Standstill Tracking") {
      const preview = filters.company === "Scania"
        ? await fetchScaniaDriverStandstillReport(filters, options)
        : await fetchVolvoDriverStandstillReport(filters, options);
      return removeHiddenReportColumns(preview);
    }

    const { sites, vehicles, filteredVehicles, filteredRecords, whatsAppDeliveryLogs } = await getFilteredPortalData(filters);
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
        rows: whatsAppDeliveryLogs.map((log) => ({
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
      aggregateByCompany(filteredRecords, vehicles).forEach((metric) => rows.push({ ...metric }));
    } else if (reportType.includes("Model-wise")) {
      aggregateByModel(filteredRecords, vehicles).forEach((metric) => rows.push({ ...metric }));
    } else if (reportType.includes("Site-wise")) {
      aggregateBySite(filteredRecords).forEach((metric) => rows.push({ ...metric, name: siteMap.get(metric.name) ?? metric.name }));
    } else if (reportType.includes("Lead-wise")) {
      aggregateByLead(filteredRecords).forEach((metric) => rows.push({ ...metric }));
    } else if (reportType.includes("Shift-wise")) {
      aggregateByShift(filteredRecords).forEach((metric) => rows.push({ ...metric }));
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
      rows: rows.slice(0, 60),
    };
  },

  async prefetchReportPreview(reportType: ReportType, filters: DashboardFilters) {
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
  },

  exportCsv(preview: ReportPreview, fileName: string) {
    const visiblePreview = removeHiddenReportColumns(preview);
    const csv = rowsToCsv(visiblePreview.rows, visiblePreview.columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, fileName);
  },

  exportPdf(preview: ReportPreview, fileName: string, context?: DriverwisePdfContext) {
    const visiblePreview = removeHiddenReportColumns(preview);
    const pdf = isDriverwiseStandstillReport(visiblePreview.reportType)
      ? buildDriverwiseStandstillPdf(visiblePreview, context)
      : buildPdf(visiblePreview);
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
  if (sources.has("DUMMY_SAMPLE")) labels.push("Sample period data");
  return labels.join(" + ") || "No source";
}

function roundNumber(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
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
    ...preview.rows.map((row) => preview.columns.map((column) => cellToText(row[column]))),
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

function buildPdf(preview: ReportPreview) {
  const lines = [
    preview.reportType,
    `Generated: ${formatDateTime(preview.generatedAt)}`,
    "",
    `Rows: ${preview.rows.length}`,
    "",
  ];

  preview.rows.forEach((row, rowIndex) => {
    lines.push(`Row ${rowIndex + 1}`);
    const rowText = preview.columns
      .map((column) => `${titleCase(column)}: ${cellToText(row[column]) || "-"}`)
      .join(" | ");
    lines.push(...wrapText(rowText, 118));
    lines.push("");
  });

  return createPdf(lines);
}

function createPdf(lines: string[]) {
  const pageLineLimit = 40;
  const pageWidth = 842;
  const pageHeight = 595;
  const pages = chunk(lines.length ? lines : ["No data available"], pageLineLimit);
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  const contentObjectIds = pages.map((_, index) => 5 + index * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  pages.forEach((pageLines, pageIndex) => {
    const content = buildPdfPageContent(pageLines, pageHeight);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectIds[pageIndex]} 0 R >>`);
    objects.push(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`);
  });

  return new TextEncoder().encode(assemblePdf(objects));
}

function buildPdfPageContent(lines: string[], pageHeight: number) {
  const commands = ["BT", "/F1 9 Tf", "12 TL"];
  lines.forEach((line, index) => {
    const y = pageHeight - 36 - index * 12;
    commands.push(`1 0 0 1 36 ${y} Tm (${escapePdfText(line)}) Tj`);
  });
  commands.push("ET");
  return commands.join("\n");
}

function assemblePdf(objects: string[]) {
  const encoder = new TextEncoder();
  const chunks = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  let byteLength = encoder.encode(chunks[0]).length;

  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const serialized = `${index + 1} 0 obj\n${object}\nendobj\n`;
    chunks.push(serialized);
    byteLength += encoder.encode(serialized).length;
  });

  const xrefOffset = byteLength;
  chunks.push([
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
  ].join("\n"));

  return chunks.join("");
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function wrapText(text: string, maxLength: number) {
  const words = normalizePdfText(text).split(/\s+/);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    if (word.length > maxLength) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxLength) {
        lines.push(word.slice(index, index + maxLength));
      }
      return;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) {
    lines.push(current);
  }

  return lines;
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

function escapePdfText(value: string) {
  return normalizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
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
