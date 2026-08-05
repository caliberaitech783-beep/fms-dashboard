const { app } = require("@azure/functions");
const { timingSafeEqual } = require("node:crypto");
const store = require("../lib/authStore");
const { safeErrorMessage } = require("../lib/tracking/masking");
const {
  createVolvoClientFromEnv,
  findVolvoSiteAssignment,
  normalizeVolvoVehicle,
  parseVolvoSiteMap,
} = require("../lib/volvo/volvoRfmsClient");
const {
  buildDriverStandstillRows,
  fetchVehicleScopedHistory,
  parseDriverMap,
  resolveRecentReportDate,
} = require("../lib/volvo/driverStandstillReport");
const {
  clearVolvoLiveCache,
  getLiveVolvoSnapshot,
  synchronizeVolvo,
} = require("../lib/volvo/volvoSyncService");
const {
  clearVolvoDriverCache,
  driverNameMap,
  emptyDriverDirectory,
  findDriverDetails,
  getLiveVolvoDriverDirectory,
} = require("../lib/volvo/volvoDriverService");
const {
  clearVolvoScoresCache,
  getVolvoScores,
} = require("../lib/volvo/volvoScoresService");
const { getShiftWindow } = require("../lib/tracking/shiftResolver");
const { listVehicles: listImportedVehicles } = require("../lib/vehicles/vehicleStore");
const {
  importedSiteAssignment,
  isImportedVehicleInPortalScope,
  makeNoDataLiveVehicle,
  mergeVolvoVehicleMasters,
} = require("../lib/vehicles/vehicleMasterIntegration");

let cachedSnapshot = null;
let pendingSnapshot = null;
let cachedMasterVehicles = null;
const driverReportCache = new Map();

function allowedOrigin(request) {
  const configured = (process.env.ALLOWED_ORIGINS || "https://fms.cmll.in")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin");
  return origin && configured.includes(origin) ? origin : configured[0] || "https://fms.cmll.in";
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
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireActor(request) {
  const token = bearerToken(request);
  if (!token) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, isPortalAuth: true });
  }
  const payload = store.verifyToken(token);
  const actor = await store.getUser(payload.sub);
  if (!actor || !actor.isActive) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, isPortalAuth: true });
  }
  return actor;
}

function vinAllowlist() {
  return new Set(
    String(process.env.VOLVO_RFMS_VIN_ALLOWLIST || "")
      .split(",")
      .map((vin) => vin.trim())
      .filter(Boolean),
  );
}

function portalStatus(liveVehicle) {
  if (!liveVehicle || liveVehicle.isStale) return "offline";
  if (liveVehicle.movementState === "MOVING") return "running";
  if (liveVehicle.movementState === "STANDSTILL") return "idle";
  if (liveVehicle.movementState === "PARKED") return "stopped";
  return "stopped";
}

function vehicleVin(vehicle) {
  return String(vehicle?.vin || vehicle?.VIN || "").trim();
}

function maskVin(vin) {
  const normalized = String(vin || "").trim();
  if (!normalized) return null;
  return normalized.length <= 6 ? normalized : `${"*".repeat(normalized.length - 6)}${normalized.slice(-6)}`;
}

function canViewPreciseVolvoData(actor) {
  return ["Super Admin", "Management", "Fleet Manager"].includes(actor?.role);
}

function liveVehicleToTelemetry(vehicle, liveVehicle, driverDetails = null) {
  if (!liveVehicle?.eventTime) return null;
  const distanceKm = Number.isFinite(liveVehicle.odometerKm) ? liveVehicle.odometerKm : null;
  const engineHours = Number.isFinite(liveVehicle.engineHours) ? liveVehicle.engineHours : null;
  const runningHours = Number.isFinite(liveVehicle.lifetimeRunningSeconds)
    ? liveVehicle.lifetimeRunningSeconds / 3600
    : null;
  const idleHours = Number.isFinite(liveVehicle.lifetimeStandstillSeconds)
    ? liveVehicle.lifetimeStandstillSeconds / 3600
    : null;
  const availableHours = runningHours !== null || idleHours !== null
    ? (runningHours || 0) + (idleHours || 0)
    : null;
  const fuelConsumedLitres = Number.isFinite(liveVehicle.totalFuelLitres)
    ? liveVehicle.totalFuelLitres
    : null;
  const truckEfficiencyKmPerLitre = distanceKm !== null && fuelConsumedLitres > 0
    ? distanceKm / fuelConsumedLitres
    : null;
  const idlePercentage = idleHours !== null && availableHours > 0
    ? idleHours / availableHours * 100
    : null;
  const runningPercentage = runningHours !== null && availableHours > 0
    ? runningHours / availableHours * 100
    : null;
  const location = liveVehicle.latitude !== null && liveVehicle.longitude !== null
    ? `${liveVehicle.latitude}, ${liveVehicle.longitude}`
    : null;
  return {
    id: `volvo-live-${vehicle.trackerId}-${new Date(liveVehicle.eventTime).getTime()}`,
    source: "VOLVO_RFMS_LIVE",
    vehicleId: vehicle.id,
    vehicleNumber: vehicle.vehicleNumber,
    driverId: liveVehicle.maskedDriverId || null,
    driverName: driverDetails?.name || null,
    driverMobile: null,
    trackerId: vehicle.trackerId,
    timestamp: liveVehicle.eventTime,
    date: liveVehicle.eventTime.slice(0, 10),
    shift: "UNKNOWN",
    siteId: vehicle.siteId,
    siteName: vehicle.siteName,
    assetCategory: vehicle.assetCategory,
    assetType: vehicle.assetType,
    company: vehicle.company,
    modelNumber: vehicle.modelNumber,
    location,
    odometerKm: liveVehicle.odometerKm,
    distanceKm,
    engineHours,
    runningHours,
    idleHours,
    stoppedHours: null,
    offlineHours: liveVehicle.isStale && Number.isFinite(liveVehicle.dataAgeSeconds)
      ? liveVehicle.dataAgeSeconds / 3600
      : 0,
    availableHours,
    fuelConsumedLitres,
    fuelFilledLitres: null,
    fuelLevelLitres: null,
    fuelLevelPercent: liveVehicle.fuelPercent,
    trips: null,
    capacityM3: vehicle.capacityM3,
    productionM3: null,
    leadKm: null,
    status: vehicle.status,
    truckEfficiencyKmPerLitre,
    hemmFuelRateLitrePerHour: null,
    fuelPerTrip: null,
    fuelPerM3: null,
    idlePercentage,
    runningPercentage,
    utilizationPercentage: null,
    rawMetrics: {
      vin: liveVehicle.vin,
      eventType: liveVehicle.eventType,
      eventContext: liveVehicle.eventContext,
      eventTime: liveVehicle.eventTime,
      receivedTime: liveVehicle.receivedTime,
      ignitionState: liveVehicle.ignitionState,
      movementState: liveVehicle.movementState,
      speedKph: liveVehicle.speedKph,
      fuelPercent: liveVehicle.fuelPercent,
      adBluePercent: liveVehicle.adBluePercent,
      ambientTemperatureC: liveVehicle.ambientTemperatureC,
      latitude: liveVehicle.latitude,
      longitude: liveVehicle.longitude,
      heading: liveVehicle.heading,
      altitudeMetres: liveVehicle.altitudeMetres,
      positionTime: liveVehicle.positionTime,
      currentStandstillStartedAt: liveVehicle.currentStandstillStartedAt,
      currentStandstillSeconds: liveVehicle.currentStandstillSeconds,
      lifetimeStandstillSeconds: liveVehicle.lifetimeStandstillSeconds,
      lifetimeStandstillFuelLitres: liveVehicle.lifetimeStandstillFuelLitres,
      lifetimeRunningSeconds: liveVehicle.lifetimeRunningSeconds,
      lifetimeRunningHours: runningHours,
      lifetimeRunningFuelLitres: liveVehicle.lifetimeRunningFuelLitres,
      lifetimeIdleHours: idleHours,
      lifetimeEfficiencyKmPerLitre: truckEfficiencyKmPerLitre,
      lifetimeOdometerKm: liveVehicle.odometerKm,
      lifetimeEngineHours: liveVehicle.engineHours,
      lifetimeFuelLitres: liveVehicle.totalFuelLitres,
      grossWeightKg: liveVehicle.grossWeightKg,
      maskedDriverId: liveVehicle.maskedDriverId || null,
      driverName: driverDetails?.name || null,
      driverTimeActivityCount: driverDetails?.driverTime?.activityCount ?? null,
      driverTimeDtjActivityCount: driverDetails?.driverTime?.dtjActivityCount ?? null,
      freshness: liveVehicle.freshness,
      dataAgeSeconds: liveVehicle.dataAgeSeconds,
      locationAgeSeconds: liveVehicle.locationAgeSeconds,
      isStale: liveVehicle.isStale,
      eventHistory: liveVehicle.eventHistory,
    },
  };
}

async function loadMasterVehicles(client) {
  const cacheMilliseconds = Number(process.env.VOLVO_VEHICLE_POLL_MS || 21_600_000);
  if (cachedMasterVehicles && Date.now() - cachedMasterVehicles.cachedAt < cacheMilliseconds) {
    return cachedMasterVehicles.value;
  }
  try {
    const value = await client.fetchAllVehicles();
    cachedMasterVehicles = { cachedAt: Date.now(), value };
    return value;
  } catch (error) {
    if (cachedMasterVehicles?.value?.length) return cachedMasterVehicles.value;
    throw error;
  }
}

async function loadSnapshot() {
  const cacheMilliseconds = Number(process.env.VOLVO_RFMS_CACHE_MS || 300_000);
  if (cachedSnapshot && Date.now() - cachedSnapshot.cachedAt < cacheMilliseconds) {
    return cachedSnapshot.value;
  }
  if (pendingSnapshot) {
    return pendingSnapshot;
  }

  pendingSnapshot = (async () => {
    const client = createVolvoClientFromEnv();
    const allowlist = vinAllowlist();
    const siteMap = parseVolvoSiteMap(process.env.VOLVO_RFMS_SITE_MAP_JSON);
    const [rawVehicles, liveSnapshot, driverDirectory, importedVehicles] = await Promise.all([
      String(process.env.USE_MOCK_VOLVO_DATA || "").toLowerCase() === "true"
        ? Promise.resolve([])
        : loadMasterVehicles(client),
      getLiveVolvoSnapshot({ allowBootstrap: true }),
      getLiveVolvoDriverDirectory().catch(() => emptyDriverDirectory()),
      listImportedVehicles(),
    ]);
    const apiMasterVehicles = rawVehicles.length ? rawVehicles : liveSnapshot.vehicles.map((vehicle) => ({
      vin: vehicle.vin,
      CustomerVehicleName: vehicle.vin,
      Brand: "VOLVO TRUCKS",
      Type: "TRUCK",
      Model: null,
    }));
    const masterVehicles = mergeVolvoVehicleMasters(apiMasterVehicles, importedVehicles, {
      // The Volvo vehicle endpoint defines the fleet population. Imported
      // records enrich matching vehicles but must not inflate dashboard KPIs.
      appendUnmatchedImported: false,
    });
    const portalMasterVehicles = masterVehicles.filter(isImportedVehicleInPortalScope);
    const selectedVehicles = allowlist.size
      ? portalMasterVehicles.filter((vehicle) => allowlist.has(vehicleVin(vehicle)))
      : portalMasterVehicles;
    const liveByVin = new Map(liveSnapshot.vehicles.map((vehicle) => [vehicle.vin, vehicle]));
    const statusOptions = {
      now: new Date(),
      maxAgeMinutes: Number(process.env.VOLVO_RFMS_LIVE_MAX_AGE_MINUTES || 120),
    };
    const vehicles = selectedVehicles.map((vehicle) => {
      const liveVehicle = liveByVin.get(vehicleVin(vehicle)) || null;
      const importedVehicle = vehicle.importedVehicleMaster || null;
      const normalized = normalizeVolvoVehicle(vehicle, null, {
        ...statusOptions,
        siteAssignment: importedSiteAssignment(vehicle) || findVolvoSiteAssignment(vehicle, siteMap),
      });
      return {
        ...normalized,
        active: importedVehicle ? importedVehicle.active : normalized.active,
        serviceStatus: importedVehicle?.serviceStatus || null,
        rawSiteName: importedVehicle?.rawSiteName || null,
        status: portalStatus(liveVehicle),
      };
    });
    const selectedVehicleIds = new Set(vehicles.map((vehicle) => vehicle.trackerId));
    const vehicleByVin = new Map(vehicles.map((vehicle) => [vehicle.trackerId, vehicle]));
    const telemetry = liveSnapshot.vehicles
      .filter((liveVehicle) => selectedVehicleIds.has(liveVehicle.vin))
      .map((liveVehicle) => liveVehicleToTelemetry(
        vehicleByVin.get(liveVehicle.vin),
        liveVehicle,
        findDriverDetails(driverDirectory, liveVehicle.driverId),
      ))
      .filter(Boolean);
    const fetchedAt = new Date().toISOString();
    const groupConnected = client.mode !== "group-oauth" || Boolean(
      liveSnapshot.meta.positionsLastSyncedAt
      && (liveSnapshot.meta.snapshotStatusLastSyncedAt || liveSnapshot.meta.accumulatedStatusLastSyncedAt),
    );
    const value = {
      source: "VOLVO_RFMS_LIVE",
      fetchedAt: liveSnapshot.meta.fetchedAt,
      vehicles,
      telemetry,
      summary: {
        authorizedVehicles: vehicles.length,
        liveReportingVehicles: vehicles.filter((vehicle) => vehicle.status !== "offline").length,
        statusRecords: telemetry.length,
      },
      integration: {
        id: "live-integration-volvo",
        company: "Volvo",
        sourceType: "API",
        status: groupConnected && vehicles.length ? "connected" : "delayed",
        lastSyncAt: liveSnapshot.meta.lastSuccessfulSyncAt || fetchedAt,
        nextSyncAt: new Date(Date.now() + cacheMilliseconds).toISOString(),
        recordsSyncedToday: telemetry.length,
        errorMessage: groupConnected ? null : "Awaiting the first successful Volvo Group synchronization.",
        driverRecords: driverDirectory.driverCount,
        driverTimes: driverDirectory.driverTimeCount,
        driverLastSyncAt: driverDirectory.fetchedAt,
      },
    };
    cachedSnapshot = { cachedAt: Date.now(), value };
    return value;
  })();

  try {
    return await pendingSnapshot;
  } catch (error) {
    if (cachedSnapshot?.value) return cachedSnapshot.value;
    throw error;
  } finally {
    pendingSnapshot = null;
  }
}

async function handle(request, context, selectBody) {
  if (request.method === "OPTIONS") {
    return response(request, 204, null);
  }

  try {
    await requireActor(request);
    const snapshot = await loadSnapshot();
    return response(request, 200, selectBody(snapshot));
  } catch (error) {
    const secrets = [
      process.env.VOLVO_RFMS_USERNAME,
      process.env.VOLVO_RFMS_PASSWORD,
    ];
    context.error("Volvo RFMS request failed", safeErrorMessage(error, secrets));
    const status = error.statusCode === 401 ? 401 : error.statusCode === 503 ? 503 : 502;
    return response(request, status, {
      message: status === 401 ? "Authentication required." : "Volvo RFMS connection is unavailable.",
    });
  }
}

function currentKolkataDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function subtractCalendarDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function scoreDate(value, name) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw Object.assign(new Error(`${name} must use YYYY-MM-DD format.`), { statusCode: 400 });
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw Object.assign(new Error(`${name} is not a valid date.`), { statusCode: 400 });
  }
  return normalized;
}

function defaultScoresStart(stopTime) {
  const date = new Date(`${stopTime}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

async function handleScores(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    const actor = await requireActor(request);
    if (!["Super Admin", "Management", "Fleet Manager"].includes(actor.role)) {
      throw Object.assign(new Error("Permission denied."), { statusCode: 403, isPortalAuth: true });
    }
    const stopTime = scoreDate(request.query.get("stoptime") || currentKolkataDate(), "stoptime");
    const startTime = scoreDate(request.query.get("starttime") || defaultScoresStart(stopTime), "starttime");
    if (startTime > stopTime) {
      throw Object.assign(new Error("starttime must not be after stoptime."), { statusCode: 400 });
    }
    const driverIdType = String(
      request.query.get("driverIdType") || process.env.VOLVO_SCORES_DRIVER_ID_TYPE || "pin",
    ).trim() || "pin";
    const force = String(request.query.get("refresh") || "").toLowerCase() === "true";
    return response(request, 200, await getVolvoScores({
      startTime,
      stopTime,
      driverIdType,
      force,
    }));
  } catch (error) {
    const secrets = [
      process.env.VOLVO_SCORES_API_USERNAME,
      process.env.VOLVO_SCORES_API_PASSWORD,
      process.env.VOLVO_DRIVER_API_USERNAME,
      process.env.VOLVO_DRIVER_API_PASSWORD,
      process.env.VOLVO_API_USERNAME,
      process.env.VOLVO_API_PASSWORD,
    ];
    context.error("Volvo Scores request failed", safeErrorMessage(error, secrets));
    const upstreamAuthFailure = !error.isPortalAuth && [401, 403].includes(error.statusCode);
    const status = upstreamAuthFailure ? 502 : [400, 401, 403, 503].includes(error.statusCode)
      ? error.statusCode
      : 502;
    return response(request, status, {
      message: upstreamAuthFailure
        ? "Volvo Scores authorization failed. Check the server-side credentials and subscription."
        : status === 401
          ? "Authentication required."
          : status === 403
            ? "Permission denied."
            : status === 400
              ? safeErrorMessage(error, secrets)
              : "Volvo Scores data is temporarily unavailable.",
    });
  }
}

function scheduleSiteName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return "Gauri";
  if (normalized.includes("sasti")) return "Sasti";
  if (normalized.includes("dhoptala")) return "Dhoptala";
  if (normalized.includes("lalpeth")) return "Sasti";
  if (normalized.includes("gauri") || normalized.includes("gouri")) return "Gauri";
  if (normalized.includes("majri")) return "Majri";
  if (normalized.includes("jayant")) return "Jayant";
  return value;
}

function matchesSite(vehicle, requestedSite) {
  const normalized = String(requestedSite || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return true;
  return [vehicle.siteId, vehicle.siteName]
    .filter(Boolean)
    .some((value) => {
      const candidate = String(value).trim().toLowerCase();
      return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
    });
}

async function loadDriverStandstillReport(request) {
  const requestedDate = String(request.query.get("date") || currentKolkataDate()).trim();
  const shift = String(request.query.get("shift") || "A").trim().toUpperCase();
  const requestedSite = String(request.query.get("site") || "Gauri").trim();
  const reportSite = requestedSite.toLowerCase() === "all" ? "Gauri" : requestedSite;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !["A", "B", "C"].includes(shift)) {
    throw Object.assign(new Error("A valid date and Shift A, B, or C are required."), { statusCode: 400 });
  }

  const dateResolution = resolveRecentReportDate(
    requestedDate,
    currentKolkataDate(),
    Number(process.env.VOLVO_RFMS_REPORT_HISTORY_DAYS || 13),
  );
  let date = dateResolution.date;

  let window = getShiftWindow(scheduleSiteName(reportSite), date, shift);
  if (!window.active) {
    throw Object.assign(new Error("The selected site does not have a configured shift schedule."), { statusCode: 400 });
  }

  const cacheKey = `${date}|${shift}|${reportSite.toLowerCase()}`;
  const cacheMilliseconds = Number(process.env.VOLVO_RFMS_DRIVER_REPORT_CACHE_MS || 300_000);
  const cached = driverReportCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < cacheMilliseconds) {
    return cached.value;
  }

  const snapshot = await loadSnapshot();
  const siteVehicles = snapshot.vehicles.filter((vehicle) => matchesSite(vehicle, reportSite));
  const siteFilterApplied = siteVehicles.length > 0;
  const selectedVehicles = siteVehicles;
  const fallbackDriverMap = parseDriverMap(process.env.VOLVO_RFMS_DRIVER_MAP_JSON);
  let driverDirectory = emptyDriverDirectory();
  let liveDriverConnected = false;
  try {
    driverDirectory = await getLiveVolvoDriverDirectory();
    liveDriverConnected = driverDirectory.driverCount > 0;
  } catch {
    liveDriverConnected = false;
  }
  const buildRows = (statuses, reportWindow) => buildDriverStandstillRows({
    vehicles: selectedVehicles,
    statuses,
    shiftStart: reportWindow.shiftStart,
    shiftEnd: reportWindow.shiftEnd,
    shiftName: shift,
    driverMap: new Map([...fallbackDriverMap, ...driverNameMap(driverDirectory)]),
    now: new Date(),
  });
  let statuses = [];
  let rows = [];
  let availabilityFallbackApplied = false;
  const client = createVolvoClientFromEnv();
  const fallbackDays = Math.max(0, Number(process.env.VOLVO_RFMS_REPORT_FALLBACK_DAYS || 1));
  const historyOptions = {
    maxPages: Number(process.env.VOLVO_RFMS_HISTORICAL_MAX_PAGES || 120),
    concurrency: Number(process.env.VOLVO_RFMS_DRIVER_REPORT_CONCURRENCY || 6),
    requestDelayMs: Number(process.env.VOLVO_RFMS_DRIVER_REPORT_REQUEST_DELAY_MS || 0),
    continueOnError: true,
  };
  const selectedShiftEnd = new Date(window.shiftEnd);
  const selectedQueryStop = new Date(Math.min(
    selectedShiftEnd.getTime() + 5 * 60_000,
    Date.now() + 5 * 60_000,
  ));
  const earliestDate = subtractCalendarDays(dateResolution.date, fallbackDays);
  const earliestWindow = getShiftWindow(scheduleSiteName(reportSite), earliestDate, shift);
  const queryStart = new Date(new Date(earliestWindow.shiftStart).getTime() - 60 * 60_000);
  if (selectedVehicles.length && selectedQueryStop > queryStart) {
    statuses = await fetchVehicleScopedHistory(client, selectedVehicles, {
      ...historyOptions,
      startTime: queryStart.toISOString(),
      stopTime: selectedQueryStop.toISOString(),
    });
    for (let dayOffset = 0; dayOffset <= fallbackDays; dayOffset += 1) {
      const candidateDate = subtractCalendarDays(dateResolution.date, dayOffset);
      const candidateWindow = getShiftWindow(scheduleSiteName(reportSite), candidateDate, shift);
      rows = buildRows(statuses, candidateWindow);
      if (!rows.length) continue;
      date = candidateDate;
      window = candidateWindow;
      availabilityFallbackApplied = dayOffset > 0;
      break;
    }
  }
  const columns = [
    "Vehicles",
    "Drivers",
    "Total time (hh:mm)",
    "Driving (km)",
    "Diesel engine on (%)",
    "Avg diesel engine on (km/l)",
    "Standstill (%)",
    "Standstill (hh:mm)",
    "Engine load % time of Total time (%)",
    "Coasting (%)",
    "Avg diesel (l/h)",
  ];
  const reportRows = rows.map((row) => ({
    "Vehicles": row.vehicle,
    "Drivers": row.driver,
    "Total time (hh:mm)": row.totalTime,
    "Driving (km)": row.drivingKm,
    "Diesel engine on (%)": row.dieselEngineOnPercent,
    "Avg diesel engine on (km/l)": row.averageDieselEngineKmPerLitre,
    "Fuel consumed (litres)": row.fuelLitres,
    "Standstill (%)": row.standstillPercent,
    "Standstill (hh:mm)": row.standstillTime,
    "Engine load % time of Total time (%)": row.engineLoadPercent,
    "Coasting (%)": row.coastingPercent,
    "Avg diesel (l/h)": row.averageDieselLitresPerHour,
  }));
  const notices = [];
  if (dateResolution.fallbackApplied) {
    notices.push(`The selected demo date ${requestedDate} is outside Volvo's live history window. Showing ${date} instead.`);
  }
  if (availabilityFallbackApplied) {
    notices.push(`No complete Volvo intervals were available for ${dateResolution.date}. Showing the latest available Shift ${shift} data from ${date}.`);
  }
  if (!siteFilterApplied) {
    notices.push(`No Volvo vehicles have a ${scheduleSiteName(reportSite)} site assignment. Configure the Volvo VIN-to-site mapping to load this report.`);
  }
  if (!liveDriverConnected) {
    notices.push("Live Volvo driver details are temporarily unavailable; masked driver identifiers are shown where available.");
  }

  const value = {
    reportType: "Driverwise Standstill Tracking",
    generatedAt: new Date().toISOString(),
    columns,
    rows: reportRows,
    live: true,
    source: "VOLVO_RFMS_HISTORY",
    period: {
      date,
      requestedDate,
      fallbackApplied: dateResolution.fallbackApplied || availabilityFallbackApplied,
      shift,
      site: scheduleSiteName(reportSite),
      start: window.shiftStart,
      end: window.shiftEnd,
      timezone: window.timezone,
    },
    siteFilterApplied,
    driverSource: liveDriverConnected ? "VOLVO_GROUP_DRIVER_API" : "MASKED_IDENTIFIER_FALLBACK",
    driverRecords: driverDirectory.driverCount,
    driverTimes: driverDirectory.driverTimeCount,
    historyRecords: statuses.length,
    notice: notices.length ? notices.join(" ") : null,
    unsupportedMetrics: {
      iShiftPerformanceTimePercent: "Requires a Volvo Connect analytics field or formula; it is not in standard RFMS 2.1 accumulated data.",
      aboveEconomyPercent: "Requires Volvo's economy-band definition or analytics endpoint; it is not a standard RFMS field.",
    },
  };
  driverReportCache.set(cacheKey, { cachedAt: Date.now(), value });
  return value;
}

async function handleDriverReport(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    const actor = await requireActor(request);
    if (!["Super Admin", "Management", "Fleet Manager"].includes(actor.role)) {
      throw Object.assign(new Error("Permission denied."), { statusCode: 403, isPortalAuth: true });
    }
    return response(request, 200, await loadDriverStandstillReport(request));
  } catch (error) {
    const secrets = [process.env.VOLVO_RFMS_USERNAME, process.env.VOLVO_RFMS_PASSWORD];
    context.error("Volvo driver standstill report failed", safeErrorMessage(error, secrets));
    const status = [400, 401, 403, 503].includes(error.statusCode) ? error.statusCode : 502;
    return response(request, status, {
      message: status === 401 ? "Authentication required." : safeErrorMessage(error, secrets),
    });
  }
}

function clearSnapshotCaches() {
  cachedSnapshot = null;
  clearVolvoLiveCache();
  clearVolvoDriverCache();
  clearVolvoScoresCache();
  driverReportCache.clear();
}

function safeSecretEquals(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function requestSyncSecret(request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return request.headers.get("x-volvo-sync-secret") || bearer;
}

function volvoSecrets() {
  return [
    process.env.VOLVO_CLIENT_ID,
    process.env.VOLVO_CLIENT_SECRET,
    process.env.VOLVO_API_KEY,
    process.env.VOLVO_API_USERNAME,
    process.env.VOLVO_API_PASSWORD,
    process.env.VOLVO_RFMS_USERNAME,
    process.env.VOLVO_RFMS_PASSWORD,
    process.env.VOLVO_DRIVER_API_USERNAME,
    process.env.VOLVO_DRIVER_API_PASSWORD,
    process.env.VOLVO_SCORES_API_USERNAME,
    process.env.VOLVO_SCORES_API_PASSWORD,
    process.env.VOLVO_SYNC_SECRET,
  ];
}

function volvoFailureResponse(request, context, error, label) {
  context.error(label, safeErrorMessage(error, volvoSecrets()));
  const upstreamAuthFailure = !error.isPortalAuth && [401, 403].includes(error.statusCode);
  const status = upstreamAuthFailure ? 502 : [400, 401, 403, 503].includes(error.statusCode) ? error.statusCode : 502;
  return response(request, status, {
    message: upstreamAuthFailure
      ? "Volvo API authorization failed. Check the server-side API subscription, credentials and vehicle permissions."
      : status === 401
        ? "Authentication required."
        : status === 403
          ? "Permission denied."
          : "Volvo vehicle data is temporarily unavailable.",
  });
}

async function handleLiveVehicles(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    const actor = await requireActor(request);
    const [liveSnapshot, portalSnapshot, driverDirectory] = await Promise.all([
      getLiveVolvoSnapshot({ allowBootstrap: true }),
      loadSnapshot(),
      getLiveVolvoDriverDirectory().catch(() => emptyDriverDirectory()),
    ]);
    const liveByVin = new Map(liveSnapshot.vehicles.map((vehicle) => [vehicle.vin, vehicle]));
    const canViewPrecise = canViewPreciseVolvoData(actor);
    const vehicles = portalSnapshot.vehicles.map((portalVehicle) => {
      const vehicle = liveByVin.get(portalVehicle.trackerId) || makeNoDataLiveVehicle(portalVehicle);
      const driver = findDriverDetails(driverDirectory, vehicle.driverId);
      return {
        ...vehicle,
        vin: canViewPrecise ? vehicle.vin : maskVin(vehicle.vin),
        displayVin: maskVin(vehicle.vin),
        driverId: canViewPrecise ? vehicle.driverId : null,
        maskedDriverId: vehicle.maskedDriverId || null,
        driverName: driver?.name || null,
        driverMobile: canViewPrecise ? driver?.phone || null : null,
        driverTime: driver?.driverTime || null,
        latitude: canViewPrecise ? vehicle.latitude : null,
        longitude: canViewPrecise ? vehicle.longitude : null,
        heading: canViewPrecise ? vehicle.heading : null,
        altitudeMetres: canViewPrecise ? vehicle.altitudeMetres : null,
        master: portalVehicle ? {
          vehicleNumber: portalVehicle.vehicleNumber,
          model: portalVehicle.modelNumber,
          siteId: portalVehicle.siteId,
          siteName: portalVehicle.siteName,
          contractType: portalVehicle.contractType,
          commissioningDate: portalVehicle.commissioningDate,
          serviceStatus: portalVehicle.serviceStatus || null,
          rawSiteName: portalVehicle.rawSiteName || null,
        } : null,
      };
    });
    const returnedSummary = vehicles.reduce((summary, vehicle) => {
      if (vehicle.movementState === "MOVING") summary.moving += 1;
      else if (vehicle.movementState === "STANDSTILL") summary.standstill += 1;
      else if (vehicle.movementState === "PARKED") summary.parked += 1;
      else summary.unknown += 1;
      if (vehicle.isStale) summary.stale += 1;
      if (vehicle.eventType === "NO_LIVE_DATA" || vehicle.freshness?.state === "no-data") summary.noData += 1;
      return summary;
    }, {
      total: vehicles.length,
      moving: 0,
      standstill: 0,
      parked: 0,
      unknown: 0,
      stale: 0,
      noData: 0,
    });
    return response(request, 200, {
      ...liveSnapshot,
      generatedAt: liveSnapshot.meta.fetchedAt,
      lastSuccessfulSyncAt: liveSnapshot.meta.lastSuccessfulSyncAt,
      vehicles,
      summary: {
        ...returnedSummary,
        stopped: returnedSummary.standstill + returnedSummary.parked,
      },
      sync: {
        status: portalSnapshot.integration.status === "connected" ? "healthy" : "degraded",
        positionsLastSyncedAt: liveSnapshot.meta.positionsLastSyncedAt
          || liveSnapshot.meta.lastSuccessfulSyncAt,
        statusLastSyncedAt: liveSnapshot.meta.snapshotStatusLastSyncedAt
          || liveSnapshot.meta.accumulatedStatusLastSyncedAt
          || liveSnapshot.meta.lastSuccessfulSyncAt,
        driversLastSyncedAt: driverDirectory.fetchedAt,
        driverRecords: driverDirectory.driverCount,
        driverTimes: driverDirectory.driverTimeCount,
      },
    });
  } catch (error) {
    return volvoFailureResponse(request, context, error, "Volvo live vehicle request failed");
  }
}

async function handleManualRefresh(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    const actor = await requireActor(request);
    if (!["Super Admin", "Management", "Fleet Manager"].includes(actor.role)) {
      throw Object.assign(new Error("Permission denied."), { statusCode: 403, isPortalAuth: true });
    }
    const sync = await synchronizeVolvo({ force: true });
    clearSnapshotCaches();
    return response(request, 200, {
      ok: true,
      sync,
      snapshot: await getLiveVolvoSnapshot({ allowBootstrap: false, force: true }),
    });
  } catch (error) {
    return volvoFailureResponse(request, context, error, "Volvo manual synchronization failed");
  }
}

async function handleInternalSync(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  const expected = process.env.VOLVO_SYNC_SECRET;
  if (!expected || !safeSecretEquals(requestSyncSecret(request), expected)) {
    return response(request, 401, { message: "Authentication required." });
  }
  try {
    const sync = await synchronizeVolvo();
    clearSnapshotCaches();
    return response(request, 200, { ok: true, sync });
  } catch (error) {
    return volvoFailureResponse(request, context, error, "Volvo internal synchronization failed");
  }
}

app.http("volvoVehicles", {
  route: "integrations/volvo/vehicles",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: (request, context) => handle(request, context, (snapshot) => snapshot),
});

app.http("volvoStatus", {
  route: "integrations/volvo/status",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: (request, context) => handle(request, context, (snapshot) => snapshot.integration),
});

app.http("volvoDriverStandstillReport", {
  route: "integrations/volvo/driver-standstill",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleDriverReport,
});

app.http("volvoScores", {
  route: "integrations/volvo/scores",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleScores,
});

app.http("volvoLiveVehicles", {
  route: "vehicles/live",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleLiveVehicles,
});

app.http("volvoManualRefresh", {
  route: "integrations/volvo/refresh",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: handleManualRefresh,
});

app.http("volvoInternalSync", {
  route: "internal/volvo-sync",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: handleInternalSync,
});

app.timer("volvoScheduledSync", {
  schedule: "0 */5 * * * *",
  handler: async (_timer, context) => {
    const configured = Boolean(
      process.env.VOLVO_API_USERNAME
      || process.env.VOLVO_CLIENT_ID
      || process.env.VOLVO_RFMS_USERNAME
      || String(process.env.USE_MOCK_VOLVO_DATA || "").toLowerCase() === "true",
    );
    if (!configured) return;
    try {
      await synchronizeVolvo();
      clearSnapshotCaches();
    } catch (error) {
      context.error("Scheduled Volvo synchronization failed", safeErrorMessage(error, volvoSecrets()));
    }
  },
});
