const { normalizeKey } = require("../vehicles/vehicleMasterIntegration");

const TIME_ZONE = "Asia/Kolkata";

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return null;
}

function normalizeTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const zoned = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`;
  const date = new Date(zoned);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function vinFrom(value) {
  return firstText(value?.vin, value?.VIN, value?.Vin)?.toUpperCase() || null;
}

function recordedAtFrom(status) {
  return normalizeTimestamp(firstText(
    status?.createdDateTime,
    status?.CreatedDateTime,
    status?.receivedDateTime,
    status?.ReceivedDateTime,
  ));
}

function localDateTimeParts(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function previousCalendarDate(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function resolveShift(timestamp) {
  const local = localDateTimeParts(timestamp);
  if (local.hour >= 5 && local.hour < 13) {
    return { shift: "A", shiftDate: local.date };
  }
  if (local.hour >= 13 && local.hour < 21) {
    return { shift: "B", shiftDate: local.date };
  }
  return {
    shift: "C",
    shiftDate: local.hour < 5 ? previousCalendarDate(local.date) : local.date,
  };
}

function latestStatusesByVin(statuses) {
  const latest = new Map();
  for (const status of statuses || []) {
    const vin = vinFrom(status);
    const recordedAt = recordedAtFrom(status);
    if (!vin || !recordedAt) continue;
    const existing = latest.get(vin);
    if (!existing || recordedAt > existing.recordedAt) {
      latest.set(vin, { status, recordedAt });
    }
  }
  return latest;
}

function vehicleRegistration(vehicle) {
  return firstText(
    vehicle?.customerVehicleName,
    vehicle?.CustomerVehicleName,
    vehicle?.licensePlate,
    vehicle?.LicensePlate,
  )?.replace(/\*/g, "").trim() || null;
}

function buildVehicleIndexes(vehicles, importedVehicles) {
  const apiByVin = new Map();
  for (const vehicle of vehicles || []) {
    const vin = vinFrom(vehicle);
    if (vin) apiByVin.set(vin, vehicle);
  }

  const importedByVin = new Map();
  const importedByNumber = new Map();
  for (const vehicle of importedVehicles || []) {
    const vin = normalizeKey(vehicle?.vin);
    const number = normalizeKey(vehicle?.vehicleNumber);
    if (vin) importedByVin.set(vin, vehicle);
    if (number) importedByNumber.set(number, vehicle);
  }
  return { apiByVin, importedByVin, importedByNumber };
}

function matchesSite(vehicle, siteMapping) {
  if (!siteMapping.fmsSiteId) return true;
  return normalizeKey(vehicle?.siteId) === normalizeKey(siteMapping.fmsSiteId)
    || normalizeKey(vehicle?.siteName) === normalizeKey(siteMapping.fmsSite)
    || normalizeKey(vehicle?.rawSiteName).includes(normalizeKey(siteMapping.fmsSite));
}

function round(value, decimals = 2) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function buildScaniaShiftSummary(input) {
  const {
    statuses = [],
    vehicles = [],
    importedVehicles = [],
    request,
    generatedAt = new Date().toISOString(),
  } = input;
  const indexes = buildVehicleIndexes(vehicles, importedVehicles);
  const latestStatuses = latestStatusesByVin(statuses);
  const matched = [];
  const isAllSites = !request.siteMapping.fmsSiteId;

  for (const [vin, latest] of latestStatuses) {
    const apiVehicle = indexes.apiByVin.get(vin);
    const registrationNumber = vehicleRegistration(apiVehicle);
    const master = indexes.importedByVin.get(normalizeKey(vin))
      || indexes.importedByNumber.get(normalizeKey(registrationNumber));
    if (!isAllSites && (!master || master.active === false || !matchesSite(master, request.siteMapping))) {
      continue;
    }
    const resolved = resolveShift(latest.recordedAt);
    if (resolved.shift !== request.shift) continue;

    matched.push({
      vin,
      vehicleNumber: master?.vehicleNumber || registrationNumber || vin,
      recordedAt: latest.recordedAt,
      shiftDate: resolved.shiftDate,
      distanceKm: (() => {
        const metres = firstFinite(
          latest.status?.hrTotalVehicleDistance,
          latest.status?.HrTotalVehicleDistance,
        );
        return metres === null ? null : metres / 1000;
      })(),
      fuelLitres: (() => {
        const millilitres = firstFinite(
          latest.status?.engineTotalFuelUsed,
          latest.status?.EngineTotalFuelUsed,
        );
        return millilitres === null ? null : millilitres / 1000;
      })(),
      engineHours: firstFinite(
        latest.status?.totalEngineHours,
        latest.status?.TotalEngineHours,
      ),
    });
  }

  const sumAvailable = (field) => {
    const values = matched.map((item) => item[field]).filter((value) => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const distanceKm = sumAvailable("distanceKm");
  const fuelLitres = sumAvailable("fuelLitres");
  const engineHours = sumAvailable("engineHours");
  const eventDates = [...new Set(matched.map((item) => item.shiftDate))].sort();
  const rows = matched.length ? [{
    shift: request.shift,
    site: request.siteMapping.fmsSite,
    vehicles: matched.length,
    fuelConsumedLitres: round(fuelLitres),
    distanceKm: round(distanceKm),
    runningHours: round(engineHours),
    idleHours: null,
    idlePercentage: null,
    efficiencyKmPerLitre:
      distanceKm !== null && fuelLitres !== null && fuelLitres > 0
        ? round(distanceKm / fuelLitres)
        : null,
    trips: null,
    productionM3: null,
    coverage: "Scania live cumulative snapshot",
  }] : [];

  return {
    reportType: "Shift-wise Fuel Report",
    source: "SCANIA_RFMS_LIVE",
    generatedAt,
    rows,
    period: {
      date: request.reportDate,
      shift: request.shift,
      site: request.siteMapping.fmsSite,
      start: request.startTime,
      end: request.stopTime,
      timezone: request.siteMapping.timezone,
    },
    meta: {
      apiVehicleCount: vehicles.length,
      apiStatusCount: statuses.length,
      latestStatusCount: latestStatuses.size,
      vehicleMasterCount: importedVehicles.length,
      matchedVehicleCount: matched.length,
      eventDates,
      emptyReason: matched.length
        ? null
        : `No latest Scania status snapshots matched ${request.siteMapping.fmsSite}, Shift ${request.shift}.`,
    },
  };
}

module.exports = {
  TIME_ZONE,
  buildScaniaShiftSummary,
  latestStatusesByVin,
  resolveShift,
};
