const { createScaniaClientFromEnv } = require("./scaniaClient");
const { validateReportInput } = require("./scaniaVehicleEvaluation");
const { normalizeKey } = require("../vehicles/vehicleMasterIntegration");
const { eventVin, eventCreatedTime, eventReceivedTime, eventAccumulated } = require("../volvo/vehicleStatusNormalizer");

function importedVehicleMatchesSite(vehicle, siteMapping) {
  if (!vehicle) return false;
  if (vehicle.siteId) return vehicle.siteId === siteMapping.fmsSiteId;
  const site = normalizeKey(vehicle.siteName || vehicle.rawSiteName);
  return site === normalizeKey(siteMapping.fmsSite)
    || site.includes(normalizeKey(siteMapping.scaniaSite));
}

function number(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? null : Number(value);
}
function delta(previous, current, keys) {
  const read = (record) => number(keys.map((key) => record?.[key]).find((value) => value != null));
  const a = read(previous), b = read(current);
  return a === null || b === null || b < a ? null : b - a;
}
function duration(hours) {
  const minutes = Math.floor(hours * 60 + 1e-7);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
const round = (value) => value === null ? null : Math.round(value * 100) / 100;

async function generateScaniaStatusReport(input, options = {}) {
  const request = validateReportInput(input);
  const client = options.client || createScaniaClientFromEnv();
  const now = options.now || new Date();
  const start = Date.parse(request.startTime);
  const end = Math.min(Date.parse(request.stopTime), now.getTime());
  const result = end > start ? await client.getVehicleStatuses({
    latestOnly: false, startTime: new Date(start).toISOString(),
    stopTime: new Date(end).toISOString(), dateType: "created",
  }) : { records: [], status: 200, endpoint: null };
  const masters = new Map((options.importedVehicles || [])
    .filter((vehicle) => vehicle.vin && importedVehicleMatchesSite(vehicle, request.siteMapping))
    .map((vehicle) => [normalizeKey(vehicle.vin), vehicle]));
  const grouped = new Map();
  for (const record of result.records || []) {
    const vin = normalizeKey(eventVin(record));
    const time = Date.parse(eventCreatedTime(record) || eventReceivedTime(record));
    // Only differences between readings inside this window are measured. Never
    // import a daily total or assume pre-shift activity belongs to this shift.
    if (!masters.has(vin) || !Number.isFinite(time) || time < start || time > end) continue;
    if (!grouped.has(vin)) grouped.set(vin, new Map());
    grouped.get(vin).set(time, record);
  }
  const rows = [], rejectedVehicles = [];
  for (const [vin, samples] of grouped) {
    const readings = [...samples.entries()].sort((a, b) => a[0] - b[0]);
    if (readings.length < 2) continue;
    let hours = 0, distance = 0, fuel = 0, idle = 0, invalid = false;
    for (let i = 1; i < readings.length; i++) {
      const [beforeTime, before] = readings[i - 1], [afterTime, after] = readings[i];
      const engine = delta(before, after, ["totalEngineHours", "TotalEngineHours"]);
      if (engine === null || engine > (afterTime - beforeTime) / 3600000 + 1e-7) {
        invalid = true;
        break;
      }
      hours += engine;
      const km = delta(before, after, ["hrTotalVehicleDistance", "HRTotalVehicleDistance"]);
      const litres = delta(before, after, ["engineTotalFuelUsed", "EngineTotalFuelUsed"]);
      const idleSeconds = delta(eventAccumulated(before), eventAccumulated(after), [
        "durationWheelbasedSpeedZero", "DurationWheelbasedSpeedZero",
        "durationWheelbaseSpeedZero", "DurationWheelbaseSpeedZero",
      ]);
      distance = distance === null || km === null ? null : distance + km / 1000;
      fuel = fuel === null || litres === null ? null : fuel + litres / 1000;
      idle = idle === null || idleSeconds === null || idleSeconds > engine * 3600 + 1e-7
        ? null : idle + idleSeconds / 3600;
    }
    if (invalid) { rejectedVehicles.push(masters.get(vin).vehicleNumber || vin); continue; }
    rows.push({
      registrationNumber: masters.get(vin).vehicleNumber || vin, vin,
      engineRunningTime: duration(hours), distanceDrivenKm: round(distance),
      fuelConsumedLitres: round(fuel),
      fuelEconomyKmPerLitre: round(fuel > 0 && distance !== null ? distance / fuel : null),
      fuelConsumptionLitresPerHour: round(hours > 0 && fuel !== null ? fuel / hours : null),
      idlingPercentage: round(hours > 0 && idle !== null ? idle / hours * 100 : null),
      idlingTime: idle === null ? null : duration(idle),
      powertrainCoastingPercentage: null,
      lastUpdatedAt: new Date(readings.at(-1)[0]).toISOString(),
      coverageStart: new Date(readings[0][0]).toISOString(),
      coverageEnd: new Date(readings.at(-1)[0]).toISOString(),
    });
  }
  const emptyReason = !masters.size ? "Scania VIN-to-site assignments are unavailable for the selected site."
    : !rows.length ? "No valid pairs of Scania engine-counter readings are available inside the selected period." : null;
  return {
    reportType: "Driverwise Standstill Tracking", source: "SCANIA_RFMS_STATUS_HISTORY",
    generatedAt: now.toISOString(), rows,
    notice: [emptyReason, "Totals cover timestamped readings inside the selected period only; gaps at the start or end are not estimated.",
      rejectedVehicles.length ? `${rejectedVehicles.length} vehicle(s) excluded because engine counters reset or exceeded elapsed time.` : null].filter(Boolean).join(" "),
    period: { date: request.reportDate, shift: request.shift, site: request.siteMapping.fmsSite,
      scaniaSite: request.siteMapping.scaniaSite, start: request.startTime,
      end: new Date(Math.max(start, end)).toISOString(), timezone: request.siteMapping.timezone },
    meta: { periodCalculationVersion: 2, endpoint: result.endpoint, httpStatus: result.status,
      rawRecordCount: (result.records || []).length, finalFilteredVehicleCount: rows.length,
      siteVehicleMasterCount: masters.size, siteFilterApplied: true, rejectedVehicles,
      unavailableFields: ["powertrainCoastingPercentage"], emptyReason },
  };
}
module.exports = { generateScaniaStatusReport, importedVehicleMatchesSite };
