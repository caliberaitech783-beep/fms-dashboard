const { randomUUID } = require("node:crypto");
const { safeErrorMessage } = require("../tracking/masking");
const {
  deduplicateEvents,
  eventReceivedTime,
  eventVin,
  parseVehicleStatusResponse,
} = require("./vehicleStatusNormalizer");

const VEHICLES_ACCEPT = "application/vnd.fmsstandard.com.Vehicles.v2.1+json";
const VEHICLE_STATUSES_ACCEPT = "application/vnd.fmsstandard.com.vehiclestatuses.v2.1+json";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? Math.max(0, date.getTime() - Date.now()) : null;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function requireValue(name, value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw Object.assign(new Error(`${name} is not configured.`), { statusCode: 503 });
  }
  return normalized;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function hoursFromSeconds(value) {
  const seconds = finiteNumber(value);
  return seconds === null ? null : seconds / 3600;
}

function litresFromMillilitres(value) {
  const millilitres = finiteNumber(value);
  return millilitres === null ? null : millilitres / 1000;
}

function normalizeSiteAssignment(value) {
  if (typeof value === "string") {
    const siteName = value.trim();
    return siteName ? { siteId: null, siteName, contractType: null } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const siteId = String(value.siteId || "").trim() || null;
  const siteName = String(value.siteName || "").trim() || null;
  const contractType = ["Coal", "OB"].includes(value.contractType) ? value.contractType : null;
  return siteId || siteName ? { siteId, siteName, contractType } : null;
}

function parseVolvoSiteMap(value) {
  const source = String(value || "").trim();
  if (!source) {
    return new Map();
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw Object.assign(new Error("VOLVO_RFMS_SITE_MAP_JSON must be valid JSON."), { statusCode: 503 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("VOLVO_RFMS_SITE_MAP_JSON must be a JSON object."), { statusCode: 503 });
  }

  return new Map(Object.entries(parsed).flatMap(([key, assignment]) => {
    const normalizedKey = String(key || "").trim().toUpperCase();
    const normalizedAssignment = normalizeSiteAssignment(assignment);
    return normalizedKey && normalizedAssignment ? [[normalizedKey, normalizedAssignment]] : [];
  }));
}

function findVolvoSiteAssignment(payload, siteMap) {
  if (!(siteMap instanceof Map)) {
    return null;
  }
  const keys = [payload?.vin, payload?.VIN, payload?.customerVehicleName, payload?.CustomerVehicleName]
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
  return keys.map((key) => siteMap.get(key)).find(Boolean) || null;
}

function productionDateToIso(value) {
  const year = finiteNumber(firstDefined(value?.year, value?.Year));
  const month = finiteNumber(firstDefined(value?.month, value?.Month));
  const day = finiteNumber(firstDefined(value?.day, value?.Day));
  if (!year || !month || !day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

class VolvoRfmsClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.vehicleStatusUrl = String(options.vehicleStatusUrl || "").trim();
    this.username = String(options.username || "");
    this.password = String(options.password || "");
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs || 15_000);
    this.retries = Number(options.retries ?? 2);
    this.maxPages = Number(options.maxPages || 50);
    this.vehicleStatusAccept = String(options.vehicleStatusAccept || VEHICLE_STATUSES_ACCEPT).trim();
    this.requestIdFactory = options.requestIdFactory || randomUUID;
    this.sleepFn = options.sleepFn || sleep;
    this.randomFn = options.randomFn || Math.random;

    requireValue("VOLVO_RFMS_BASE_URL", this.baseUrl);
    requireValue("VOLVO_RFMS_USERNAME", this.username);
    requireValue("VOLVO_RFMS_PASSWORD", this.password);
    if (typeof this.fetchFn !== "function") {
      throw new Error("A fetch implementation is required.");
    }
  }

  async request(path, query = {}, accept = VEHICLES_ACCEPT) {
    const requestedPath = String(path);
    const url = new URL(/^https?:\/\//i.test(requestedPath)
      ? requestedPath
      : `${this.baseUrl}/${requestedPath.replace(/^\/+/, "")}`);
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(name, String(value));
      }
    }

    const basicAuthorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(url, {
          method: "GET",
          headers: {
            Accept: accept,
            Authorization: basicAuthorization,
            "Cache-Control": "no-cache",
          },
          signal: controller.signal,
        });
        const text = await response.text();

        if (!response.ok) {
          const error = Object.assign(new Error(`Volvo RFMS request failed with status ${response.status}.`), {
            statusCode: response.status,
          });
          if (attempt < this.retries && RETRYABLE_STATUS_CODES.has(response.status)) {
            lastError = error;
            const retryDelay = retryAfterMilliseconds(response)
              ?? (response.status === 429
                ? 5_000 * (attempt + 1)
                : Math.round(250 * (2 ** attempt) + this.randomFn() * 200));
            await this.sleepFn(retryDelay);
            continue;
          }
          throw error;
        }

        try {
          return text ? JSON.parse(text) : {};
        } catch {
          throw Object.assign(new Error("Volvo RFMS returned invalid JSON."), { statusCode: 502 });
        }
      } catch (error) {
        const maskedMessage = safeErrorMessage(error, [this.username, this.password, basicAuthorization]);
        const safeError = Object.assign(new Error(maskedMessage || "Volvo RFMS request failed."), {
          statusCode: error.statusCode || (error.name === "AbortError" ? 504 : 502),
        });
        if (attempt < this.retries && (!error.statusCode || RETRYABLE_STATUS_CODES.has(error.statusCode))) {
          lastError = safeError;
          await this.sleepFn(Math.round(250 * (2 ** attempt) + this.randomFn() * 200));
          continue;
        }
        throw safeError;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || Object.assign(new Error("Volvo RFMS request failed."), { statusCode: 502 });
  }

  async fetchVehiclePage(lastVin = "") {
    const payload = await this.request("vehicles", {
      requestId: this.requestIdFactory(),
      lastVin,
    });
    const vehicles = payload.Vehicle;

    if (!Array.isArray(vehicles) || typeof payload.MoreDataAvailable !== "boolean") {
      throw Object.assign(new Error("Volvo RFMS vehicle response has an unexpected structure."), { statusCode: 502 });
    }

    return {
      vehicles,
      moreDataAvailable: payload.MoreDataAvailable,
    };
  }

  async fetchAllVehicles() {
    const vehiclesByVin = new Map();
    const visitedLastVins = new Set();
    let lastVin = "";
    let moreDataAvailable = true;
    let pageCount = 0;

    while (moreDataAvailable) {
      pageCount += 1;
      if (pageCount > this.maxPages) {
        throw Object.assign(new Error("Volvo RFMS pagination exceeded the configured page limit."), { statusCode: 502 });
      }

      const page = await this.fetchVehiclePage(lastVin);
      for (const vehicle of page.vehicles) {
        const vin = String(vehicle?.VIN || "").trim();
        if (vin) {
          vehiclesByVin.set(vin, vehicle);
        }
      }

      moreDataAvailable = page.moreDataAvailable;
      if (!moreDataAvailable) {
        break;
      }

      const nextLastVin = String(page.vehicles.at(-1)?.VIN || "").trim();
      if (!nextLastVin || visitedLastVins.has(nextLastVin)) {
        throw Object.assign(new Error("Volvo RFMS pagination did not advance."), { statusCode: 502 });
      }
      visitedLastVins.add(nextLastVin);
      lastVin = nextLastVin;
    }

    return [...vehiclesByVin.values()];
  }

  async fetchVehicleStatusPage(lastVin = "", options = {}) {
    const payload = await this.request(this.vehicleStatusUrl || "vehiclestatuses", {
      requestId: this.requestIdFactory(),
      latestOnly: true,
      contentFilter: options.contentFilter === undefined ? "ACCUMULATED" : options.contentFilter,
      lastVin,
    }, this.vehicleStatusAccept);
    const parsed = parseVehicleStatusResponse(payload);

    return {
      statuses: parsed.events,
      moreDataAvailable: parsed.moreDataAvailable,
      requestServerDateTime: parsed.requestServerDateTime,
    };
  }

  async fetchLatestVehicleStatusBatch(options = {}) {
    const statuses = [];
    const visitedLastVins = new Set();
    let lastVin = "";
    let moreDataAvailable = true;
    let pageCount = 0;
    let requestServerDateTime = null;

    while (moreDataAvailable) {
      pageCount += 1;
      if (pageCount > this.maxPages) {
        throw Object.assign(new Error("Volvo RFMS status pagination exceeded the configured page limit."), { statusCode: 502 });
      }

      const page = await this.fetchVehicleStatusPage(lastVin, options);
      for (const status of page.statuses) {
        if (eventVin(status)) statuses.push(status);
      }
      requestServerDateTime = page.requestServerDateTime || requestServerDateTime;

      moreDataAvailable = page.moreDataAvailable;
      if (!moreDataAvailable) {
        break;
      }

      // Volvo can report more pages while omitting the status array. There is
      // no lastVin cursor in that response, so retain the valid pages and let
      // the historical bootstrap supply the remaining event detail.
      if (page.statuses.length === 0) {
        break;
      }

      const nextLastVin = eventVin(page.statuses.at(-1));
      if (!nextLastVin || visitedLastVins.has(nextLastVin)) {
        throw Object.assign(new Error("Volvo RFMS status pagination did not advance."), { statusCode: 502 });
      }
      visitedLastVins.add(nextLastVin);
      lastVin = nextLastVin;
    }

    return {
      events: deduplicateEvents(statuses),
      requestServerDateTime,
      moreDataAvailable,
      pageCount,
    };
  }

  async fetchLatestVehicleStatuses(options = {}) {
    const batch = await this.fetchLatestVehicleStatusBatch(options);
    const statusesByVin = new Map();
    for (const status of batch.events) statusesByVin.set(eventVin(status), status);
    return [...statusesByVin.values()];
  }

  async fetchHistoricalVehicleStatusBatch(options = {}) {
    const startTime = requireValue("Volvo RFMS historical start time", options.startTime);
    const stopTime = requireValue("Volvo RFMS historical stop time", options.stopTime);
    const stopTimestamp = new Date(stopTime);
    if (!Number.isFinite(stopTimestamp.getTime())) {
      throw Object.assign(new Error("Volvo RFMS historical stop time is invalid."), { statusCode: 400 });
    }

    const statuses = [];
    const pageLimit = Number(options.maxPages || this.maxPages);
    let cursor = startTime;
    let moreDataAvailable = true;
    let pageCount = 0;
    let requestServerDateTime = null;

    while (moreDataAvailable) {
      pageCount += 1;
      if (pageCount > pageLimit) {
        throw Object.assign(new Error("Volvo RFMS historical pagination exceeded the configured page limit."), { statusCode: 502 });
      }

      const payload = await this.request(this.vehicleStatusUrl || "vehiclestatuses", {
        requestId: this.requestIdFactory(),
        starttime: cursor,
        stoptime: stopTime,
        contentFilter: options.contentFilter === undefined ? "ACCUMULATED" : options.contentFilter,
        vin: options.vin,
      }, this.vehicleStatusAccept);
      const parsed = parseVehicleStatusResponse(payload);
      const pageStatuses = parsed.events;
      requestServerDateTime = parsed.requestServerDateTime || requestServerDateTime;

      statuses.push(...pageStatuses);

      moreDataAvailable = parsed.moreDataAvailable;
      if (!moreDataAvailable) {
        break;
      }

      const lastTimestamp = pageStatuses
        .map((status) => eventReceivedTime(status) ? new Date(eventReceivedTime(status)) : null)
        .filter((timestamp) => timestamp && Number.isFinite(timestamp.getTime()))
        .sort((left, right) => right - left)[0] || null;
      if (!lastTimestamp || !Number.isFinite(lastTimestamp.getTime())) {
        throw Object.assign(new Error("Volvo RFMS historical pagination did not provide a cursor."), { statusCode: 502 });
      }
      lastTimestamp.setUTCSeconds(lastTimestamp.getUTCSeconds() + 1);
      if (lastTimestamp >= stopTimestamp || lastTimestamp <= new Date(cursor)) {
        break;
      }
      cursor = lastTimestamp.toISOString();
    }

    return {
      events: deduplicateEvents(statuses),
      requestServerDateTime,
      moreDataAvailable: false,
      pageCount,
    };
  }

  async fetchHistoricalVehicleStatuses(options = {}) {
    return (await this.fetchHistoricalVehicleStatusBatch(options)).events;
  }
}

function getStatusTimestamp(payload) {
  const value = payload?.createdDateTime || payload?.CreatedDateTime
    || payload?.receivedDateTime || payload?.ReceivedDateTime;
  const timestamp = value ? new Date(value) : null;
  return timestamp && Number.isFinite(timestamp.getTime()) ? timestamp : null;
}

function classifyVolvoVehicleStatus(payload, options = {}) {
  const timestamp = getStatusTimestamp(payload);
  if (!timestamp) {
    return "offline";
  }

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const maxAgeMinutes = Number(options.maxAgeMinutes || 120);
  const ageMinutes = Math.max(0, (now.getTime() - timestamp.getTime()) / 60_000);
  if (ageMinutes > maxAgeMinutes) {
    return "offline";
  }

  const trigger = String(
    payload?.triggerType?.triggerType
    || payload?.TriggerType?.TriggerType
    || "",
  ).toUpperCase();
  if (["IGNITION_OFF", "ENGINE_OFF", "DRIVER_LOGOUT"].includes(trigger)) {
    return "stopped";
  }

  return "running";
}

function normalizeVolvoVehicle(payload, statusPayload = null, options = {}) {
  const vin = String(payload?.vin || payload?.VIN || "").trim();
  if (!vin) {
    throw new Error("Volvo RFMS vehicle is missing VIN.");
  }

  const type = String(payload.type || payload.Type || "").toUpperCase();
  const siteAssignment = normalizeSiteAssignment(options.siteAssignment);
  return {
    id: `volvo-rfms-${vin}`,
    vehicleNumber: String(payload.customerVehicleName || payload.CustomerVehicleName || vin).trim(),
    source: "VOLVO_RFMS_LIVE",
    assetCategory: type === "TRUCK" ? "Truck" : "Unknown",
    assetType: type === "TRUCK" ? "Truck" : "Other",
    company: "Volvo",
    modelNumber: String(payload.model || payload.Model || "").trim() || null,
    capacityM3: null,
    fuelMeasurementUnit: type === "TRUCK" ? "km/L" : "Unknown",
    trackerProvider: "Volvo RFMS",
    trackerId: vin,
    siteId: siteAssignment?.siteId || null,
    siteName: siteAssignment?.siteName || null,
    contractType: siteAssignment?.contractType || null,
    status: classifyVolvoVehicleStatus(statusPayload, options),
    commissioningDate: productionDateToIso(payload.productionDate || payload.ProductionDate),
    fuelTankCapacityLitres: null,
    standardFuelNorm: null,
    active: true,
  };
}

function normalizeVolvoTelemetry(vehicle, statusPayload) {
  const timestamp = getStatusTimestamp(statusPayload);
  if (!timestamp) {
    return null;
  }

  const accumulated = statusPayload.AccumulatedData || {};
  const driverId = statusPayload?.Driver1Id?.OemDriverIdentification?.OemDriverIdentification
    || statusPayload?.TriggerType?.DriverId?.OemDriverIdentification?.OemDriverIdentification
    || null;
  const distanceMetres = finiteNumber(statusPayload.HRTotalVehicleDistance);
  const odometerKm = distanceMetres === null ? null : distanceMetres / 1000;
  const lifetimeEngineHours = finiteNumber(statusPayload.TotalEngineHours);
  const lifetimeFuelLitres = litresFromMillilitres(statusPayload.EngineTotalFuelUsed);
  const lifetimeRunningHours = hoursFromSeconds(accumulated.DurationWheelbaseSpeedOverZero);
  const lifetimeIdleHours = hoursFromSeconds(accumulated.DurationWheelbaseSpeedZero);
  const lifetimeEfficiencyKmPerLitre = odometerKm !== null && lifetimeFuelLitres > 0
    ? odometerKm / lifetimeFuelLitres
    : null;
  const measuredMotionHours = (lifetimeRunningHours || 0) + (lifetimeIdleHours || 0);

  return {
    id: `volvo-rfms-status-${vehicle.trackerId}-${timestamp.getTime()}`,
    source: "VOLVO_RFMS_LIVE",
    vehicleId: vehicle.id,
    vehicleNumber: vehicle.vehicleNumber,
    driverId: driverId ? String(driverId) : null,
    driverName: null,
    driverMobile: null,
    trackerId: vehicle.trackerId,
    timestamp: timestamp.toISOString(),
    date: timestamp.toISOString().slice(0, 10),
    shift: "UNKNOWN",
    siteId: vehicle.siteId,
    siteName: vehicle.siteName,
    assetCategory: vehicle.assetCategory,
    assetType: vehicle.assetType,
    company: vehicle.company,
    modelNumber: vehicle.modelNumber,
    location: null,
    odometerKm,
    distanceKm: null,
    engineHours: null,
    runningHours: null,
    idleHours: null,
    stoppedHours: null,
    offlineHours: null,
    availableHours: null,
    fuelConsumedLitres: null,
    fuelFilledLitres: null,
    fuelLevelLitres: null,
    fuelLevelPercent: null,
    trips: null,
    capacityM3: vehicle.capacityM3,
    productionM3: null,
    leadKm: null,
    status: vehicle.status,
    truckEfficiencyKmPerLitre: null,
    hemmFuelRateLitrePerHour: null,
    fuelPerTrip: null,
    fuelPerM3: null,
    idlePercentage: null,
    runningPercentage: null,
    utilizationPercentage: null,
    rawMetrics: {
      triggerType: statusPayload?.TriggerType?.TriggerType || null,
      receivedDateTime: statusPayload?.ReceivedDateTime || null,
      createdDateTime: statusPayload?.CreatedDateTime || null,
      grossCombinationVehicleWeightKg: finiteNumber(statusPayload?.GrossCombinationVehicleWeight),
      lifetimeOdometerKm: odometerKm,
      lifetimeEngineHours,
      lifetimeFuelLitres,
      lifetimeRunningHours,
      lifetimeIdleHours,
      lifetimeEfficiencyKmPerLitre,
      lifetimeRunningPercentage: measuredMotionHours > 0
        ? (lifetimeRunningHours || 0) / measuredMotionHours * 100
        : null,
      lifetimeIdlePercentage: measuredMotionHours > 0
        ? (lifetimeIdleHours || 0) / measuredMotionHours * 100
        : null,
      durationSpeedOverZeroSeconds: accumulated.DurationWheelbaseSpeedOverZero ?? null,
      durationSpeedZeroSeconds: accumulated.DurationWheelbaseSpeedZero ?? null,
      fuelSpeedOverZeroLitres: litresFromMillilitres(accumulated.FuelWheelbaseSpeedOverZero),
      fuelSpeedZeroLitres: litresFromMillilitres(accumulated.FuelWheelbaseSpeedZero),
    },
  };
}

function createVolvoRfmsClientFromEnv(env = process.env, options = {}) {
  return new VolvoRfmsClient({
    baseUrl: env.VOLVO_RFMS_BASE_URL || "https://api.volvotrucks.com/rfms",
    vehicleStatusUrl: env.VOLVO_VEHICLE_STATUS_URL,
    vehicleStatusAccept: env.VOLVO_VEHICLE_STATUS_ACCEPT || VEHICLE_STATUSES_ACCEPT,
    username: env.VOLVO_API_USERNAME || env.VOLVO_RFMS_USERNAME,
    password: env.VOLVO_API_PASSWORD || env.VOLVO_RFMS_PASSWORD,
    timeoutMs: env.VOLVO_REQUEST_TIMEOUT_MS || env.VOLVO_RFMS_TIMEOUT_MS || options.timeoutMs,
    maxPages: env.VOLVO_RFMS_MAX_PAGES || options.maxPages,
    ...options,
  });
}

function createVolvoClientFromEnv(env = process.env, options = {}) {
  const {
    createVolvoGroupClientFromEnv,
    isVolvoGroupConfigured,
  } = require("./volvoGroupClient");
  return isVolvoGroupConfigured(env)
    ? createVolvoGroupClientFromEnv(env, options)
    : createVolvoRfmsClientFromEnv(env, options);
}

module.exports = {
  VEHICLES_ACCEPT,
  VEHICLE_STATUSES_ACCEPT,
  VolvoRfmsClient,
  classifyVolvoVehicleStatus,
  createVolvoClientFromEnv,
  createVolvoRfmsClientFromEnv,
  findVolvoSiteAssignment,
  normalizeVolvoTelemetry,
  normalizeVolvoVehicle,
  parseVolvoSiteMap,
};
