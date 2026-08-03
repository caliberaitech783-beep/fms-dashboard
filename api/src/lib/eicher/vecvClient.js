const {
  EICHER_SOURCE,
  eicherRegistrySummary,
  listEicherVehicleRegistry,
} = require("./eicherVehicleRegistry");
const {
  loadEicherSnapshot: loadPersistedEicherSnapshot,
  saveEicherSnapshot,
} = require("./eicherSnapshotStore");

const TOKEN_URL = "https://partnerapi.vecv.net/service-gateway/secure/genrateToken";
const LOCATION_URL = "https://partnerapi.vecv.net/service-gateway/vehicle/v1/getlivedata/location";
const DEFAULT_CACHE_MS = 60_000;
const DEFAULT_TOKEN_TTL_MS = 55 * 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const RUNNING_SPEED_KPH = 3;
const API_KEY_ENV_NAMES = ["EICHER_API_KEY", "APIKEY", "EICHER_APIKEY", "VECV_API_KEY"];
const TOKEN_ENV_NAMES = ["EICHER_BEARER_TOKEN", "EICHER_TOKEN", "VECV_BEARER_TOKEN"];

let bearerCache = null;
let snapshotCache = null;
let pendingSnapshot = null;
let lastSuccessfulSnapshot = null;

class EicherApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "EicherApiError";
    this.kind = options.kind || "upstream";
    this.statusCode = options.statusCode || 502;
    this.retryable = Boolean(options.retryable);
    this.upstreamStatus = options.upstreamStatus || null;
  }
}

function getApiKey(env = process.env) {
  return configuredValue(env, API_KEY_ENV_NAMES);
}

function getPreconfiguredBearerToken(env = process.env) {
  return configuredValue(env, TOKEN_ENV_NAMES);
}

function configuredValue(env, names) {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function hasEicherConfiguration(env = process.env) {
  return Boolean(getApiKey(env));
}

function tokenIsUsable(now = Date.now()) {
  return bearerCache?.token && bearerCache.expiresAt - 30_000 > now;
}

function resetBearerToken() {
  bearerCache = null;
}

function resetEicherCaches() {
  bearerCache = null;
  snapshotCache = null;
  pendingSnapshot = null;
  lastSuccessfulSnapshot = null;
}

async function getEicherSnapshot(options = {}) {
  const now = options.nowMs || Date.now();
  const cacheMs = Math.max(5, Number(options.env?.EICHER_CACHE_SECONDS || process.env.EICHER_CACHE_SECONDS || 60)) * 1000;

  if (!options.force && snapshotCache && snapshotCache.expiresAt > now) {
    return snapshotCache.value;
  }
  if (pendingSnapshot) {
    return pendingSnapshot;
  }

  pendingSnapshot = loadEicherSnapshot(options)
    .then((snapshot) => {
      snapshotCache = { expiresAt: Date.now() + cacheMs, value: snapshot };
      if (snapshot.meta?.lastSuccessfulUpdate) {
        lastSuccessfulSnapshot = snapshot;
      }
      return snapshot;
    })
    .finally(() => {
      pendingSnapshot = null;
    });

  return pendingSnapshot;
}

async function loadEicherSnapshot(options = {}) {
  const env = options.env || process.env;
  const apiKey = getApiKey(env);
  const fetchedAt = new Date().toISOString();

  if (!apiKey) {
    return registryOnlySnapshot({
      fetchedAt,
      status: "not_configured",
      errorMessage: "EICHER_API_KEY is not configured on the backend.",
    });
  }

  try {
    const payload = await fetchLocationPayload({
      env,
      fetchImpl: options.fetchImpl,
      forceToken: Boolean(options.forceToken),
    });
    const snapshot = normalizeEicherLocationPayload(payload, {
      fetchedAt,
      integrationStatus: "connected",
    });
    await rememberSuccessfulSnapshot(snapshot, options);
    return snapshot;
  } catch (error) {
    if (lastSuccessfulSnapshot) {
      return markSnapshotDelayed(lastSuccessfulSnapshot, fetchedAt, error);
    }
    const persistedSnapshot = await loadPersistedSnapshot(options);
    if (persistedSnapshot) {
      return markSnapshotDelayed(persistedSnapshot, fetchedAt, error);
    }
    return registryOnlySnapshot({
      fetchedAt,
      status: error?.kind === "authentication" ? "failed" : "delayed",
      errorMessage: publicErrorMessage(error),
      apiErrors: [publicErrorMessage(error)],
    });
  }
}

async function rememberSuccessfulSnapshot(snapshot, options = {}) {
  if (!snapshot.meta?.lastSuccessfulUpdate) return;
  lastSuccessfulSnapshot = snapshot;
  if (options.disablePersistence || !process.env.AzureWebJobsStorage) return;
  try {
    await saveEicherSnapshot(snapshot);
  } catch {
    // Live data should not fail just because the fallback cache could not be updated.
  }
}

async function loadPersistedSnapshot(options = {}) {
  if (options.disablePersistence || !process.env.AzureWebJobsStorage) return null;
  try {
    const snapshot = await loadPersistedEicherSnapshot();
    return snapshot?.source === EICHER_SOURCE && Array.isArray(snapshot.vehicles) ? snapshot : null;
  } catch {
    return null;
  }
}

async function fetchLocationPayload(options = {}) {
  let token = await getBearerToken(options);
  let result = await requestLocation(options, token);
  if (result.status === 401) {
    resetBearerToken();
    token = await getBearerToken({ ...options, forceToken: true });
    result = await requestLocation(options, token);
  }

  if (!result.ok) {
    throw httpFailure("Eicher location request failed.", result.status);
  }

  return result.body;
}

async function getBearerToken(options = {}) {
  const now = Date.now();
  if (!options.forceToken && tokenIsUsable(now)) {
    return bearerCache.token;
  }

  const env = options.env || process.env;
  const apiKey = getApiKey(env);
  const configuredToken = !options.forceToken ? getPreconfiguredBearerToken(env) : "";
  if (configuredToken) {
    bearerCache = {
      token: configuredToken,
      expiresAt: configuredTokenExpiry(env, now),
    };
    return configuredToken;
  }

  if (!apiKey) {
    throw new EicherApiError("EICHER_API_KEY is not configured.", {
      kind: "configuration",
      statusCode: 503,
    });
  }

  const result = await httpJson(TOKEN_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "API-KEY": apiKey,
    },
  }, options);

  if (!result.ok) {
    throw httpFailure("Eicher token request failed.", result.status);
  }

  const token = extractBearerToken(result.body);
  if (!token) {
    throw new EicherApiError("Eicher token response did not include a bearer token.", {
      kind: "upstream",
      statusCode: 502,
    });
  }

  bearerCache = {
    token,
    expiresAt: tokenExpiry(result.body, now),
  };
  return token;
}

async function requestLocation(options, token) {
  const env = options.env || process.env;
  const apiKey = getApiKey(env);
  return httpJson(LOCATION_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "API-KEY": apiKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ clientId: apiKey }),
  }, options);
}

async function httpJson(url, requestOptions, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new EicherApiError("Fetch API is not available in this runtime.", {
      kind: "configuration",
      statusCode: 503,
    });
  }

  const timeoutMs = Math.max(1000, Number(options.env?.EICHER_REQUEST_TIMEOUT_MS || process.env.EICHER_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...requestOptions,
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: parseBody(text),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new EicherApiError("Eicher request timed out.", {
        kind: "timeout",
        statusCode: 504,
        retryable: true,
      });
    }
    throw new EicherApiError("Eicher network request failed.", {
      kind: "network",
      statusCode: 503,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function httpFailure(message, status) {
  const kind = status === 401 || status === 403
    ? "authentication"
    : status === 429
      ? "rate_limit"
      : "upstream";
  return new EicherApiError(message, {
    kind,
    statusCode: [401, 403, 429].includes(status) ? 502 : 502,
    retryable: status >= 500 || status === 429,
    upstreamStatus: status,
  });
}

function extractBearerToken(payload) {
  if (!payload) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed || ["true", "false", "success", "ok"].includes(trimmed.toLowerCase())) return null;
    return trimmed.length > 10 ? trimmed : null;
  }
  if (Array.isArray(payload)) {
    return payload.map(extractBearerToken).find(Boolean) || null;
  }
  if (typeof payload === "object") {
    const directKeys = [
      "token",
      "accessToken",
      "access_token",
      "bearerToken",
      "bearer_token",
      "jwt",
      "idToken",
    ];
    for (const key of directKeys) {
      const token = extractBearerToken(payload[key]);
      if (token) return token;
    }
    for (const value of Object.values(payload)) {
      const token = extractBearerToken(value);
      if (token) return token;
    }
  }
  return null;
}

function tokenExpiry(payload, now) {
  const seconds = numericField(payload, ["expiresIn", "expires_in", "expirySeconds", "validFor"]);
  if (seconds !== null) return now + Math.max(60, seconds) * 1000;
  const expiresAt = stringField(payload, ["expiresAt", "expiry", "validTill"]);
  const parsed = expiresAt ? new Date(expiresAt).getTime() : NaN;
  return Number.isFinite(parsed) && parsed > now ? parsed : now + DEFAULT_TOKEN_TTL_MS;
}

function configuredTokenExpiry(env, now) {
  const seconds = Number(env.EICHER_TOKEN_TTL_SECONDS || env.VECV_TOKEN_TTL_SECONDS || "");
  return now + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_TOKEN_TTL_MS);
}

function normalizeEicherLocationPayload(payload, options = {}) {
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  const records = extractLocationRecords(payload);
  const fieldsReceived = collectTopLevelFields(records);
  const registry = listEicherVehicleRegistry();
  const registryByVin = new Map(registry.map((vehicle) => [vehicle.vin, vehicle]));
  const latestLiveByVin = new Map();

  records.forEach((record, index) => {
    const normalized = normalizeLocationRecord(record, { fetchedAt, index });
    if (!normalized.vin) return;
    const current = latestLiveByVin.get(normalized.vin);
    if (!current || normalized.eventTime > current.eventTime) {
      latestLiveByVin.set(normalized.vin, normalized);
    }
  });

  const liveVehicles = [...latestLiveByVin.values()].map((live) => vehicleFromRegistryEntry(
    registryByVin.get(live.vin) || {
      vin: live.vin,
      apiEnabled: true,
      apiAccessStatus: "API_ENABLED_UNLISTED",
    },
    live,
  ));

  const allVehicles = liveVehicles.map((vehicle) => vehicle.portalVehicle);
  const allTelemetry = liveVehicles
    .map((vehicle) => telemetryFromLive(vehicle.rawLive, vehicle.portalVehicle))
    .filter(Boolean);
  const summary = statusSummary(allVehicles);

  return {
    source: EICHER_SOURCE,
    fetchedAt,
    vehicles: allVehicles,
    telemetry: allTelemetry,
    summary: {
      ...summary,
      apiRecords: records.length,
      telemetryRecords: allTelemetry.length,
    },
    registry: eicherRegistrySummary(),
    integration: {
      id: "live-integration-eicher",
      company: "Eicher",
      sourceType: "API",
      status: options.integrationStatus || "connected",
      lastSyncAt: allTelemetry.length ? fetchedAt : null,
      nextSyncAt: new Date(Date.now() + DEFAULT_CACHE_MS).toISOString(),
      recordsSyncedToday: allTelemetry.length,
      mappedColumnsCount: fieldsReceived.length,
      unmappedColumnsCount: 0,
    },
    meta: {
      tokenEndpoint: TOKEN_URL,
      locationEndpoint: LOCATION_URL,
      fieldsReceived,
      rawRecordCount: records.length,
      lastSuccessfulUpdate: allTelemetry.length ? fetchedAt : null,
      apiErrors: [],
    },
  };
}

function registryOnlySnapshot(options = {}) {
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  const vehicles = [];
  return {
    source: EICHER_SOURCE,
    fetchedAt,
    vehicles,
    telemetry: [],
    summary: {
      ...statusSummary(vehicles),
      apiRecords: 0,
      telemetryRecords: 0,
    },
    registry: eicherRegistrySummary(),
    integration: {
      id: "live-integration-eicher",
      company: "Eicher",
      sourceType: "API",
      status: options.status || "not_configured",
      lastSyncAt: null,
      nextSyncAt: null,
      recordsSyncedToday: 0,
      mappedColumnsCount: 0,
      unmappedColumnsCount: 0,
      errorMessage: options.errorMessage || null,
    },
    meta: {
      tokenEndpoint: TOKEN_URL,
      locationEndpoint: LOCATION_URL,
      fieldsReceived: [],
      rawRecordCount: 0,
      lastSuccessfulUpdate: null,
      apiErrors: options.apiErrors || [],
    },
  };
}

function markSnapshotDelayed(snapshot, fetchedAt, error) {
  return {
    ...snapshot,
    fetchedAt,
    integration: {
      ...snapshot.integration,
      status: "delayed",
      errorMessage: "Eicher live API is temporarily unavailable; showing last successful data.",
    },
    meta: {
      ...snapshot.meta,
      apiErrors: [publicErrorMessage(error)],
      cacheFallback: true,
      staleFallbackAt: fetchedAt,
    },
  };
}

function vehicleFromRegistryEntry(entry, live) {
  const vehicleNumber = live?.registrationNumber || entry.registrationNumber || entry.vin;
  const apiAccessStatus = live?.apiAccessStatus || entry.apiAccessStatus;
  const portalVehicle = {
    id: `eicher-vecv-${entry.vin}`,
    vehicleNumber,
    source: EICHER_SOURCE,
    assetCategory: "Truck",
    assetType: "Truck",
    company: "Eicher",
    modelNumber: null,
    capacityM3: null,
    fuelMeasurementUnit: "Unknown",
    trackerProvider: apiAccessStatus === "API_ACCESS_PENDING"
      ? "Eicher VECV (API access pending)"
      : "Eicher VECV",
    trackerId: entry.vin,
    siteId: null,
    siteName: null,
    contractType: null,
    status: live?.status || "unknown",
    commissioningDate: null,
    fuelTankCapacityLitres: null,
    standardFuelNorm: null,
    active: true,
  };
  return { portalVehicle, rawLive: live ? { ...live, apiAccessStatus } : null };
}

function telemetryFromLive(live, vehicle) {
  if (!live) return null;
  return {
    id: `eicher-live-${vehicle.trackerId}-${new Date(live.eventTime).getTime()}`,
    source: EICHER_SOURCE,
    vehicleId: vehicle.id,
    vehicleNumber: vehicle.vehicleNumber,
    driverId: null,
    driverName: null,
    driverMobile: null,
    trackerId: vehicle.trackerId,
    timestamp: live.eventTime,
    date: live.eventTime.slice(0, 10),
    shift: "UNKNOWN",
    siteId: null,
    siteName: null,
    assetCategory: vehicle.assetCategory,
    assetType: vehicle.assetType,
    company: vehicle.company,
    modelNumber: vehicle.modelNumber,
    location: live.currentLocation,
    odometerKm: live.odometerKm,
    distanceKm: null,
    engineHours: null,
    runningHours: null,
    idleHours: null,
    stoppedHours: null,
    offlineHours: live.status === "offline" && live.dataAgeSeconds !== null ? live.dataAgeSeconds / 3600 : 0,
    availableHours: null,
    fuelConsumedLitres: null,
    fuelFilledLitres: null,
    fuelLevelLitres: null,
    fuelLevelPercent: null,
    trips: null,
    capacityM3: null,
    productionM3: null,
    leadKm: null,
    status: live.status,
    truckEfficiencyKmPerLitre: null,
    hemmFuelRateLitrePerHour: null,
    fuelPerTrip: null,
    fuelPerM3: null,
    idlePercentage: null,
    runningPercentage: null,
    utilizationPercentage: null,
    rawMetrics: {
      sourceName: "Eicher VECV",
      apiAccessStatus: live.apiAccessStatus,
      vin: live.vin,
      chassisNumber: live.chassisNumber,
      registrationNumber: live.registrationNumber,
      deviceId: live.deviceId,
      eventType: "EICHER_LOCATION",
      eventTime: live.eventTime,
      receivedTime: live.fetchedAt,
      gpsTimestamp: live.gpsTimestamp,
      positionTime: live.gpsTimestamp,
      lastSuccessfulUpdate: live.fetchedAt,
      sourceLastUpdated: live.sourceLastUpdated,
      sourceEpochTime: live.sourceEpochTime,
      vehicleStatus: live.vehicleStatus,
      statusText: live.statusText,
      ignitionState: live.ignitionState,
      movementState: live.movementState,
      speedKph: live.speedKph,
      latitude: live.latitude,
      longitude: live.longitude,
      heading: live.heading,
      vehicleDirection: live.heading,
      odometerKm: live.odometerKm,
      lifetimeOdometerKm: live.odometerKm,
      currentLocation: live.currentLocation,
      freshnessState: live.freshnessState,
      freshnessAgeMinutes: live.ageMinutes,
      dataAgeSeconds: live.dataAgeSeconds,
      isStale: live.freshnessState === "stale",
      eicherFieldsReceived: live.fieldsReceived,
    },
  };
}

function normalizeLocationRecord(record, options) {
  const chassisNumber = stringField(record, [
    "vin",
    "VIN",
    "chassisNo",
    "chassisNumber",
    "chassis",
    "vehicleChassisNo",
    "vehicleChassisNumber",
  ]);
  const vin = chassisNumber?.toUpperCase() || "";
  const registrationNumber = stringField(record, [
    "registrationNumber",
    "registrationNo",
    "regNo",
    "vehicleNumber",
    "vehicleNo",
    "vehicleRegNo",
    "regnNo",
  ]);
  const latitude = numericField(record, ["latitude", "Latitude", "lat", "Lat", "LATITUDE"]);
  const longitude = numericField(record, ["longitude", "Longitude", "lng", "Lng", "lon", "Lon", "long", "Long", "LONGITUDE"]);
  const speedKph = numericField(record, ["speedKph", "vehicleSpeed", "speed", "Speed", "GPS_SPEED"]);
  const heading = numericField(record, ["heading", "Heading", "direction", "vehicleDirection", "course"]);
  const odometerKm = numericField(record, ["odometerKm", "odometer", "Odometer", "totalOdometer", "distanceTravelled"]);
  const deviceId = stringField(record, ["deviceId", "deviceID", "device_id", "imei", "IMEI"]);
  const sourceLastUpdated = stringOrNumberField(record, ["lastUpdated", "last_update", "lastUpdate"]);
  const sourceEpochTime = stringOrNumberField(record, ["epochTime", "epoch_time"]);
  const gpsTimestamp = parseTimestamp(stringOrNumberField(record, [
    "gpsTimestamp",
    "gpsTime",
    "GPS_TIMESTAMP",
    "lastUpdateTime",
    "lastUpdated",
    "epochTime",
    "timestamp",
    "Timestamp",
    "packetTime",
    "serverTime",
    "eventTime",
    "dateTime",
    "updatedTime",
    "createdDateTime",
  ]));
  const eventTime = gpsTimestamp || options.fetchedAt;
  const vehicleStatus = stringField(record, ["vehicleStatus", "status", "currentStatus", "movementStatus", "runningStatus"]);
  const ignitionState = normalizeIgnition(stringOrNumberField(record, [
    "ignitionState",
    "ignitionStatus",
    "ignition",
    "Ignition",
    "vehicleIgnition",
    "engineStatus",
  ]));
  const movementState = normalizeMovement(vehicleStatus, ignitionState, speedKph);
  const ageMinutes = Math.max(0, (new Date(options.fetchedAt).getTime() - new Date(eventTime).getTime()) / 60000);
  const freshnessState = Number.isFinite(ageMinutes)
    ? ageMinutes > 120 ? "stale" : ageMinutes > 30 ? "delayed" : "fresh"
    : "no-data";
  const currentLocation = stringField(record, [
    "currentLocation",
    "location",
    "Location",
    "address",
    "placeName",
    "nearestLocation",
  ]) || coordinateLocation(latitude, longitude);

  return {
    vin,
    chassisNumber,
    registrationNumber,
    deviceId,
    fetchedAt: options.fetchedAt,
    eventTime,
    gpsTimestamp,
    sourceLastUpdated,
    sourceEpochTime,
    latitude,
    longitude,
    speedKph,
    heading,
    odometerKm,
    vehicleStatus,
    statusText: vehicleStatus,
    ignitionState,
    movementState,
    status: portalStatus(movementState, freshnessState),
    currentLocation,
    freshnessState,
    ageMinutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
    dataAgeSeconds: Number.isFinite(ageMinutes) ? ageMinutes * 60 : null,
    fieldsReceived: Object.keys(record || {}).sort(),
  };
}

function extractLocationRecords(payload) {
  if (Array.isArray(payload)) return payload.filter(isPlainObject);
  if (!isPlainObject(payload)) return [];

  const preferredKeys = [
    "locationData",
    "vehicles",
    "vehicleData",
    "vehicleDetails",
    "locations",
    "location",
    "liveData",
    "data",
    "records",
    "result",
    "response",
  ];
  for (const key of preferredKeys) {
    const value = payload[key];
    if (Array.isArray(value) && value.some(isPlainObject)) {
      return value.filter(isPlainObject);
    }
    if (isPlainObject(value)) {
      const nested = extractLocationRecords(value);
      if (nested.length) return nested;
    }
  }

  const candidates = [];
  collectObjectArrays(payload, candidates, 0);
  candidates.sort((left, right) => right.length - left.length);
  return candidates[0] || [];
}

function collectObjectArrays(value, candidates, depth) {
  if (depth > 4 || !value) return;
  if (Array.isArray(value)) {
    const records = value.filter(isPlainObject);
    if (records.length) candidates.push(records);
    records.forEach((record) => collectObjectArrays(record, candidates, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach((entry) => collectObjectArrays(entry, candidates, depth + 1));
  }
}

function collectTopLevelFields(records) {
  return [...new Set(records.flatMap((record) => Object.keys(record || {})))].sort();
}

function statusSummary(vehicles) {
  return vehicles.reduce((summary, vehicle) => {
    summary.total += 1;
    if (vehicle.status === "running") summary.running += 1;
    else if (vehicle.status === "idle") summary.idle += 1;
    else if (vehicle.status === "stopped") summary.stopped += 1;
    else if (vehicle.status === "offline") summary.offline += 1;
    else summary.unknown += 1;
    return summary;
  }, {
    total: 0,
    running: 0,
    idle: 0,
    stopped: 0,
    offline: 0,
    unknown: 0,
  });
}

function portalStatus(movementState, freshnessState) {
  if (freshnessState === "stale") return "offline";
  if (movementState === "MOVING") return "running";
  if (movementState === "STANDSTILL") return "idle";
  if (movementState === "PARKED" || movementState === "STOPPED_UNKNOWN_IGNITION") return "stopped";
  if (movementState === "OFFLINE") return "offline";
  return "unknown";
}

function normalizeMovement(statusText, ignitionState, speedKph) {
  const text = String(statusText || "").trim().toUpperCase();
  if (text.includes("RUN") || text.includes("MOV") || Number(speedKph || 0) >= RUNNING_SPEED_KPH) return "MOVING";
  if (text.includes("IDLE")) return "STANDSTILL";
  if (text.includes("STOP") || text.includes("PARK")) return ignitionState === "ON" ? "STANDSTILL" : "PARKED";
  if (text.includes("OFFLINE") || text.includes("NO DATA")) return "OFFLINE";
  if (ignitionState === "ON" && Number(speedKph || 0) < RUNNING_SPEED_KPH) return "STANDSTILL";
  if (ignitionState === "OFF") return "PARKED";
  return "UNKNOWN";
}

function normalizeIgnition(value) {
  if (value === null || value === undefined || value === "") return "UNKNOWN";
  const text = String(value).trim().toUpperCase();
  if (["1", "TRUE", "YES", "ON", "IGNITION ON"].includes(text) || text.includes("ON")) return "ON";
  if (["0", "FALSE", "NO", "OFF", "IGNITION OFF"].includes(text) || text.includes("OFF")) return "OFF";
  return "UNKNOWN";
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const compact = parseCompactTimestamp(String(Math.trunc(value)));
    if (compact) return compact;
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return plausibleTimestamp(date);
  }

  const text = String(value).trim();
  if (!text) return null;
  const compact = parseCompactTimestamp(text);
  if (compact) return compact;
  if (/^\d{10,13}$/.test(text)) return parseTimestamp(Number(text));
  const indian = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (indian) {
    return parseKolkataTimestamp(`${indian[3]}-${indian[2].padStart(2, "0")}-${indian[1].padStart(2, "0")} ${indian[4].padStart(2, "0")}:${indian[5]}:${indian[6] || "00"}`);
  }
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    return parseKolkataTimestamp(`${local[1]}-${local[2]}-${local[3]} ${local[4]}:${local[5]}:${local[6] || "00"}`);
  }
  const parsed = new Date(text);
  return plausibleTimestamp(parsed);
}

function parseCompactTimestamp(text) {
  const compact = String(text || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!compact) return null;
  const year = Number(compact[1]);
  const month = Number(compact[2]);
  const day = Number(compact[3]);
  const hour = Number(compact[4]);
  const minute = Number(compact[5]);
  const second = Number(compact[6]);
  if (
    year < 2000
    || year > 2100
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    return null;
  }
  return parseKolkataTimestamp(`${compact[1]}-${compact[2]}-${compact[3]} ${compact[4]}:${compact[5]}:${compact[6]}`);
}

function plausibleTimestamp(date) {
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? date.toISOString() : null;
}

function parseKolkataTimestamp(value) {
  const parsed = new Date(`${value.replace(" ", "T")}+05:30`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function coordinateLocation(latitude, longitude) {
  return latitude !== null && longitude !== null ? `${latitude}, ${longitude}` : null;
}

function stringOrNumberField(record, keys) {
  for (const key of keys) {
    const value = deepValue(record, key);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function stringField(record, keys) {
  const value = stringOrNumberField(record, keys);
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function numericField(record, keys) {
  const value = stringOrNumberField(record, keys);
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function deepValue(record, key) {
  if (!record || typeof record !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  const normalizedKey = key.toLowerCase();
  const direct = Object.keys(record).find((candidate) => candidate.toLowerCase() === normalizedKey);
  if (direct) return record[direct];
  for (const value of Object.values(record)) {
    if (!isPlainObject(value)) continue;
    const nested = deepValue(value, key);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function publicErrorMessage(error) {
  if (error?.kind === "configuration") return "Eicher API key is not configured.";
  if (error?.kind === "authentication") return "Eicher API authorization failed. Check the backend API key.";
  if (error?.kind === "timeout") return "Eicher API timed out.";
  if (error?.kind === "network") return "Eicher API network request failed.";
  if (error?.kind === "rate_limit") return "Eicher API rate limit was reached.";
  return "Eicher live data is temporarily unavailable.";
}

module.exports = {
  EICHER_SOURCE,
  EicherApiError,
  LOCATION_URL,
  TOKEN_URL,
  extractBearerToken,
  extractLocationRecords,
  getBearerToken,
  getEicherSnapshot,
  hasEicherConfiguration,
  normalizeEicherLocationPayload,
  parseTimestamp,
  resetBearerToken,
  resetEicherCaches,
};
