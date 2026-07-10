import type { DashboardFilters } from "../types/fleet";
import type { FleetTelemetryRecord, Vehicle } from "../types/fleet";
import type { ReportPreview, ReportType } from "../types/reports";
import { ALERT_THRESHOLDS } from "../constants/thresholds";
import {
  aggregateByCompany,
  aggregateByLead,
  aggregateByModel,
  aggregateByShift,
  aggregateBySite,
  aggregateDashboardKpis,
  calculateFuelPerM3,
  calculateIdlePercentage,
  calculateRunningPercentage,
  calculateUtilization,
  generateAlerts,
  getVehiclePerformanceRows,
  sumRecords,
} from "../utils/calculations";
import { getFilteredPortalData, getPortalData } from "./dataAccess";

export const reportService = {
  async getReports() {
    const data = await getPortalData();
    return data.reports;
  },

  async getReportPreview(reportType: ReportType, filters: DashboardFilters): Promise<ReportPreview> {
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

    if (reportType === "Driver wise Report") {
      filteredRecords.forEach((record) => {
        const vehicle = vehicleMap.get(record.vehicleId);
        const driverPerformance = classifyDriverPerformance(record, vehicle);
        if (driverPerformance.category === "Normal") return;

        rows.push({
          date: record.date || record.timestamp.slice(0, 10),
          site: record.siteId ? siteMap.get(record.siteId) ?? record.siteName ?? record.siteId : record.siteName ?? "Not available",
          shift: record.shift === "ALL_DAY" ? "All day" : `Shift ${record.shift}`,
          driverName: record.driverName || "Unassigned",
          driverMobile: record.driverMobile || "-",
          vehicleNumber: record.vehicleNumber,
          performanceCategory: driverPerformance.category,
          economy: driverPerformance.economy,
          norm: vehicle?.standardFuelNorm ?? null,
          unit: vehicle?.fuelMeasurementUnit ?? (record.assetCategory === "Truck" ? "km/L" : "L/hr"),
          economyVariancePercent: driverPerformance.economyVariancePercent,
          runningHours: record.runningHours,
          runningPercentage: record.runningPercentage ?? calculateRunningPercentage(record.runningHours, record.engineHours),
          idleHours: record.idleHours,
          idlePercentage: record.idlePercentage ?? calculateIdlePercentage(record.idleHours, record.engineHours),
          fuelConsumedLitres: record.fuelConsumedLitres,
          trips: record.trips,
          productionM3: record.productionM3,
          status: record.status,
        });
      });

      rows.sort((left, right) => [
        String(left.site).localeCompare(String(right.site), undefined, { numeric: true }),
        String(left.shift).localeCompare(String(right.shift), undefined, { numeric: true }),
        performanceOrder(String(left.performanceCategory)) - performanceOrder(String(right.performanceCategory)),
        String(left.driverName).localeCompare(String(right.driverName), undefined, { numeric: true }),
        String(left.vehicleNumber).localeCompare(String(right.vehicleNumber), undefined, { numeric: true }),
      ].find((value) => value !== 0) ?? 0);
    } else if (reportType.includes("Company-wise")) {
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

  exportCsv(preview: ReportPreview, fileName: string) {
    const csv = rowsToCsv(preview.rows, preview.columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  },

  exportPdf() {
    // TODO: Generate PDF using a backend renderer or client-side PDF library in Phase 2.
    console.info("PDF export is a Phase 2 placeholder.");
  },

  exportExcel() {
    // TODO: Generate .xlsx workbooks with styles and formulas in Phase 2.
    console.info("Excel export is a Phase 2 placeholder.");
  },
};

function classifyDriverPerformance(record: FleetTelemetryRecord, vehicle?: Vehicle) {
  const idlePercentage = record.idlePercentage ?? calculateIdlePercentage(record.idleHours, record.engineHours);
  const runningPercentage = record.runningPercentage ?? calculateRunningPercentage(record.runningHours, record.engineHours);
  const economy = vehicle?.assetCategory === "HEMM"
    ? record.hemmFuelRateLitrePerHour
    : record.truckEfficiencyKmPerLitre;
  const norm = vehicle?.standardFuelNorm ?? null;
  const economyVariancePercent = calculateEconomyVariancePercent(economy, norm, vehicle?.assetCategory);

  if (record.status === "idle" || (idlePercentage ?? 0) >= ALERT_THRESHOLDS.excessiveIdlePercentage) {
    return { category: "Idling", economy, economyVariancePercent };
  }

  if ((runningPercentage ?? 0) >= 80 && (record.trips ?? record.productionM3 ?? 0) > 0) {
    return { category: "High Performance", economy, economyVariancePercent };
  }

  if ((economyVariancePercent ?? 0) > 0) {
    return { category: "Above Economy", economy, economyVariancePercent };
  }

  return { category: "Normal", economy, economyVariancePercent };
}

function calculateEconomyVariancePercent(
  economy: number | null | undefined,
  norm: number | null | undefined,
  assetCategory: Vehicle["assetCategory"] | undefined,
) {
  if (economy === null || economy === undefined || norm === null || norm === undefined || norm <= 0) {
    return null;
  }

  const variance = assetCategory === "HEMM"
    ? ((norm - economy) / norm) * 100
    : ((economy - norm) / norm) * 100;
  return Math.round(variance * 10) / 10;
}

function performanceOrder(category: string) {
  if (category === "High Performance") return 0;
  if (category === "Above Economy") return 1;
  if (category === "Idling") return 2;
  return 3;
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
