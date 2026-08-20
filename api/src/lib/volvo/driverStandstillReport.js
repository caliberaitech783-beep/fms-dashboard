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

function classIdentity(item, index) {
  const from = item.From ?? item.from ?? "";
  const to = item.To ?? item.to ?? "";
  const label = item.Label ?? item.label ?? "";
  return from !== "" || to !== "" || label !== ""
    ? `${from}|${to}|${label}`
    : `index:${index}`;
}

function classSecondsDelta(current, previous, key) {
  const previousByRange = new Map(classValues(previous, key).map((item, index) => [
    classIdentity(item, index),
    item,
  ]));

  return classValues(current, key).map((item, index) => {
    const prior = previousByRange.get(classIdentity(item, index)) || {};
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
    driverIds: new Set(driverId ? [String(driverId)] : []),
    driverNames: new Set(driverName ? [driverName] : []),
    site: vehicle.siteName || "Site assignment required",
    shift: null,
    totalTimeSeconds: 0,
    drivingKm: 0,
    engineHours: 0,
    fuelLitres: 0,
    standstillSeconds: 0,
    runningSeconds: 0,
    coastingSeconds: 0,
    highEngineLoadSeconds: 0,
    engineLoadWeightedSeconds: 0,
    engineLoadSeconds: 0,
    intervalCount: 0,
  };
}

function addInterval(target, previous, current, intervalProportion = 1) {
  const accumulatedCurrent = eventAccumulated(current) || {};
  const accumulatedPrevious = eventAccumulated(previous) || {};
  const currentValue = (...keys) => keys
    .map((key) => accumulatedCurrent[key])
    .find((value) => value !== undefined && value !== null);
  const previousValue = (...keys) => keys
    .map((key) => accumulatedPrevious[key])
    .find((value) => value !== undefined && value !== null);
  const runningSeconds = difference(
    currentValue(
      "durationWheelbaseSpeedOverZero",
      "DurationWheelbaseSpeedOverZero",
      "durationWheelbasedSpeedOverZero",
      "DurationWheelbasedSpeedOverZero",
    ),
    previousValue(
      "durationWheelbaseSpeedOverZero",
      "DurationWheelbaseSpeedOverZero",
      "durationWheelbasedSpeedOverZero",
      "DurationWheelbasedSpeedOverZero",
    ),
  );
  const standstillSeconds = difference(
    currentValue(
      "durationWheelbaseSpeedZero",
      "DurationWheelbaseSpeedZero",
      "durationWheelbasedSpeedZero",
      "DurationWheelbasedSpeedZero",
    ),
    previousValue(
      "durationWheelbaseSpeedZero",
      "DurationWheelbaseSpeedZero",
      "durationWheelbasedSpeedZero",
      "DurationWheelbasedSpeedZero",
    ),
  );
  const coastingClass = classSecondsDelta(current, previous, "DrivingWithoutTorqueClass");
  const engineLoadClass = classSecondsDelta(current, previous, "EngineTorqueClass");

  target.drivingKm += difference(
    current.HRTotalVehicleDistance ?? current.hrTotalVehicleDistance,
    previous.HRTotalVehicleDistance ?? previous.hrTotalVehicleDistance,
  ) / 1000 * intervalProportion;
  target.engineHours += difference(
    current.TotalEngineHours ?? current.totalEngineHours,
    previous.TotalEngineHours ?? previous.totalEngineHours,
  ) * intervalProportion;
  target.fuelLitres += difference(
    current.EngineTotalFuelUsed ?? current.engineTotalFuelUsed,
    previous.EngineTotalFuelUsed ?? previous.engineTotalFuelUsed,
  ) / 1000 * intervalProportion;
  target.runningSeconds += runningSeconds * intervalProportion;
  target.standstillSeconds += standstillSeconds * intervalProportion;
  target.totalTimeSeconds += (runningSeconds + standstillSeconds) * intervalProportion;
  target.coastingSeconds += coastingClass.reduce((sum, item) => sum + item.seconds, 0)
    * intervalProportion;

  for (const item of engineLoadClass) {
    if (item.seconds <= 0) continue;
    const midpoint = item.from === null
      ? item.to
      : item.to === null
        ? item.from
        : (item.from + item.to) / 2;
    if (midpoint !== null) {
      target.engineLoadWeightedSeconds += midpoint * item.seconds * intervalProportion;
      target.engineLoadSeconds += item.seconds * intervalProportion;
    }
    // Volvo Connect defines engine load as time above 90% of maximum torque.
    if (item.from !== null && item.from >= 90) {
      target.highEngineLoadSeconds += item.seconds * intervalProportion;
    }
  }
  target.intervalCount += 1;
}

function finalizeRow(value, shiftName, shiftDurationHours, metricProfile) {
  const managerAlignedMetrics = metricProfile === "volvo-manager";
  const engineRunningSeconds = managerAlignedMetrics && value.engineHours > 0
    ? value.engineHours * 3600
    : value.totalTimeSeconds;
  const standstillPercent = engineRunningSeconds > 0
    ? value.standstillSeconds / engineRunningSeconds * 100
    : null;
  const engineOnPercent = shiftDurationHours > 0
    ? value.engineHours / shiftDurationHours * 100
    : null;
  const efficiency = value.fuelLitres > 0 ? value.drivingKm / value.fuelLitres : null;
  const averageFuelRate = value.engineHours > 0 ? value.fuelLitres / value.engineHours : null;
  const engineLoadPercent = managerAlignedMetrics
    ? engineRunningSeconds > 0
      ? value.highEngineLoadSeconds / engineRunningSeconds * 100
      : null
    : value.engineLoadSeconds > 0
      ? value.engineLoadWeightedSeconds / value.engineLoadSeconds
      : null;
  const coastingDenominator = managerAlignedMetrics ? engineRunningSeconds : value.runningSeconds;
  const coastingPercent = coastingDenominator > 0
    ? value.coastingSeconds / coastingDenominator * 100
    : null;
  const knownDriverNames = [...value.driverNames].filter((name) => name !== "Unknown");
  const driverNames = knownDriverNames.length ? knownDriverNames : [...value.driverNames];
  const driverIds = [...value.driverIds];

  return {
    vehicle: value.vehicleNumber,
    vin: value.vin,
    driverId: driverIds.length ? driverIds.join(", ") : value.driverId,
    driver: driverNames.length ? driverNames.join(", ") : value.driverName,
    totalTime: formatHoursMinutes(engineRunningSeconds),
    drivingKm: round(value.drivingKm),
    dieselEngineOnPercent: round(engineOnPercent),
    dieselEngineOnLitres: round(value.fuelLitres),
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
  const managerAlignedMetrics = options.metricProfile === "volvo-manager";
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
      if (!currentTime) continue;
      if (currentTime <= shiftStart) {
        previous = current;
        continue;
      }
      if (!previous) {
        previous = current;
        continue;
      }

      if (!managerAlignedMetrics && currentTime > effectiveEnd) break;

      const previousTime = statusTimestamp(previous);
      if (!previousTime || previousTime >= effectiveEnd) break;
      let intervalProportion = 1;
      if (managerAlignedMetrics) {
        // RFMS counters cover the entire interval between events. Prorate an
        // interval that straddles either shift edge instead of counting it all.
        const intervalMilliseconds = currentTime.getTime() - previousTime.getTime();
        const overlapStart = Math.max(previousTime.getTime(), shiftStart.getTime());
        const overlapEnd = Math.min(currentTime.getTime(), effectiveEnd.getTime());
        const overlapMilliseconds = Math.max(0, overlapEnd - overlapStart);
        if (intervalMilliseconds <= 0 || overlapMilliseconds <= 0) {
          previous = current;
          if (currentTime >= effectiveEnd) break;
          continue;
        }
        intervalProportion = overlapMilliseconds / intervalMilliseconds;
      }

      const id = driverIdentifier(current) || driverIdentifier(previous);
      const driverKey = String(id || "UNKNOWN").toUpperCase();
      const key = options.groupByVehicle ? vin : `${vin}|${driverKey}`;
      const driverName = options.driverMap.get(driverKey) || (id ? `Driver ${maskDriverId(id)}` : "Unknown");
      const accumulator = accumulators.get(key) || createAccumulator(vehicle, id, driverName);
      if (id) accumulator.driverIds.add(String(id));
      if (driverName) accumulator.driverNames.add(driverName);
      addInterval(accumulator, previous, current, intervalProportion);
      accumulators.set(key, accumulator);
      previous = current;
      if (currentTime >= effectiveEnd) break;
    }
  }

  return [...accumulators.values()]
    .filter((row) => row.intervalCount > 0 && (
      managerAlignedMetrics ? row.engineHours > 0 || row.totalTimeSeconds > 0 : row.totalTimeSeconds > 0
    ))
    .map((row) => finalizeRow(row, options.shiftName, shiftDurationHours, options.metricProfile))
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
  const retryAttempts = Math.max(1, Number(options.retryAttempts || 1));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 0));
  const eventBatches = new Array(vins.length);
  let nextIndex = 0;

  async function fetchVin(vin) {
    let lastError;
    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
      try {
        return await client.fetchHistoricalVehicleStatuses({
          startTime: options.startTime,
          stopTime: options.stopTime,
          contentFilter: options.contentFilter,
          maxPages: options.maxPages,
          vin,
        });
      } catch (error) {
        lastError = error;
        if (attempt < retryAttempts && retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    throw lastError;
  }

  async function worker() {
    while (nextIndex < vins.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        eventBatches[index] = await fetchVin(vins[index]);
      } catch (error) {
        if (!options.continueOnError) throw error;
        eventBatches[index] = [];
      }
      if (requestDelayMs > 0 && nextIndex < vins.length) {
        await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return deduplicateEvents(eventBatches.flat());
}

async function fetchFleetHistory(client, vehicles, options = {}) {
  try {
    return await client.fetchHistoricalVehicleStatuses({
      startTime: options.startTime,
      stopTime: options.stopTime,
      contentFilter: options.contentFilter,
      maxPages: options.maxPages,
    });
  } catch (error) {
    if (options.fallbackToVehicleRequests === false) throw error;
    return fetchVehicleScopedHistory(client, vehicles, options);
  }
}

async function fetchReportHistory(client, vehicles, options = {}) {
  const vehicleRequestThreshold = Math.max(0, Number(options.vehicleRequestThreshold ?? 20));
  if (vehicles.length <= vehicleRequestThreshold) {
    return fetchVehicleScopedHistory(client, vehicles, options);
  }
  return fetchFleetHistory(client, vehicles, {
    ...options,
    fallbackToVehicleRequests: true,
  });
}

function reportHistoryRange(reportWindow, now = new Date()) {
  const shiftStart = new Date(reportWindow?.shiftStart);
  const shiftEnd = new Date(reportWindow?.shiftEnd);
  const currentTime = now instanceof Date ? now : new Date(now);
  if (![shiftStart, shiftEnd, currentTime].every((value) => Number.isFinite(value.getTime()))) {
    return null;
  }
  const start = new Date(shiftStart.getTime() - 60 * 60_000);
  const stop = new Date(Math.min(
    shiftEnd.getTime() + 5 * 60_000,
    currentTime.getTime() + 5 * 60_000,
  ));
  if (stop <= start) return null;
  return { startTime: start.toISOString(), stopTime: stop.toISOString() };
}

function reportHistoryStrategy(siteName, options = {}) {
  const configuredConcurrency = Math.max(1, Number(options.concurrency || 6));
  const configuredThreshold = Math.max(0, Number(options.vehicleRequestThreshold ?? 20));
  const normalizedSite = String(siteName || "").trim().toLowerCase();
  if (!normalizedSite.includes("majri")) {
    return {
      concurrency: configuredConcurrency,
      vehicleRequestThreshold: configuredThreshold,
    };
  }
  const configuredMajriConcurrency = Number(options.majriConcurrency ?? 12);
  const majriConcurrency = Number.isFinite(configuredMajriConcurrency)
    ? Math.max(1, configuredMajriConcurrency)
    : 12;
  return {
    concurrency: Math.max(configuredConcurrency, majriConcurrency),
    vehicleRequestThreshold: Number.MAX_SAFE_INTEGER,
  };
}

async function fetchReportHistoryCandidates(client, vehicles, options = {}) {
  const {
    buildRows,
    candidates = [],
    now = new Date(),
    ...historyOptions
  } = options;
  if (typeof buildRows !== "function") {
    throw new TypeError("A report row builder is required.");
  }

  let result = { statuses: [], rows: [], candidate: null, candidateIndex: -1 };
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    const range = reportHistoryRange(candidate?.window, now);
    if (!range) continue;
    const statuses = await fetchReportHistory(client, vehicles, {
      ...historyOptions,
      ...range,
    });
    const rows = buildRows(statuses, candidate.window);
    result = { statuses, rows, candidate, candidateIndex };
    if (rows.length) return result;
  }
  return result;
}

module.exports = {
  buildDriverStandstillRows,
  driverIdentifier,
  fetchFleetHistory,
  fetchReportHistory,
  fetchReportHistoryCandidates,
  fetchVehicleScopedHistory,
  parseDriverMap,
  reportHistoryRange,
  reportHistoryStrategy,
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
