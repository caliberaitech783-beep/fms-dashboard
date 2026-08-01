const { createScaniaClientFromEnv } = require("./scaniaClient");
const { validateReportInput } = require("./scaniaVehicleEvaluation");
const { normalizeKey } = require("../vehicles/vehicleMasterIntegration");
const { buildDriverStandstillRows } = require("../volvo/driverStandstillReport");
const { deduplicateEvents, eventVin } = require("../volvo/vehicleStatusNormalizer");

function importedVehicleMatchesSite(vehicle, siteMapping) {
  if (!vehicle) return false;
  if (vehicle.siteId) return vehicle.siteId === siteMapping.fmsSiteId;
  const site = normalizeKey(vehicle.siteName || vehicle.rawSiteName);
  return site === normalizeKey(siteMapping.fmsSite)
    || site.includes(normalizeKey(siteMapping.scaniaSite));
}

function importedByVin(importedVehicles) {
  return new Map((importedVehicles || [])
    .filter((vehicle) => vehicle?.vin)
    .map((vehicle) => [normalizeKey(vehicle.vin), vehicle]));
}

function reportVehicle(vin, imported) {
  return {
    trackerId: vin,
    vehicleNumber: imported?.vehicleNumber || vin,
    siteId: imported?.siteId || null,
    siteName: imported?.siteName || null,
  };
}

function displayRow(row) {
  return {
    registrationNumber: row.vehicle,
    vin: row.vin,
    engineRunningTime: row.totalTime,
    distanceDrivenKm: row.drivingKm,
    fuelEconomyKmPerLitre: row.averageDieselEngineKmPerLitre,
    fuelConsumedLitres: row.fuelLitres,
    fuelConsumptionLitresPerHour: row.averageDieselLitresPerHour,
    idlingPercentage: row.standstillPercent,
    idlingTime: row.standstillTime,
    performanceModePowerKm: null,
    performanceModePowerPercentage: null,
    powertrainCoastingPercentage: row.coastingPercent,
    lastUpdatedAt: null,
  };
}

async function generateScaniaStatusReport(input, options = {}) {
  const request = validateReportInput(input);
  const client = options.client || createScaniaClientFromEnv();
  const importedVehicles = options.importedVehicles || [];
  const now = options.now || new Date();
  const shiftStart = new Date(request.startTime);
  const shiftEnd = new Date(request.stopTime);
  const queryStart = new Date(shiftStart.getTime() - 60 * 60_000);
  const queryStop = new Date(Math.min(shiftEnd.getTime() + 5 * 60_000, now.getTime() + 5 * 60_000));
  const statusResult = queryStop > queryStart
    ? await client.getVehicleStatuses({
      latestOnly: false,
      startTime: queryStart.toISOString(),
      stopTime: queryStop.toISOString(),
      dateType: "created",
    })
    : { records: [], endpoint: null, status: 200 };
  const statuses = deduplicateEvents(statusResult.records || []);
  const masterByVin = importedByVin(importedVehicles);
  const statusVinKeys = new Set(statuses.map(eventVin).filter(Boolean).map(normalizeKey));
  const siteMasters = importedVehicles.filter((vehicle) => (
    vehicle?.vin
    && statusVinKeys.has(normalizeKey(vehicle.vin))
    && importedVehicleMatchesSite(vehicle, request.siteMapping)
  ));
  const siteVins = new Set(siteMasters.map((vehicle) => normalizeKey(vehicle.vin)));
  const siteFilterApplied = siteVins.size > 0;
  const statusVins = [...new Set(statuses.map(eventVin).filter(Boolean))];
  const vehicles = statusVins
    .filter((vin) => !siteFilterApplied || siteVins.has(normalizeKey(vin)))
    .map((vin) => reportVehicle(vin, masterByVin.get(normalizeKey(vin))));
  const rows = buildDriverStandstillRows({
    vehicles,
    statuses,
    shiftStart: request.startTime,
    shiftEnd: request.stopTime,
    shiftName: request.shift,
    driverMap: new Map(),
    now,
  }).map(displayRow);
  const notice = siteFilterApplied
    ? null
    : "Scania VIN-to-site assignments are not loaded; showing all live Scania vehicles for this shift.";

  return {
    reportType: "Driverwise Standstill Tracking",
    source: "SCANIA_RFMS_STATUS_HISTORY",
    generatedAt: now.toISOString(),
    rows,
    notice,
    period: {
      date: request.reportDate,
      shift: request.shift,
      site: siteFilterApplied ? request.siteMapping.fmsSite : "All Scania vehicles",
      scaniaSite: request.siteMapping.scaniaSite,
      start: request.startTime,
      end: request.stopTime,
      timezone: request.siteMapping.timezone,
    },
    meta: {
      endpoint: statusResult.endpoint,
      httpStatus: statusResult.status,
      rawRecordCount: statuses.length,
      finalFilteredVehicleCount: rows.length,
      filterCounts: {},
      siteVehicleMasterCount: siteMasters.length,
      sessionId: null,
      unavailableFields: ["performanceModePowerKm", "performanceModePowerPercentage"],
      siteFilterApplied,
      emptyReason: statuses.length === 0
        ? "Scania returned no RFMS status history for the requested period."
        : rows.length === 0
          ? "Scania status history did not contain two usable counter readings within the selected shift."
          : null,
    },
  };
}

module.exports = {
  generateScaniaStatusReport,
  importedVehicleMatchesSite,
};
