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
  const rows = [], unavailableVehicles = [];
  for (const [vin, master] of masters) {
    const readings = [...(grouped.get(vin) || new Map()).entries()].sort((a, b) => a[0] - b[0]);
    // RFMS events can omit counters and counters can update in steps. Validate
    // the complete measured span, not each short interval between events.
    const engineKeys = ["totalEngineHours", "TotalEngineHours"];
    const usable = readings.filter(([, record]) => engineKeys.some(key => number(record[key]) !== null));
    const first = usable[0], last = usable.at(-1);
    let hours = null, distance = null, fuel = null, idle = null;
    if (usable.length >= 2) {
      const before = first[1], after = last[1];
      const counter = (keys, accumulated = false) => {
        const records = usable.map(([, record]) => accumulated ? eventAccumulated(record) : record);
        // A reset invalidates only this measurement, never the vehicle row.
        let previous = null;
        for (const record of records) {
          const value = number(keys.map(key => record?.[key]).find(value => value != null));
          if (value === null) continue;
          if (previous !== null && value < previous) return null;
          previous = value;
        }
        return delta(accumulated ? eventAccumulated(before) : before,
          accumulated ? eventAccumulated(after) : after, keys);
      };
      hours = counter(engineKeys);
      if (hours !== null && hours > (last[0] - first[0]) / 3600000 + 1e-7) hours = null;
      const metres = counter(["hrTotalVehicleDistance", "HRTotalVehicleDistance", "HrTotalVehicleDistance"]);
      const millilitres = counter(["engineTotalFuelUsed", "EngineTotalFuelUsed"]);
      const seconds = counter(["durationWheelbasedSpeedZero", "DurationWheelbasedSpeedZero",
        "durationWheelbaseSpeedZero", "DurationWheelbaseSpeedZero"], true);
      distance = metres === null ? null : metres / 1000;
      fuel = millilitres === null ? null : millilitres / 1000;
      idle = seconds === null || hours === null || seconds > hours * 3600 + 1e-7 ? null : seconds / 3600;
    }
    if (hours === null) unavailableVehicles.push(master.vehicleNumber || vin);
    rows.push({
      registrationNumber: masters.get(vin).vehicleNumber || vin, vin,
      engineRunningTime: hours === null ? null : duration(hours), distanceDrivenKm: round(distance),
      fuelConsumedLitres: round(fuel),
      fuelEconomyKmPerLitre: round(fuel > 0 && distance !== null ? distance / fuel : null),
      fuelConsumptionLitresPerHour: round(hours > 0 && fuel !== null ? fuel / hours : null),
      idlingPercentage: round(hours > 0 && idle !== null ? idle / hours * 100 : null),
      idlingTime: idle === null ? null : duration(idle),
      powertrainCoastingPercentage: null,
      lastUpdatedAt: last ? new Date(last[0]).toISOString() : null,
      coverageStart: first ? new Date(first[0]).toISOString() : null,
      coverageEnd: last ? new Date(last[0]).toISOString() : null,
    });
  }
  const emptyReason = !masters.size ? "Scania VIN-to-site assignments are unavailable for the selected site."
    : !rows.length ? "No valid pairs of Scania engine-counter readings are available inside the selected period." : null;
  return {
    reportType: "Driverwise Standstill Tracking", source: "SCANIA_RFMS_STATUS_HISTORY",
    generatedAt: now.toISOString(), rows,
    notice: [emptyReason, "Totals cover timestamped readings inside the selected period only; gaps at the start or end are not estimated.",
      `${rows.length} mapped vehicles shown; ${rows.length - unavailableVehicles.length} with measured runtime, ${unavailableVehicles.length} with runtime unavailable. Missing or invalid measurements are shown as dashes, not zero.`].filter(Boolean).join(" "),
    period: { date: request.reportDate, shift: request.shift, site: request.siteMapping.fmsSite,
      scaniaSite: request.siteMapping.scaniaSite, start: request.startTime,
      end: new Date(Math.max(start, end)).toISOString(), timezone: request.siteMapping.timezone },
    meta: { periodCalculationVersion: 3, endpoint: result.endpoint, httpStatus: result.status,
      rawRecordCount: (result.records || []).length, finalFilteredVehicleCount: rows.length,
      siteVehicleMasterCount: masters.size, siteFilterApplied: true, unavailableVehicles,
      unavailableFields: ["powertrainCoastingPercentage"], emptyReason },
  };
}
module.exports = { generateScaniaStatusReport, importedVehicleMatchesSite };
