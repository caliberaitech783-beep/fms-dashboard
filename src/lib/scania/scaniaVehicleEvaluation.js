const {
  ScaniaApiError,
  createScaniaClientFromEnv,
} = require("./scaniaClient");
const defaultSessionStore = require("./scaniaSessionStore");
const {
  normalizeKey,
  resolveImportedSite,
} = require("../vehicles/vehicleMasterIntegration");

const SITE_MAPPINGS = {
  "Sasti OCM": {
    fmsSite: "Sasti OCM",
    fmsSiteId: "site-wcl-sasti-ocm",
    scaniaSite: "Sasti OCM",
    timezone: "Asia/Kolkata",
    scaniaTimezone: "(UTC+05:30) India Standard Time (Kolkata)",
    utcOffset: "+05:30",
  },
  "DCH West": {
    fmsSite: "DCH West",
    fmsSiteId: "site-ncl-dch-west",
    scaniaSite: "Dudhichua Singrauli",
    timezone: "Asia/Kolkata",
    scaniaTimezone: "(UTC+05:30) India Standard Time (Kolkata)",
    utcOffset: "+05:30",
  },
  "DCH East": {
    fmsSite: "DCH East",
    fmsSiteId: "site-ncl-dch-east",
    scaniaSite: "Dudhichua Singrauli",
    timezone: "Asia/Kolkata",
    scaniaTimezone: "(UTC+05:30) India Standard Time (Kolkata)",
    utcOffset: "+05:30",
  },
};

const SHIFT_MAPPINGS = {
  A: {
    code: "A",
    start: "05:00",
    stop: "13:00",
    stopDayOffset: 0,
  },
  B: {
    code: "B",
    start: "13:00",
    stop: "21:00",
    stopDayOffset: 0,
  },
  C: {
    code: "C",
    start: "21:00",
    stop: "05:00",
    stopDayOffset: 1,
  },
};

const MINIMUM_ENGINE_MINUTES = 30;

function round(value, decimals = 2) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function averageFuelConsumptionLitresPer100KmToKmPerLitre(value) {
  const litresPer100Km = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(litresPer100Km) || litresPer100Km <= 0) return null;
  return round(100 / litresPer100Km, 2);
}

function durationParts(value) {
  const match = String(value || "").trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (minutes > 59 || seconds > 59) return null;
  return { hours, minutes, seconds };
}

function durationMinutes(value) {
  const parts = durationParts(value);
  if (!parts) return null;
  return parts.hours * 60 + parts.minutes + parts.seconds / 60;
}

function normalizeDurationHhMm(value) {
  const parts = durationParts(value);
  if (!parts) return null;
  return `${parts.hours}:${String(parts.minutes).padStart(2, "0")}`;
}

function normalizeRegistration(value) {
  return String(value || "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function localScaniaDateTimeToIso(value) {
  const match = String(value || "").trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || "00"}+05:30`;
}

function formatReportQueryTimestamp(value, timezone = "Asia/Kolkata") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ScaniaApiError("Report startTime and stopTime must be valid ISO timestamps.", {
      kind: "validation",
      statusCode: 400,
    });
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

function arrayOf(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? [value] : [];
}

function driverAssignmentsFromPayload(payload) {
  const assignments = new Map();
  const drivers = arrayOf(
    payload?.Drivers
    || payload?.EvaluationDriversWithIdentification?.Drivers?.EvaluationDriverWithIdentification
    || payload?.EvaluationDriversWithIdentification?.Drivers
    || payload?.EvaluationDrivers?.Drivers?.EvaluationDriver
    || payload?.EvaluationDrivers?.Drivers,
  );
  for (const driver of drivers) {
    const name = String(driver?.DriverName || "").trim();
    const reference = String(
      driver?.DriverIdentification
      || driver?.DriverRef
      || "",
    ).trim();
    const maskedReference = reference
      ? `Driver ****${reference.slice(-4)}`
      : "Unknown";
    const assignment = {
      driverName: name || maskedReference,
      driverReference: reference || null,
    };
    for (const vehicle of arrayOf(driver?.Vehicles)) {
      const keys = [
        vehicle?.Vin,
        vehicle?.LicensePlate,
        normalizeRegistration(vehicle?.CustomerVehicleName),
      ].map(normalizeKey).filter(Boolean);
      for (const key of keys) assignments.set(key, assignment);
    }
  }
  return assignments;
}

function formatReportQueryDate(value, timezone = "Asia/Kolkata") {
  const date = localDateInTimezone(value, timezone);
  if (!date) {
    throw new ScaniaApiError("Report startTime must be a valid ISO timestamp.", {
      kind: "validation",
      statusCode: 400,
    });
  }
  return date;
}

function localDateInTimezone(value, timezone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addCalendarDays(dateText, days) {
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
  ));
  return date.toISOString().slice(0, 10);
}

function canonicalShiftWindow(dateText, shiftMapping, utcOffset = "+05:30") {
  const stopDate = addCalendarDays(dateText, shiftMapping.stopDayOffset || 0);
  if (!stopDate) {
    throw new ScaniaApiError("The report date is invalid.", {
      kind: "validation",
      statusCode: 400,
    });
  }
  return {
    startTime: `${dateText}T${shiftMapping.start}:00${utcOffset}`,
    stopTime: `${stopDate}T${shiftMapping.stop}:00${utcOffset}`,
  };
}

function validateReportInput(input) {
  if (!input || typeof input !== "object") {
    throw new ScaniaApiError("A Scania report request body is required.", {
      kind: "validation",
      statusCode: 400,
    });
  }
  const site = String(input.site || "").trim();
  const shift = String(input.shift || "").trim().toUpperCase();
  const siteMapping = SITE_MAPPINGS[site];
  const shiftMapping = SHIFT_MAPPINGS[shift];
  if (!siteMapping) {
    throw new ScaniaApiError(
      `Scania site mapping is not configured for '${site || "blank"}'.`,
      { kind: "mapping", statusCode: 422 },
    );
  }
  if (!shiftMapping) {
    throw new ScaniaApiError(
      `Scania shift mapping is not configured for '${shift || "blank"}'.`,
      { kind: "mapping", statusCode: 422 },
    );
  }
  const startTime = String(input.startTime || "").trim();
  const stopTime = String(input.stopTime || "").trim();
  const start = new Date(startTime);
  const stop = new Date(stopTime);
  if (!startTime || !stopTime || !Number.isFinite(start.getTime()) || !Number.isFinite(stop.getTime())) {
    throw new ScaniaApiError("startTime and stopTime must be valid ISO timestamps.", {
      kind: "validation",
      statusCode: 400,
    });
  }
  if (stop <= start) {
    throw new ScaniaApiError("stopTime must be later than startTime.", {
      kind: "validation",
      statusCode: 400,
    });
  }
  const reportDate = localDateInTimezone(startTime, siteMapping.timezone);
  const canonicalWindow = canonicalShiftWindow(
    reportDate,
    shiftMapping,
    siteMapping.utcOffset,
  );
  return {
    site,
    shift,
    startTime: canonicalWindow.startTime,
    stopTime: canonicalWindow.stopTime,
    requestedStartTime: startTime,
    requestedStopTime: stopTime,
    reportDate,
    siteMapping,
    shiftMapping,
  };
}

function reportRowsFromPayload(payload) {
  const wrappedGasList = payload?.EvaluationVehiclesWithGasConsumption?.VehicleList;
  const wrappedStandardList = payload?.EvaluationVehicles?.VehicleList;
  const gas = wrappedGasList?.EvaluationVehicleWithGasConsumption
    || (Array.isArray(wrappedGasList) ? wrappedGasList : null);
  const standard = wrappedStandardList?.EvaluationVehicle
    || (Array.isArray(wrappedStandardList) ? wrappedStandardList : null)
    || payload?.VehicleList;
  const rows = Array.isArray(gas)
    ? gas
    : gas && typeof gas === "object"
      ? [gas]
      : Array.isArray(standard)
        ? standard
        : standard && typeof standard === "object"
          ? [standard]
          : [];
  return {
    rows,
    source: gas ? "vehicle-evaluation-with-gas-consumption" : standard ? "vehicle-evaluation" : null,
    evaluation: payload?.EvaluationVehiclesWithGasConsumption
      || payload?.EvaluationVehicles
      || (payload?.VehicleList ? payload : null)
      || null,
  };
}

function extractSessionId(payload) {
  return payload?.SessionId
    || payload?.sessionId
    || payload?.VehicleEvaluationRequestResponse?.SessionId
    || payload?.vehicleEvaluationRequestResponse?.sessionId
    || payload?.DriverEvaluationRequestResponse?.SessionId
    || payload?.driverEvaluationRequestResponse?.sessionId
    || null;
}

function extractPollingStatus(payload) {
  return String(
    payload?.status
    || payload?.Status
    || payload?.reportStatus
    || payload?.ReportStatus
    || "pending",
  ).trim().toLowerCase();
}

function maskSessionId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (normalized.length <= 8) return "[masked]";
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function masterSite(record) {
  if (record?.siteId || record?.siteName) {
    return {
      id: record.siteId || null,
      name: record.siteName || null,
    };
  }
  const resolved = resolveImportedSite(record?.rawSiteName);
  return {
    id: resolved?.id || null,
    name: resolved?.name || null,
  };
}

function masterLookup(importedVehicles) {
  const byVin = new Map();
  const byRegistration = new Map();
  for (const vehicle of importedVehicles || []) {
    const vin = normalizeKey(vehicle?.vin);
    const registration = normalizeKey(vehicle?.vehicleNumber);
    if (vin) byVin.set(vin, vehicle);
    if (registration) byRegistration.set(registration, vehicle);
  }
  return { byVin, byRegistration };
}

function findMaster(row, lookup) {
  return lookup.byVin.get(normalizeKey(row?.Vin))
    || lookup.byRegistration.get(normalizeKey(row?.LicensePlate))
    || lookup.byRegistration.get(normalizeKey(normalizeRegistration(row?.CustomerVehicleName)))
    || null;
}

function masterMatchesSite(master, mapping) {
  const site = masterSite(master);
  if (site.id) return site.id === mapping.fmsSiteId;
  const candidates = [
    site.name,
    master?.rawSiteName,
  ].map(normalizeKey);
  return candidates.some((candidate) => (
    candidate === normalizeKey(mapping.fmsSite)
    || candidate.includes(normalizeKey(mapping.scaniaSite))
  ));
}

function normalizeScaniaReportRow(row, master, fallbackStopTime, driverAssignment = null) {
  const registrationNumber = normalizeRegistration(
    master?.vehicleNumber
    || row?.LicensePlate
    || row?.CustomerVehicleName
    || row?.ChassisNumber,
  );
  const vin = String(master?.vin || row?.Vin || "").trim().toUpperCase();
  return {
    registrationNumber,
    vin,
    driverName: driverAssignment?.driverName || "Unknown",
    driverReference: driverAssignment?.driverReference || null,
    engineRunningTime: normalizeDurationHhMm(row?.EngineRunningTime),
    distanceDrivenKm: round(row?.Distance, 2),
    fuelEconomyKmPerLitre:
      averageFuelConsumptionLitresPer100KmToKmPerLitre(row?.AverageFuelConsumption),
    fuelConsumedLitres: round(row?.TotalFuelConsumption, 2),
    fuelConsumptionLitresPerHour: round(row?.FuelConsumptionPerHour, 2),
    idlingPercentage: round(row?.IdlingValue, 2),
    idlingTime: normalizeDurationHhMm(row?.EngineRuntimeIdle),
    performanceModePowerKm: round(row?.TotalDistanceWithPerformanceModePower, 2),
    performanceModePowerPercentage: round(row?.PerformanceModePowerPercentage, 2),
    powertrainCoastingPercentage: round(row?.CoastingValue, 2),
    lastUpdatedAt: localScaniaDateTimeToIso(row?.StopDate) || fallbackStopTime,
  };
}

function filterAndNormalizeRows(rawRows, importedVehicles, request, driverAssignments = new Map()) {
  const lookup = masterLookup(importedVehicles);
  const siteMasters = (importedVehicles || []).filter((master) => (
    masterMatchesSite(master, request.siteMapping)
  ));
  if (!importedVehicles?.length || !siteMasters.length) {
    throw new ScaniaApiError(
      `No vehicle-master mapping exists for ${request.siteMapping.fmsSite} / ${request.siteMapping.scaniaSite}.`,
      { kind: "mapping", statusCode: 422 },
    );
  }

  const filterCounts = {
    missingVehicleMaster: 0,
    differentSite: 0,
    engineRunningTimeUnder30Minutes: 0,
    duplicateVehicle: 0,
  };
  const normalizedRows = [];
  const seenVehicles = new Set();

  for (const rawRow of rawRows) {
    const master = findMaster(rawRow, lookup);
    if (!master) {
      filterCounts.missingVehicleMaster += 1;
      continue;
    }
    if (!masterMatchesSite(master, request.siteMapping)) {
      filterCounts.differentSite += 1;
      continue;
    }
    const engineMinutes = durationMinutes(rawRow?.EngineRunningTime);
    if (engineMinutes === null || engineMinutes < MINIMUM_ENGINE_MINUTES) {
      filterCounts.engineRunningTimeUnder30Minutes += 1;
      continue;
    }
    const driverAssignment = driverAssignments.get(normalizeKey(rawRow?.Vin))
      || driverAssignments.get(normalizeKey(rawRow?.LicensePlate))
      || driverAssignments.get(normalizeKey(normalizeRegistration(rawRow?.CustomerVehicleName)))
      || null;
    const normalized = normalizeScaniaReportRow(
      rawRow,
      master,
      request.stopTime,
      driverAssignment,
    );
    const vehicleKey = normalizeKey(normalized.vin || normalized.registrationNumber);
    if (!vehicleKey) {
      filterCounts.missingVehicleMaster += 1;
      continue;
    }
    if (seenVehicles.has(vehicleKey)) {
      filterCounts.duplicateVehicle += 1;
      continue;
    }
    seenVehicles.add(vehicleKey);
    normalizedRows.push(normalized);
  }

  normalizedRows.sort((left, right) => (
    left.registrationNumber.localeCompare(
      right.registrationNumber,
      undefined,
      { numeric: true },
    )
  ));

  return {
    rows: normalizedRows,
    filterCounts,
    siteMasterCount: siteMasters.length,
  };
}

function unavailableFields(rows) {
  const optionalFields = [
    "performanceModePowerKm",
    "performanceModePowerPercentage",
    "powertrainCoastingPercentage",
  ];
  return optionalFields.filter((field) => (
    rows.length > 0 && rows.every((row) => row[field] === null)
  ));
}

async function pollCompletedReport(initialResult, request, dependencies) {
  const {
    client,
    logger,
    sessionStore,
    sleepFn,
    pollingIntervalMs,
    pollingTimeoutMs,
    nowFn,
  } = dependencies;
  const initialPayload = initialResult.payload;
  const initialRows = reportRowsFromPayload(initialPayload);
  if (initialRows.rows.length) return { ...initialResult, ...initialRows, sessionId: null };

  const sessionId = extractSessionId(initialPayload);
  if (!sessionId) return { ...initialResult, ...initialRows, sessionId: null };

  await sessionStore.saveSession({
    sessionId,
    status: "pending",
    selectedSite: request.site,
    shift: request.shift,
    startTime: request.startTime,
    stopTime: request.stopTime,
    timezone: request.siteMapping.timezone,
  });
  logger("report_session", {
    sessionId: maskSessionId(sessionId),
    pollingStatus: "stored",
  });

  const deadline = nowFn() + pollingTimeoutMs;
  let attempt = 0;
  while (nowFn() < deadline) {
    attempt += 1;
    await sleepFn(pollingIntervalMs);
    const result = await client.getVehicleEvaluationResult(sessionId);
    const parsed = reportRowsFromPayload(result.payload);
    const status = extractPollingStatus(result.payload);
    logger("polling_status", {
      sessionId: maskSessionId(sessionId),
      pollingStatus: status,
      attempt,
      apiRecordCount: parsed.rows.length,
    });
    if (["failed", "error", "cancelled"].includes(status)) {
      await sessionStore.updateSession(sessionId, {
        status: "failed",
        errorMessage: "Scania report generation failed.",
      });
      throw new ScaniaApiError("Scania report generation failed.", {
        kind: "upstream",
        statusCode: 502,
        endpoint: result.endpoint,
        httpStatus: result.status,
      });
    }
    if (
      parsed.rows.length
      || ["complete", "completed", "done", "ready", "success"].includes(status)
    ) {
      await sessionStore.updateSession(sessionId, { status: "completed" });
      return { ...result, ...parsed, sessionId };
    }
  }

  await sessionStore.updateSession(sessionId, {
    status: "timeout",
    errorMessage: "Scania report generation timed out.",
  });
  throw new ScaniaApiError("Scania report generation timed out.", {
    kind: "timeout",
    statusCode: 504,
    endpoint: initialResult.endpoint,
    httpStatus: initialResult.status,
  });
}

async function generateVehicleEvaluationReport(input, options = {}) {
  const request = validateReportInput(input);
  const logger = options.logger || (() => {});
  const client = options.client || createScaniaClientFromEnv({
    onEvent: (event, details) => logger(event, details),
  });
  const sessionStore = options.sessionStore || defaultSessionStore;
  const importedVehicles = options.importedVehicles || [];
  const sleepFn = options.sleepFn || ((milliseconds) => (
    new Promise((resolve) => setTimeout(resolve, milliseconds))
  ));
  const nowFn = options.nowFn || Date.now;
  const pollingIntervalMs = Number(
    options.pollingIntervalMs
    || process.env.SCANIA_REPORT_POLL_INTERVAL_MS
    || 2_000,
  );
  const pollingTimeoutMs = Number(
    options.pollingTimeoutMs
    || process.env.SCANIA_REPORT_POLL_TIMEOUT_MS
    || 60_000,
  );

  logger("report_request", {
    selectedSite: request.site,
    scaniaSite: request.siteMapping.scaniaSite,
    selectedShift: request.shift,
    requestedStartTime: request.requestedStartTime,
    requestedStopTime: request.requestedStopTime,
    effectiveStartTime: request.startTime,
    effectiveStopTime: request.stopTime,
    timezone: request.siteMapping.timezone,
  });

  const query = {
    startDate: formatReportQueryDate(
      request.startTime,
      request.siteMapping.timezone,
    ),
  };
  const [initialResult, driverResult] = await Promise.all([
    client.getVehicleEvaluationWithGasConsumption(query),
    typeof client.getDriverEvaluation === "function"
      ? client.getDriverEvaluation(query).catch((error) => {
        logger("driver_evaluation_unavailable", {
          kind: error?.kind || "upstream",
          httpStatus: error?.httpStatus || null,
        });
        return null;
      })
      : Promise.resolve(null),
  ]);
  const completed = await pollCompletedReport(initialResult, request, {
    client,
    logger,
    sessionStore,
    sleepFn,
    pollingIntervalMs,
    pollingTimeoutMs,
    nowFn,
  });
  logger("api_records", {
    scaniaEndpoint: completed.endpoint,
    httpStatus: completed.status,
    apiRecordCount: completed.rows.length,
    sessionId: maskSessionId(completed.sessionId),
  });

  const normalized = filterAndNormalizeRows(
    completed.rows,
    importedVehicles,
    request,
    driverAssignmentsFromPayload(driverResult?.payload),
  );
  for (const [filter, count] of Object.entries(normalized.filterCounts)) {
    logger("records_removed", { filter, count });
  }
  logger("report_complete", {
    siteVehicleMasterCount: normalized.siteMasterCount,
    finalVehicleCount: normalized.rows.length,
  });

  return {
    reportType: "Driverwise Standstill Tracking",
    source: completed.source,
    generatedAt: new Date(nowFn()).toISOString(),
    rows: normalized.rows,
    period: {
      date: request.reportDate,
      shift: request.shift,
      site: request.siteMapping.fmsSite,
      scaniaSite: request.siteMapping.scaniaSite,
      start: request.startTime,
      end: request.stopTime,
      timezone: request.siteMapping.timezone,
    },
    meta: {
      endpoint: completed.endpoint,
      httpStatus: completed.status,
      rawRecordCount: completed.rows.length,
      finalFilteredVehicleCount: normalized.rows.length,
      driverAssignmentCount: normalized.rows.filter((row) => row.driverName !== "Unknown").length,
      filterCounts: normalized.filterCounts,
      siteVehicleMasterCount: normalized.siteMasterCount,
      sessionId: maskSessionId(completed.sessionId),
      unavailableFields: unavailableFields(normalized.rows),
      emptyReason: completed.rows.length === 0
        ? "Scania returned no Vehicle Evaluation rows for the requested period."
        : normalized.rows.length === 0
          ? "All returned rows were removed by the configured site or minimum-engine-time filters."
          : null,
    },
  };
}

module.exports = {
  MINIMUM_ENGINE_MINUTES,
  SHIFT_MAPPINGS,
  SITE_MAPPINGS,
  averageFuelConsumptionLitresPer100KmToKmPerLitre,
  canonicalShiftWindow,
  durationMinutes,
  driverAssignmentsFromPayload,
  extractPollingStatus,
  extractSessionId,
  filterAndNormalizeRows,
  formatReportQueryDate,
  formatReportQueryTimestamp,
  generateVehicleEvaluationReport,
  localScaniaDateTimeToIso,
  maskSessionId,
  normalizeDurationHhMm,
  normalizeRegistration,
  normalizeScaniaReportRow,
  pollCompletedReport,
  reportRowsFromPayload,
  unavailableFields,
  validateReportInput,
};
