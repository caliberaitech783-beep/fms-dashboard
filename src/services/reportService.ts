import type { DashboardFilters } from "../types/fleet";
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
import { removeHiddenReportColumns } from "../utils/reportColumns";

export const reportService = {
  async getReports() {
    const data = await getPortalData();
    return data.reports;
  },

  async getReportPreview(reportType: ReportType, filters: DashboardFilters): Promise<ReportPreview> {
    if (reportType === "Driverwise Standstill Tracking") {
      return removeHiddenReportColumns(await fetchVolvoDriverStandstillReport(filters));
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
      await fetchVolvoDriverStandstillReport(filters);
    }
  },

  exportCsv(preview: ReportPreview, fileName: string) {
    const visiblePreview = removeHiddenReportColumns(preview);
    const csv = rowsToCsv(visiblePreview.rows, visiblePreview.columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, fileName);
  },

  exportPdf(preview: ReportPreview, fileName: string) {
    const blob = new Blob([buildPdf(removeHiddenReportColumns(preview))], { type: "application/pdf" });
    downloadBlob(blob, fileName);
  },

  exportExcel(preview: ReportPreview, fileName: string) {
    const blob = new Blob([buildXlsxWorkbook(removeHiddenReportColumns(preview))], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    downloadBlob(blob, fileName);
  },
};

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
