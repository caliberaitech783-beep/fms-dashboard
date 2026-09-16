const { app } = require("@azure/functions");
const { timingSafeEqual } = require("node:crypto");
const { loadLocalEnv } = require("../lib/loadLocalEnv");

loadLocalEnv();

const authStore = require("../lib/authStore");
const { maskObject, safeErrorMessage, sanitizeText } = require("../lib/tracking/masking");
const { listVehicles: listImportedVehicles } = require("../lib/vehicles/vehicleStore");
const {
  ScaniaApiError,
  createScaniaClientFromEnv,
  endpointForLog,
} = require("../lib/scania/scaniaClient");
const {
  generateVehicleEvaluationReport,
  validateReportInput,
} = require("../lib/scania/scaniaVehicleEvaluation");
const { generateScaniaStatusReport } = require("../lib/scania/scaniaStatusReport");
const { buildScaniaShiftSummary } = require("../lib/scania/scaniaShiftSummary");
const {
  clearScaniaLiveCache,
  getLiveScaniaSnapshot,
  synchronizeScania,
} = require("../lib/scania/scaniaSyncService");
const { synchronizeScaniaAnalytics } = require("../lib/scania/scaniaAnalyticsSync");
const {
  listSnapshotMetadata,
  loadSnapshot,
  saveSnapshot,
} = require("../lib/scania/scaniaAnalyticsStore");

const LIVE_ROLES = new Set(["Super Admin", "Management", "Fleet Manager"]);
let shiftStatusCache = null;
let pendingShiftStatus = null;

function allowedOrigin(request) {
  const configured = (process.env.ALLOWED_ORIGINS || "https://fms.cmll.in")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin");
  return origin && configured.includes(origin)
    ? origin
    : configured[0] || "https://fms.cmll.in";
}

function response(request, status, body) {
  return {
    status,
    jsonBody: body,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(request),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "private, no-store",
      Vary: "Origin",
    },
  };
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function requireActor(request) {
  const token = bearerToken(request);
  if (!token) {
    throw Object.assign(new Error("Authentication required."), {
      statusCode: 401,
      kind: "portal_authentication",
      isPortalAuth: true,
    });
  }
  const payload = authStore.verifyToken(token);
  const actor = await authStore.getUser(payload.sub);
  if (!actor || !actor.isActive) {
    throw Object.assign(new Error("Authentication required."), {
      statusCode: 401,
      kind: "portal_authentication",
      isPortalAuth: true,
    });
  }
  return actor;
}

function requireLiveRole(actor) {
  if (!LIVE_ROLES.has(actor?.role)) {
    throw Object.assign(new Error("Permission denied."), {
      statusCode: 403,
      kind: "portal_permission",
      isPortalAuth: true,
    });
  }
}

function scaniaSecrets() {
  return [
    process.env.SCANIA_CLIENT_ID,
    process.env.SCANIA_CLIENT_SECRET,
    process.env.SCANIA_SECRET_KEY,
    process.env.SCANIA_ACCESS_TOKEN,
    process.env.SCANIA_REPORT_SESSION_ID,
  ].filter(Boolean);
}

function createLogger(context) {
  return (event, details = {}) => {
    const masked = maskObject(details);
    const serialized = sanitizeText(JSON.stringify(masked), scaniaSecrets());
    context.log(`[Scania] ${event} ${serialized}`);
  };
}

function publicError(error) {
  const kind = error?.kind || "upstream";
  if (kind === "portal_authentication") {
    return { kind, message: "Dashboard authentication is required." };
  }
  if (kind === "portal_permission") {
    return { kind, message: "Your dashboard role cannot access live Scania data." };
  }
  if (kind === "authentication") {
    return {
      kind,
      message: "Scania API authentication failed. Check the server-side Scania credentials.",
    };
  }
  if (kind === "permission") {
    return {
      kind,
      message: "Scania API permission was denied for the requested endpoint or vehicles.",
    };
  }
  if (kind === "timeout") {
    return {
      kind,
      message: "Scania report generation timed out before a completed result was returned.",
    };
  }
  if (kind === "mapping") {
    return { kind, message: safeErrorMessage(error, scaniaSecrets()) };
  }
  if (kind === "validation" || kind === "configuration") {
    return { kind, message: safeErrorMessage(error, scaniaSecrets()) };
  }
  if (kind === "rate_limit") {
    return {
      kind,
      message: "Scania API rate limit was reached. Try again after the reset window.",
    };
  }
  return {
    kind,
    message: "Scania live data is temporarily unavailable.",
  };
}

function failureResponse(request, context, error, operation) {
  const safeMessage = safeErrorMessage(error, scaniaSecrets());
  context.error(`[Scania] ${operation} failed`, safeMessage);
  const status = error?.isPortalAuth
    ? error.statusCode
    : [400, 422, 503, 504].includes(error?.statusCode)
      ? error.statusCode
      : 502;
  const publicDetails = publicError(error);
  return response(request, status, {
    error: {
      code: `SCANIA_${String(publicDetails.kind || "upstream").toUpperCase()}`,
      kind: publicDetails.kind,
      message: publicDetails.message,
      retryable: Boolean(error?.retryable || ["timeout", "rate_limit", "network"].includes(error?.kind)),
    },
  });
}

function queryValue(request, name) {
  return String(request.query.get(name) || "").trim();
}

function safeSecretEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requestSyncSecret(request) {
  return request.headers.get("x-sync-secret") || request.query.get("secret") || "";
}

function maskVin(value) {
  const vin = String(value || "").trim();
  if (!vin) return null;
  return vin.length <= 6 ? "[masked]" : `${"*".repeat(vin.length - 6)}${vin.slice(-6)}`;
}

function vehicleListItem(vehicle, canViewPrecise) {
  const vin = String(vehicle?.vin || vehicle?.Vin || "").trim();
  return {
    vin: canViewPrecise ? vin : maskVin(vin),
    registrationNumber: String(
      vehicle?.customerVehicleName
      || vehicle?.CustomerVehicleName
      || vehicle?.licensePlate
      || vehicle?.LicensePlate
      || "",
    ).replace(/\*/g, "").trim(),
    brand: vehicle?.brand || vehicle?.Brand || "SCANIA",
    type: vehicle?.type || vehicle?.Type || null,
    model: vehicle?.model || vehicle?.Model || null,
    productionDate: vehicle?.productionDate || vehicle?.ProductionDate || null,
    authorizedPaths: vehicle?.authorizedPaths || vehicle?.AuthorizedPaths || [],
  };
}

function positionItem(position, canViewPrecise) {
  const tracks = position?.VehicleTrackingPositions || position?.vehicleTrackingPositions;
  const latestTrack = Array.isArray(tracks)
    ? tracks.at(-1)
    : tracks && typeof tracks === "object"
      ? tracks
      : null;
  const header = position?.VehiclePositionHeader
    || position?.vehiclePositionHeader
    || latestTrack
    || position;
  const snapshot = position?.snapshotData || position?.SnapshotData || {};
  const gnss = snapshot?.gnssPosition || snapshot?.GnssPosition || {};
  const vin = String(
    position?.Vin
    || position?.vin
    || header?.Vin
    || header?.vin
    || "",
  ).trim();
  return {
    vin: canViewPrecise ? vin : maskVin(vin),
    registrationNumber: String(
      header?.LicensePlate
      || header?.licensePlate
      || header?.CustomerVehicleName
      || header?.customerVehicleName
      || position?.LicensePlate
      || position?.licensePlate
      || position?.CustomerVehicleName
      || position?.customerVehicleName
      || "",
    ).replace(/\*/g, "").trim(),
    recordedAt:
      header?.TimePosition
      || header?.timePosition
      || gnss?.positionDateTime
      || position?.createdDateTime
      || null,
    latitude: canViewPrecise ? header?.Latitude ?? gnss?.latitude ?? null : null,
    longitude: canViewPrecise ? header?.Longitude ?? gnss?.longitude ?? null : null,
    speedKph: header?.Speed ?? gnss?.speed ?? snapshot?.wheelBasedSpeed ?? null,
    heading: canViewPrecise ? header?.Heading ?? gnss?.heading ?? null : null,
    ignition: header?.Ignition || header?.ignition || null,
    odometer: header?.Odometer || header?.odometer || null,
  };
}

function statusItem(status, canViewPrecise) {
  const vin = String(status?.vin || status?.Vin || "").trim();
  const snapshot = status?.snapshotData || status?.SnapshotData || {};
  const gnss = snapshot?.gnssPosition || snapshot?.GnssPosition || {};
  return {
    vin: canViewPrecise ? vin : maskVin(vin),
    recordedAt:
      status?.createdDateTime
      || status?.CreatedDateTime
      || status?.receivedDateTime
      || null,
    receivedAt: status?.receivedDateTime || status?.ReceivedDateTime || null,
    totalVehicleDistanceMetres:
      status?.hrTotalVehicleDistance
      ?? status?.HrTotalVehicleDistance
      ?? null,
    totalEngineHours:
      status?.totalEngineHours
      ?? status?.TotalEngineHours
      ?? null,
    totalFuelUsedMillilitres:
      status?.engineTotalFuelUsed
      ?? status?.EngineTotalFuelUsed
      ?? null,
    latitude: canViewPrecise ? gnss?.latitude ?? null : null,
    longitude: canViewPrecise ? gnss?.longitude ?? null : null,
    speedKph: gnss?.speed ?? snapshot?.wheelBasedSpeed ?? null,
    fuelLevelPercent: snapshot?.fuelLevel1 ?? snapshot?.FuelLevel1 ?? null,
  };
}

function exceptionItem(item, canViewPrecise) {
  const header = item?.VehicleExceptionHeader || item?.vehicleExceptionHeader || {};
  const vin = String(header?.Vin || header?.vin || "").trim();
  return {
    vin: canViewPrecise ? vin : maskVin(vin),
    registrationNumber: String(
      header?.LicensePlate
      || header?.licensePlate
      || header?.CustomerVehicleName
      || "",
    ).replace(/\*/g, "").trim(),
    chassisNumber: header?.ChassisNumber || header?.chassisNumber || null,
    exceptions:
      item?.VehicleExceptions?.ExceptionInformation
      || item?.vehicleExceptions?.exceptionInformation
      || [],
  };
}

async function withLiveActor(request, operation, handler, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    const actor = await requireActor(request);
    requireLiveRole(actor);
    return await handler(actor);
  } catch (error) {
    return failureResponse(request, context, error, operation);
  }
}

async function handleVehicles(request, context) {
  return withLiveActor(request, "vehicles", async (actor) => {
    const logger = createLogger(context);
    const client = createScaniaClientFromEnv({
      onEvent: (event, details) => logger(event, details),
    });
    const result = await client.getVehicles({
      vin: queryValue(request, "vin"),
      lastVin: queryValue(request, "lastVin"),
    });
    const canViewPrecise = LIVE_ROLES.has(actor.role);
    const vehicles = result.records.map((vehicle) => vehicleListItem(vehicle, canViewPrecise));
    logger("vehicles_complete", {
      scaniaEndpoint: result.endpoint,
      httpStatus: result.status,
      apiRecordCount: result.records.length,
      finalVehicleCount: vehicles.length,
    });
    return response(request, 200, {
      vehicles,
      count: vehicles.length,
      fetchedAt: new Date().toISOString(),
      source: "SCANIA_LIVE_API",
    });
  }, context);
}

async function handlePositions(request, context) {
  return withLiveActor(request, "positions", async (actor) => {
    const logger = createLogger(context);
    const client = createScaniaClientFromEnv({
      onEvent: (event, details) => logger(event, details),
    });
    const result = await client.getLatestPositions({
      vin: queryValue(request, "vin"),
    });
    const canViewPrecise = LIVE_ROLES.has(actor.role);
    const positions = result.records.map((position) => positionItem(position, canViewPrecise));
    logger("positions_complete", {
      scaniaEndpoint: result.endpoint,
      httpStatus: result.status,
      apiRecordCount: result.records.length,
      finalVehicleCount: positions.length,
    });
    return response(request, 200, {
      positions,
      count: positions.length,
      fetchedAt: new Date().toISOString(),
      source: "SCANIA_LIVE_API",
    });
  }, context);
}

async function handleStatus(request, context) {
  return withLiveActor(request, "status", async (actor) => {
    const logger = createLogger(context);
    const snapshot = await getLiveScaniaSnapshot({ allowBootstrap: true });
    const canViewPrecise = LIVE_ROLES.has(actor.role);
    const requestedVin = queryValue(request, "vin").toUpperCase();
    const statuses = snapshot.telemetry
      .filter((record) => !requestedVin || record.trackerId.toUpperCase() === requestedVin)
      .map((record) => ({
        ...statusItem(record.rawMetrics.scaniaStatus || {}, canViewPrecise),
        vin: canViewPrecise ? record.trackerId : maskVin(record.trackerId),
        recordedAt: record.timestamp,
        speedKph: record.rawMetrics.speedKph ?? null,
      }));
    logger("status_complete", {
      storageTables: snapshot.storage.tableNames,
      apiRecordCount: snapshot.storage.persistedStateCount,
      finalVehicleCount: statuses.length,
    });
    return response(request, 200, {
      statuses,
      count: statuses.length,
      fetchedAt: snapshot.fetchedAt,
      source: snapshot.source,
      integration: snapshot.integration,
    });
  }, context);
}

async function handleSnapshot(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    await requireActor(request);
    return response(request, 200, await getLiveScaniaSnapshot({ allowBootstrap: true }));
  } catch (error) {
    return failureResponse(request, context, error, "snapshot");
  }
}

async function handleManualRefresh(request, context) {
  return withLiveActor(request, "manual refresh", async () => {
    const [sync, analytics] = await Promise.all([
      synchronizeScania({ force: true }),
      synchronizeScaniaAnalytics(),
    ]);
    clearScaniaLiveCache();
    shiftStatusCache = null;
    return response(request, 200, {
      ok: true,
      sync,
      analytics,
      snapshot: await getLiveScaniaSnapshot({ allowBootstrap: false, force: true }),
    });
  }, context);
}

async function handleAnalyticsStatus(request, context) {
  return withLiveActor(request, "analytics status", async () => response(request, 200, {
    tableName: process.env.SCANIA_ANALYTICS_TABLE_NAME || "ScaniaApiSnapshots",
    resources: await listSnapshotMetadata(),
  }), context);
}

async function handleInternalSync(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  const expected = process.env.SCANIA_SYNC_SECRET;
  if (!expected || !safeSecretEquals(requestSyncSecret(request), expected)) {
    return response(request, 401, { message: "Authentication required." });
  }
  try {
    const sync = await synchronizeScania();
    clearScaniaLiveCache();
    shiftStatusCache = null;
    return response(request, 200, { ok: true, sync });
  } catch (error) {
    return failureResponse(request, context, error, "internal synchronization");
  }
}

async function handleExceptions(request, context) {
  return withLiveActor(request, "exceptions", async (actor) => {
    const logger = createLogger(context);
    const client = createScaniaClientFromEnv({
      onEvent: (event, details) => logger(event, details),
    });
    const result = await client.getExceptions({
      vin: queryValue(request, "vin"),
      startDateTime: queryValue(request, "startTime"),
      stopDateTime: queryValue(request, "stopTime"),
    });
    const canViewPrecise = LIVE_ROLES.has(actor.role);
    const exceptions = result.records.map((item) => exceptionItem(item, canViewPrecise));
    logger("exceptions_complete", {
      scaniaEndpoint: result.endpoint,
      httpStatus: result.status,
      apiRecordCount: result.records.length,
      finalVehicleCount: exceptions.length,
    });
    return response(request, 200, {
      exceptions,
      count: exceptions.length,
      fetchedAt: new Date().toISOString(),
      source: "SCANIA_LIVE_API",
    });
  }, context);
}

function reportSnapshotResource(body) {
  const date = String(body?.startTime || "unknown").slice(0, 10);
  const shift = String(body?.shift || "all").trim().toLowerCase();
  const site = String(body?.site || "all-sites")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const periodKey = body?.exactPeriod === true
    ? `-${Buffer.from(`${body.startTime}|${body.stopTime}`).toString("base64url")}`
    : "";
  return `vehicle-evaluation-report-${date}-${shift}-${site || "all-sites"}${periodKey}`;
}

function storedReportFallback(snapshot) {
  const report = snapshot?.payload;
  if (!report || report.reportType !== "Driverwise Standstill Tracking" || !Array.isArray(report.rows)) {
    return null;
  }
  return {
    ...report,
    source: "SCANIA_STORED_REPORT_CACHE",
    generatedAt: new Date().toISOString(),
    notice: `Scania live service is temporarily unavailable. Showing the last successful report saved ${snapshot.fetchedAt}.`,
    meta: {
      ...(report.meta || {}),
      cacheFallback: true,
      cachedAt: snapshot.fetchedAt,
    },
  };
}

async function handleVehicleEvaluation(request, context) {
  return withLiveActor(request, "vehicle evaluation report", async () => {
    let body;
    try {
      body = await request.json();
    } catch {
      throw new ScaniaApiError("A valid JSON report request body is required.", {
        kind: "validation",
        statusCode: 400,
      });
    }
    const logger = createLogger(context);
    const [importedVehicles, snapshot] = await Promise.all([
      listImportedVehicles(),
      getLiveScaniaSnapshot({ allowBootstrap: true }),
    ]);
    const scaniaSiteMasters = snapshot.vehicles.map((vehicle) => ({
      vin: vehicle.trackerId,
      vehicleNumber: vehicle.vehicleNumber,
      vehicleModel: vehicle.modelNumber,
      siteId: vehicle.siteId,
      siteName: vehicle.siteName,
      siteGroup: vehicle.siteGroup,
      contractType: vehicle.contractType,
      active: vehicle.active,
    }));
    const reportVehicles = [...importedVehicles, ...scaniaSiteMasters];
    const evaluationConfigured = Boolean(
      process.env.SCANIA_VEHICLE_EVALUATION_GAS_URL
      || process.env.SCANIA_VEHICLE_EVALUATION_URL,
    );
    const resource = reportSnapshotResource(body);
    let result;
    try {
      result = evaluationConfigured
        ? await generateVehicleEvaluationReport(body, { importedVehicles: reportVehicles, logger })
        : await generateScaniaStatusReport(body, { importedVehicles: reportVehicles });
      await saveSnapshot(resource, result, {
        endpoint: result?.meta?.endpoint || "ScaniaDriverwiseStandstillReport",
        fetchedAt: result.generatedAt,
        httpStatus: result?.meta?.httpStatus || 200,
        recordCount: result.rows.length,
      }).catch((error) => logger("report_cache_save_failed", {
        kind: error?.kind || "storage",
        statusCode: error?.statusCode || null,
      }));
    } catch (error) {
      const cached = await loadSnapshot(resource).catch(() => null);
      result = storedReportFallback(cached);
      if (!result) throw error;
      logger("report_cache_fallback", {
        resource,
        cachedAt: cached.fetchedAt,
        rowCount: result.rows.length,
        liveErrorKind: error?.kind || "upstream",
        liveHttpStatus: error?.httpStatus || null,
      });
    }
    return response(request, 200, result);
  }, context);
}

async function getShiftStatusSnapshot(logger) {
  const now = Date.now();
  const ttlMs = Math.max(5, Number(process.env.SCANIA_CACHE_SECONDS || 300)) * 1000;
  if (shiftStatusCache && shiftStatusCache.expiresAt > now) return shiftStatusCache.result;
  if (pendingShiftStatus) return pendingShiftStatus;
  const staleResult = shiftStatusCache?.result || null;

  pendingShiftStatus = (async () => {
    try {
      const snapshot = await getLiveScaniaSnapshot({ allowBootstrap: true });
      const result = {
        endpoint: "ScaniaVehicleState",
        status: 200,
        vehicles: snapshot.vehicles,
        records: snapshot.telemetry
          .map((record) => record.rawMetrics.scaniaStatus)
          .filter(Boolean),
      };
      shiftStatusCache = { result, expiresAt: Date.now() + ttlMs };
      return result;
    } catch (error) {
      if (!staleResult) throw error;
      logger("shift_status_stale_fallback", {
        kind: error?.kind || "upstream",
        statusCode: error?.statusCode || null,
      });
      return staleResult;
    }
  })().finally(() => {
    pendingShiftStatus = null;
  });
  return pendingShiftStatus;
}

async function handleShiftSummary(request, context) {
  return withLiveActor(request, "shift summary report", async () => {
    let body;
    try {
      body = await request.json();
    } catch {
      throw new ScaniaApiError("A valid JSON report request body is required.", {
        kind: "validation",
        statusCode: 400,
      });
    }

    const allSites = String(body.site || "").trim().toLowerCase() === "all sites";
    const requestDetails = validateReportInput({
      ...body,
      site: allSites ? "Sasti OCM" : body.site,
    });
    if (allSites) {
      requestDetails.site = "All Sites";
      requestDetails.siteMapping = {
        ...requestDetails.siteMapping,
        fmsSite: "All Scania sites",
        fmsSiteId: null,
        scaniaSite: "All Scania sites",
      };
    }
    const logger = createLogger(context);
    const [statusResult, importedVehicles] = await Promise.all([
      getShiftStatusSnapshot(logger),
      listImportedVehicles(),
    ]);
    const scaniaSiteMasters = (statusResult.vehicles || []).map((vehicle) => ({
      vin: vehicle.trackerId,
      vehicleNumber: vehicle.vehicleNumber,
      siteId: vehicle.siteId,
      siteName: vehicle.siteName,
      siteGroup: vehicle.siteGroup,
      contractType: vehicle.contractType,
      active: vehicle.active,
    }));
    const report = buildScaniaShiftSummary({
      vehicles: scaniaSiteMasters.map((vehicle) => ({
        vin: vehicle.vin,
        customerVehicleName: vehicle.vehicleNumber,
      })),
      statuses: statusResult.records,
      importedVehicles: [...importedVehicles, ...scaniaSiteMasters],
      request: requestDetails,
    });
    logger("shift_summary_complete", {
      statusEndpoint: statusResult.endpoint,
      apiStatusCount: statusResult.records.length,
      matchedVehicleCount: report.meta.matchedVehicleCount,
      site: requestDetails.siteMapping.fmsSite,
      shift: requestDetails.shift,
    });
    return response(request, 200, report);
  }, context);
}

app.http("scaniaVehicles", {
  route: "scania/vehicles",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleVehicles,
});

app.http("scaniaPositions", {
  route: "scania/positions",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handlePositions,
});

app.http("scaniaStatus", {
  route: "scania/status",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleStatus,
});

app.http("scaniaExceptions", {
  route: "scania/exceptions",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleExceptions,
});

app.http("scaniaVehicleEvaluationReport", {
  route: "scania/reports/vehicle-evaluation",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: handleVehicleEvaluation,
});

app.http("scaniaSnapshot", {
  route: "scania/snapshot",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleSnapshot,
});

app.http("scaniaManualRefresh", {
  route: "integrations/scania/refresh",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: handleManualRefresh,
});

app.http("scaniaAnalyticsStatus", {
  route: "scania/analytics/status",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleAnalyticsStatus,
});

app.http("scaniaInternalSync", {
  route: "internal/scania-sync",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: handleInternalSync,
});

app.http("scaniaShiftSummaryReport", {
  route: "scania/reports/shift-summary",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: handleShiftSummary,
});

app.timer("scaniaScheduledSync", {
  schedule: "30 */5 * * * *",
  handler: async (_timer, context) => {
    const configured = Boolean(
      process.env.SCANIA_ACCESS_TOKEN
      || (process.env.SCANIA_CLIENT_ID && (process.env.SCANIA_CLIENT_SECRET || process.env.SCANIA_SECRET_KEY)),
    );
    if (!configured) return;
    try {
      await synchronizeScania();
      clearScaniaLiveCache();
      shiftStatusCache = null;
    } catch (error) {
      context.error("Scheduled Scania synchronization failed", safeErrorMessage(error, scaniaSecrets()));
    }
  },
});

app.timer("scaniaAnalyticsScheduledSync", {
  schedule: "0 */30 * * * *",
  handler: async (_timer, context) => {
    const configured = Boolean(
      process.env.SCANIA_ACCESS_TOKEN
      || (process.env.SCANIA_CLIENT_ID && (process.env.SCANIA_CLIENT_SECRET || process.env.SCANIA_SECRET_KEY)),
    );
    if (!configured) return;
    try {
      await synchronizeScaniaAnalytics();
    } catch (error) {
      context.error("Scheduled Scania analytics synchronization failed", safeErrorMessage(error, scaniaSecrets()));
    }
  },
});

module.exports = {
  createLogger,
  exceptionItem,
  failureResponse,
  handleAnalyticsStatus,
  handleExceptions,
  handlePositions,
  handleSnapshot,
  handleStatus,
  handleShiftSummary,
  handleVehicleEvaluation,
  handleVehicles,
  positionItem,
  publicError,
  statusItem,
  vehicleListItem,
};
