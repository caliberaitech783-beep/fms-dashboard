function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function difference(current, previous) {
  const currentNumber = finiteNumber(current);
  const previousNumber = finiteNumber(previous);
  if (currentNumber === null || previousNumber === null) return 0;
  return Math.max(0, currentNumber - previousNumber);
}

function statusTimestamp(status) {
  const value = eventCreatedTime(status) || eventReceivedTime(status);
  const timestamp = value ? new Date(value) : null;
  return timestamp && Number.isFinite(timestamp.getTime()) ? timestamp : null;
}

function driverIdentifier(status) {
  return driverIdFromEvent(status);
}

function classValues(status, key) {
  const accumulated = eventAccumulated(status) || {};
  const lowerKey = `${key[0].toLowerCase()}${key.slice(1)}`;
  const source = accumulated[key] ?? accumulated[lowerKey];
  const values = Array.isArray(source) ? source : source?.Value ?? source?.value;
  return Array.isArray(values) ? values : [];
}

function classSecondsDelta(current, previous, key) {
  const previousByRange = new Map(classValues(previous, key).map((item) => [
    `${item.From ?? item.from ?? ""}|${item.To ?? item.to ?? ""}`,
    item,
  ]));

  return classValues(current, key).map((item) => {
    const prior = previousByRange.get(`${item.From ?? item.from ?? ""}|${item.To ?? item.to ?? ""}`) || {};
    return {
      from: finiteNumber(item.From ?? item.from),
      to: finiteNumber(item.To ?? item.to),
      seconds: difference(item.Seconds ?? item.seconds, prior.Seconds ?? prior.seconds),
    };
  });
}

function formatHoursMinutes(seconds) {
  const roundedMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function resolveRecentReportDate(requestedDate, currentDate, maxHistoryDays = 13) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(requestedDate) || !datePattern.test(currentDate)) {
    throw Object.assign(new Error("A valid report date is required."), { statusCode: 400 });
  }

  const requestedTimestamp = Date.parse(`${requestedDate}T00:00:00.000Z`);
  const currentTimestamp = Date.parse(`${currentDate}T00:00:00.000Z`);
  const ageDays = Math.floor((currentTimestamp - requestedTimestamp) / 86_400_000);
  const allowedHistoryDays = Math.max(0, Number(maxHistoryDays) || 13);
  const fallbackApplied = ageDays < 0 || ageDays > allowedHistoryDays;

  return {
    date: fallbackApplied ? currentDate : requestedDate,
    requestedDate,
    fallbackApplied,
    ageDays,
  };
}

function parseDriverMap(value) {
  const source = String(value || "").trim();
  if (!source) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw Object.assign(new Error("VOLVO_RFMS_DRIVER_MAP_JSON must be valid JSON."), { statusCode: 503 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("VOLVO_RFMS_DRIVER_MAP_JSON must be a JSON object."), { statusCode: 503 });
  }
  return new Map(Object.entries(parsed).map(([key, name]) => [
    String(key).trim().toUpperCase(),
    String(name || "").trim(),
  ]).filter(([key, name]) => key && name));
}

function createAccumulator(vehicle, driverId, driverName) {
  return {
    vehicleNumber: vehicle.vehicleNumber,
    vin: vehicle.trackerId,
    driverId,
    driverName,
    site: vehicle.siteName || "Site assignment required",
    shift: null,
    totalTimeSeconds: 0,
    drivingKm: 0,
    engineHours: 0,
    fuelLitres: 0,
    standstillSeconds: 0,
    runningSeconds: 0,
    coastingSeconds: 0,
    engineLoadWeightedSeconds: 0,
    engineLoadSeconds: 0,
    intervalCount: 0,
  };
}

function addInterval(target, previous, current) {
  const accumulatedCurrent = eventAccumulated(current) || {};
  const accumulatedPrevious = eventAccumulated(previous) || {};
  const currentValue = (lower, upper) => accumulatedCurrent[lower] ?? accumulatedCurrent[upper];
  const previousValue = (lower, upper) => accumulatedPrevious[lower] ?? accumulatedPrevious[upper];
  const runningSeconds = difference(
    currentValue("durationWheelbaseSpeedOverZero", "DurationWheelbaseSpeedOverZero"),
    previousValue("durationWheelbaseSpeedOverZero", "DurationWheelbaseSpeedOverZero"),
  );
  const standstillSeconds = difference(
    currentValue("durationWheelbaseSpeedZero", "DurationWheelbaseSpeedZero"),
    previousValue("durationWheelbaseSpeedZero", "DurationWheelbaseSpeedZero"),
  );
  const coastingClass = classSecondsDelta(current, previous, "DrivingWithoutTorqueClass");
  const engineLoadClass = classSecondsDelta(current, previous, "EngineTorqueClass");

  target.drivingKm += difference(
    current.HRTotalVehicleDistance ?? current.hrTotalVehicleDistance,
    previous.HRTotalVehicleDistance ?? previous.hrTotalVehicleDistance,
  ) / 1000;
  target.engineHours += difference(
    current.TotalEngineHours ?? current.totalEngineHours,
    previous.TotalEngineHours ?? previous.totalEngineHours,
  );
  target.fuelLitres += difference(
    current.EngineTotalFuelUsed ?? current.engineTotalFuelUsed,
    previous.EngineTotalFuelUsed ?? previous.engineTotalFuelUsed,
  ) / 1000;
  target.runningSeconds += runningSeconds;
  target.standstillSeconds += standstillSeconds;
  target.totalTimeSeconds += runningSeconds + standstillSeconds;
  target.coastingSeconds += coastingClass.reduce((sum, item) => sum + item.seconds, 0);

  for (const item of engineLoadClass) {
    if (item.seconds <= 0) continue;
    const midpoint = item.from === null
      ? item.to
      : item.to === null
        ? item.from
        : (item.from + item.to) / 2;
    if (midpoint === null) continue;
    target.engineLoadWeightedSeconds += midpoint * item.seconds;
    target.engineLoadSeconds += item.seconds;
  }
  target.intervalCount += 1;
}

function finalizeRow(value, shiftName, shiftDurationHours) {
  const standstillPercent = value.totalTimeSeconds > 0
    ? value.standstillSeconds / value.totalTimeSeconds * 100
    : null;
  const engineOnPercent = shiftDurationHours > 0
    ? value.engineHours / shiftDurationHours * 100
    : null;
  const efficiency = value.fuelLitres > 0 ? value.drivingKm / value.fuelLitres : null;
  const averageFuelRate = value.engineHours > 0 ? value.fuelLitres / value.engineHours : null;
  const engineLoadPercent = value.engineLoadSeconds > 0
    ? value.engineLoadWeightedSeconds / value.engineLoadSeconds
    : null;
  const coastingPercent = value.runningSeconds > 0
    ? value.coastingSeconds / value.runningSeconds * 100
    : null;

  return {
    vehicle: value.vehicleNumber,
    driverId: value.driverId,
    driver: value.driverName,
    totalTime: formatHoursMinutes(value.totalTimeSeconds),
    drivingKm: round(value.drivingKm),
    dieselEngineOnPercent: round(engineOnPercent),
    averageDieselEngineKmPerLitre: round(efficiency),
    fuelLitres: round(value.fuelLitres),
    standstillPercent: round(standstillPercent),
    standstillTime: formatHoursMinutes(value.standstillSeconds),
    iShiftPerformanceTimePercent: null,
    aboveEconomyPercent: null,
    engineLoadPercent: round(engineLoadPercent),
    coastingPercent: round(coastingPercent),
    averageDieselLitresPerHour: round(averageFuelRate),
    site: value.site,
    shift: `Shift ${shiftName}`,
    dataIntervals: value.intervalCount,
  };
}

function buildDriverStandstillRows(options) {
  const shiftStart = new Date(options.shiftStart);
  const shiftEnd = new Date(options.shiftEnd);
  const effectiveEnd = new Date(Math.min(shiftEnd.getTime(), options.now?.getTime?.() || Date.now()));
  const shiftDurationHours = Math.max(0, (effectiveEnd - shiftStart) / 3_600_000);
  const vehicleByVin = new Map(options.vehicles.map((vehicle) => [vehicle.trackerId, vehicle]));
  const statusesByVin = new Map();

  for (const status of options.statuses) {
    const vin = eventVin(status);
    const timestamp = statusTimestamp(status);
    if (!vin || !timestamp || !vehicleByVin.has(vin)) continue;
    const list = statusesByVin.get(vin) || [];
    list.push(status);
    statusesByVin.set(vin, list);
  }

  const accumulators = new Map();
  for (const [vin, statuses] of statusesByVin) {
    const vehicle = vehicleByVin.get(vin);
    const ordered = statuses.sort((left, right) => statusTimestamp(left) - statusTimestamp(right));
    let previous = ordered.filter((status) => statusTimestamp(status) <= shiftStart).at(-1) || null;

    for (const current of ordered) {
      const currentTime = statusTimestamp(current);
      if (!currentTime || currentTime <= shiftStart) continue;
      if (currentTime > effectiveEnd) break;
      if (!previous) {
        previous = current;
        continue;
      }

      const id = driverIdentifier(current) || driverIdentifier(previous);
      const driverKey = String(id || "UNKNOWN").toUpperCase();
      const key = `${vin}|${driverKey}`;
      const driverName = options.driverMap.get(driverKey) || (id ? `Driver ${maskDriverId(id)}` : "Unknown");
      const accumulator = accumulators.get(key) || createAccumulator(vehicle, id, driverName);
      addInterval(accumulator, previous, current);
      accumulators.set(key, accumulator);
      previous = current;
    }
  }

  return [...accumulators.values()]
    .filter((row) => row.intervalCount > 0 && row.totalTimeSeconds > 0)
    .map((row) => finalizeRow(row, options.shiftName, shiftDurationHours))
    .sort((left, right) => (
      (right.standstillPercent || 0) - (left.standstillPercent || 0)
      || left.vehicle.localeCompare(right.vehicle, undefined, { numeric: true })
    ));
}

async function fetchVehicleScopedHistory(client, vehicles, options = {}) {
  const vins = [...new Set(vehicles
    .map((vehicle) => String(vehicle?.trackerId || "").trim())
    .filter(Boolean))];
  if (!vins.length) return [];

  const requestedConcurrency = Number(options.concurrency || 1);
  const concurrency = Math.min(vins.length, Math.max(1, requestedConcurrency));
  const requestDelayMs = Math.max(0, Number(options.requestDelayMs || 0));
  const eventBatches = new Array(vins.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < vins.length) {
      const index = nextIndex;
      nextIndex += 1;
      eventBatches[index] = await client.fetchHistoricalVehicleStatuses({
        startTime: options.startTime,
        stopTime: options.stopTime,
        contentFilter: options.contentFilter,
        maxPages: options.maxPages,
        vin: vins[index],
      });
      if (requestDelayMs > 0 && nextIndex < vins.length) {
        await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return deduplicateEvents(eventBatches.flat());
}

module.exports = {
  buildDriverStandstillRows,
  driverIdentifier,
  fetchVehicleScopedHistory,
  parseDriverMap,
  resolveRecentReportDate,
};
const {
  deduplicateEvents,
  driverIdFromEvent,
  eventAccumulated,
  eventCreatedTime,
  eventReceivedTime,
  eventVin,
  maskDriverId,
} = require("./vehicleStatusNormalizer");
