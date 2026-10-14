const { guardedVolvoFetch } = require("./volvoRequestGate");
const { randomUUID } = require("node:crypto");
const { safeErrorMessage } = require("../tracking/masking");
const {
  deduplicateEvents,
  eventReceivedTime,
  eventVin,
  parseVehicleStatusResponse,
} = require("./vehicleStatusNormalizer");

const DEFAULT_ACCEPT_VEHICLES = "application/x.volvogroup.com.vehicles.v1.0+json; UTF-8";
const DEFAULT_ACCEPT_POSITIONS = "application/x.volvogroup.com.vehiclepositions.v1.0+json; UTF-8";
const DEFAULT_ACCEPT_STATUSES = "application/x.volvogroup.com.vehiclestatuses.v1.0+json; UTF-8";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const GROUP_ENV_NAMES = [
  "VOLVO_TOKEN_URL",
  "VOLVO_CLIENT_ID",
  "VOLVO_CLIENT_SECRET",
  "VOLVO_SCOPE",
  "VOLVO_VEHICLES_URL",
  "VOLVO_POSITIONS_URL",
  "VOLVO_STATUSES_URL",
];

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireValue(name, value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw Object.assign(new Error(`${name} is not configured.`), { statusCode: 503 });
  }
  return normalized;
}

function retryAfterMilliseconds(response) {
  const value = response?.headers?.get?.("retry-after")
    || response?.headers?.get?.("x-ratelimit-reset");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? Math.max(0, date.getTime() - Date.now()) : null;
}

function parsedTime(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function newestBy(items, valueSelector) {
  const newest = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const vin = eventVin(item);
    if (!vin) continue;
    const current = newest.get(vin);
    const candidateTime = parsedTime(valueSelector(item))?.getTime() ?? Number.NEGATIVE_INFINITY;
    const currentTime = parsedTime(current && valueSelector(current))?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (!current || candidateTime >= currentTime) newest.set(vin, item);
  }
  return [...newest.values()];
}

function nextReceivedCursor(records) {
  const newest = records
    .map((record) => parsedTime(record?.receivedDateTime || record?.ReceivedDateTime))
    .filter(Boolean)
    .sort((left, right) => right - left)[0] || null;
  if (!newest) return null;
  return new Date(newest.getTime() + 1000).toISOString();
}

function parseVehiclePage(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const wrapped = root.vehicleResponse || root.VehicleResponse || root;
  const vehicles = wrapped.vehicles || wrapped.Vehicles || wrapped.Vehicle || root.Vehicle;
  const moreDataAvailable = root.moreDataAvailable ?? root.MoreDataAvailable
    ?? wrapped.moreDataAvailable ?? wrapped.MoreDataAvailable;
  if (!Array.isArray(vehicles) || typeof moreDataAvailable !== "boolean") {
    throw Object.assign(new Error("Volvo vehicle response has an unexpected structure."), { statusCode: 502 });
  }
  return { vehicles, moreDataAvailable };
}

function parsePositionPage(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const wrapped = root.vehiclePositionResponse || root.VehiclePositionResponse || root;
  const positions = wrapped.vehiclePositions || wrapped.VehiclePositions
    || wrapped.VehiclePosition || root.vehiclePositions || root.VehiclePosition;
  const moreDataAvailable = root.moreDataAvailable ?? root.MoreDataAvailable
    ?? wrapped.moreDataAvailable ?? wrapped.MoreDataAvailable;
  const requestServerDateTime = root.requestServerDateTime || root.RequestServerDateTime
    || wrapped.requestServerDateTime || wrapped.RequestServerDateTime || null;
  if (!Array.isArray(positions) || typeof moreDataAvailable !== "boolean") {
    throw Object.assign(new Error("Volvo position response has an unexpected structure."), { statusCode: 502 });
  }
  return { positions, moreDataAvailable, requestServerDateTime };
}

function positionToSnapshotEvent(position) {
  const vin = eventVin(position);
  if (!vin) return null;
  return {
    vin,
    triggerType: position.triggerType || position.TriggerType || { triggerType: "POSITION" },
    createdDateTime: position.createdDateTime || position.CreatedDateTime || null,
    receivedDateTime: position.receivedDateTime || position.ReceivedDateTime || null,
    snapshotData: {
      gnssPosition: position.gnssPosition || position.GnssPosition || position.GNSSPosition || null,
      wheelBasedSpeed: position.wheelBasedSpeed ?? position.WheelBasedSpeed ?? null,
      tachographSpeed: position.tachographSpeed ?? position.TachographSpeed ?? null,
    },
  };
}

function isVolvoGroupConfigured(env = process.env) {
  return GROUP_ENV_NAMES.some((name) => String(env[name] || "").trim());
}

class VolvoGroupClient {
  constructor(options = {}) {
    this.tokenUrl = requireValue("VOLVO_TOKEN_URL", options.tokenUrl);
    this.clientId = requireValue("VOLVO_CLIENT_ID", options.clientId);
    this.clientSecret = requireValue("VOLVO_CLIENT_SECRET", options.clientSecret);
    this.scope = requireValue("VOLVO_SCOPE", options.scope);
    this.vehiclesUrl = requireValue("VOLVO_VEHICLES_URL", options.vehiclesUrl);
    this.positionsUrl = requireValue("VOLVO_POSITIONS_URL", options.positionsUrl);
    this.statusesUrl = requireValue("VOLVO_STATUSES_URL", options.statusesUrl);
    this.acceptVehicles = requireValue("VOLVO_ACCEPT_VEHICLES", options.acceptVehicles);
    this.acceptPositions = requireValue("VOLVO_ACCEPT_POSITIONS", options.acceptPositions);
    this.acceptStatuses = requireValue("VOLVO_ACCEPT_STATUSES", options.acceptStatuses);
    this.apiKey = String(options.apiKey || "").trim();
    this.apiKeyHeader = String(options.apiKeyHeader || "").trim();
    this.tokenAuthMethod = String(options.tokenAuthMethod || "basic").trim().toLowerCase();
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs || 15_000);
    this.retries = Number(options.retries ?? 2);
    this.maxPages = Number(options.maxPages || 100);
    this.requestIdFactory = options.requestIdFactory || randomUUID;
    this.sleepFn = options.sleepFn || sleep;
    this.randomFn = options.randomFn || Math.random;
    this.nowFn = options.nowFn || Date.now;
    this.tokenCache = null;
    this.mode = "group-oauth";
    if (typeof this.fetchFn !== "function") throw new Error("A fetch implementation is required.");
    if (this.apiKey && !this.apiKeyHeader) {
      throw Object.assign(new Error("VOLVO_API_KEY_HEADER is required when VOLVO_API_KEY is configured."), { statusCode: 503 });
    }
  }

  invalidateToken() {
    this.tokenCache = null;
  }

  async accessToken(forceRefresh = false) {
    if (!forceRefresh && this.tokenCache && this.tokenCache.expiresAt > this.nowFn() + 60_000) {
      return this.tokenCache.token;
    }

    const body = new URLSearchParams({ grant_type: "client_credentials", scope: this.scope });
    const headers = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };
    if (this.tokenAuthMethod === "basic") {
      headers.Authorization = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
    } else if (this.tokenAuthMethod === "body") {
      body.set("client_id", this.clientId);
      body.set("client_secret", this.clientSecret);
    } else {
      throw Object.assign(new Error("VOLVO_TOKEN_AUTH_METHOD must be basic or body."), { statusCode: 503 });
    }

    const controller = new AbortController();
    let timeout;
    const onRequestStart = () => { timeout = setTimeout(() => controller.abort(), this.timeoutMs); };
    if (!this.fetchFn.queuesRequests) onRequestStart();
    try {
      const response = await this.fetchFn(this.tokenUrl, {
        method: "POST",
        headers,
        body: body.toString(),
        onRequestStart, signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw Object.assign(new Error(`Volvo OAuth token request failed with status ${response.status}.`), {
          statusCode: response.status,
        });
      }
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw Object.assign(new Error("Volvo OAuth returned invalid JSON."), { statusCode: 502 });
      }
      const accessToken = requireValue("Volvo OAuth access_token", payload.access_token);
      const tokenType = String(payload.token_type || "Bearer").trim();
      const expiresIn = Number(payload.expires_in || 3600);
      this.tokenCache = {
        token: `${tokenType} ${accessToken}`,
        expiresAt: this.nowFn() + Math.max(60, expiresIn) * 1000,
      };
      return this.tokenCache.token;
    } catch (error) {
      const masked = safeErrorMessage(error, [this.clientId, this.clientSecret]);
      throw Object.assign(new Error(masked || "Volvo OAuth token request failed."), {
        statusCode: error.statusCode || (error.name === "AbortError" ? 504 : 502),
          retryAfterMs: error.retryAfterMs,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async request(endpoint, query, accept) {
    const url = new URL(endpoint);
    for (const [name, value] of Object.entries(query || {})) {
      if (value !== null && value !== undefined && value !== "") url.searchParams.set(name, String(value));
    }
    url.searchParams.set("requestId", this.requestIdFactory());

    let refreshedAfter401 = false;
    let forceTokenRefresh = false;
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const authorization = await this.accessToken(forceTokenRefresh);
      forceTokenRefresh = false;
      const headers = { Accept: accept, Authorization: authorization, "Cache-Control": "no-cache" };
      if (this.apiKey) headers[this.apiKeyHeader] = this.apiKey;
      const controller = new AbortController();
      let timeout;
      const onRequestStart = () => { timeout = setTimeout(() => controller.abort(), this.timeoutMs); };
      if (!this.fetchFn.queuesRequests) onRequestStart();
      try {
        const response = await this.fetchFn(url, { method: "GET", headers, onRequestStart, signal: controller.signal });
        const text = await response.text();
        if (response.status === 401 && !refreshedAfter401) {
          this.invalidateToken();
          refreshedAfter401 = true;
          forceTokenRefresh = true;
          attempt -= 1;
          continue;
        }
        if (!response.ok) {
          const error = Object.assign(new Error(`Volvo API request failed with status ${response.status}.`), {
            statusCode: response.status,
          });
          if (attempt < this.retries && RETRYABLE_STATUS_CODES.has(response.status)) {
            lastError = error;
            await this.sleepFn(retryAfterMilliseconds(response)
              ?? Math.round(250 * (2 ** attempt) + this.randomFn() * 200));
            continue;
          }
          throw error;
        }
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          throw Object.assign(new Error("Volvo API returned invalid JSON."), { statusCode: 502 });
        }
      } catch (error) {
        const safeMessage = safeErrorMessage(error, [
          this.clientId,
          this.clientSecret,
          this.apiKey,
          authorization,
          this.tokenCache?.token,
        ]);
        const safeError = Object.assign(new Error(safeMessage || "Volvo API request failed."), {
          statusCode: error.statusCode || (error.name === "AbortError" ? 504 : 502),
          retryAfterMs: error.retryAfterMs,
        });
        if (error.statusCode === 429 && error.retryAfterMs) throw safeError;
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
    throw lastError || Object.assign(new Error("Volvo API request failed."), { statusCode: 502 });
  }

  async fetchAllVehicles() {
    const vehiclesByVin = new Map();
    const cursors = new Set();
    let lastVin = "";
    for (let pageCount = 1; pageCount <= this.maxPages; pageCount += 1) {
      const page = parseVehiclePage(await this.request(this.vehiclesUrl, { lastVin }, this.acceptVehicles));
      for (const vehicle of page.vehicles) {
        const vin = eventVin(vehicle);
        if (vin) vehiclesByVin.set(vin, vehicle);
      }
      if (!page.moreDataAvailable) return [...vehiclesByVin.values()];
      const nextLastVin = eventVin(page.vehicles.at(-1));
      if (!nextLastVin || cursors.has(nextLastVin)) {
        throw Object.assign(new Error("Volvo vehicle pagination did not advance."), { statusCode: 502 });
      }
      cursors.add(nextLastVin);
      lastVin = nextLastVin;
    }
    throw Object.assign(new Error("Volvo vehicle pagination exceeded the configured page limit."), { statusCode: 502 });
  }

  async fetchLatestVehiclePositionsBatch() {
    const positions = [];
    let starttime = "";
    let stoptime = "";
    let requestServerDateTime = null;
    const cursors = new Set();
    for (let pageCount = 1; pageCount <= this.maxPages; pageCount += 1) {
      const page = parsePositionPage(await this.request(this.positionsUrl, {
        datetype: "received",
        latestOnly: true,
        starttime,
        stoptime,
      }, this.acceptPositions));
      positions.push(...page.positions);
      requestServerDateTime = requestServerDateTime || page.requestServerDateTime;
      stoptime = stoptime || requestServerDateTime || "";
      if (!page.moreDataAvailable) {
        return {
          positions: newestBy(positions, (item) => (
            item?.gnssPosition?.positionDateTime
            || item?.GNSSPosition?.PositionDateTime
            || item?.createdDateTime
            || item?.CreatedDateTime
            || item?.receivedDateTime
            || item?.ReceivedDateTime
          )),
          requestServerDateTime,
          pageCount,
        };
      }
      const nextCursor = nextReceivedCursor(page.positions);
      if (!nextCursor || cursors.has(nextCursor)) {
        throw Object.assign(new Error("Volvo position pagination did not advance."), { statusCode: 502 });
      }
      cursors.add(nextCursor);
      starttime = nextCursor;
    }
    throw Object.assign(new Error("Volvo position pagination exceeded the configured page limit."), { statusCode: 502 });
  }

  async fetchLatestVehiclePositions() {
    return (await this.fetchLatestVehiclePositionsBatch()).positions;
  }

  async fetchLatestVehicleStatusBatch(options = {}) {
    const statuses = [];
    const cursors = new Set();
    let lastVin = "";
    let requestServerDateTime = null;
    for (let pageCount = 1; pageCount <= this.maxPages; pageCount += 1) {
      const parsed = parseVehicleStatusResponse(await this.request(this.statusesUrl, {
        datetype: "received",
        latestOnly: true,
        contentFilter: options.contentFilter,
        lastVin,
      }, this.acceptStatuses));
      statuses.push(...parsed.events);
      requestServerDateTime = requestServerDateTime || parsed.requestServerDateTime;
      if (!parsed.moreDataAvailable) {
        return {
          events: newestBy(statuses, (item) => item?.createdDateTime || item?.CreatedDateTime
            || item?.receivedDateTime || item?.ReceivedDateTime),
          requestServerDateTime,
          moreDataAvailable: false,
          pageCount,
        };
      }
      const nextLastVin = eventVin(parsed.events.at(-1));
      if (!nextLastVin || cursors.has(nextLastVin)) {
        throw Object.assign(new Error("Volvo status pagination did not advance."), { statusCode: 502 });
      }
      cursors.add(nextLastVin);
      lastVin = nextLastVin;
    }
    throw Object.assign(new Error("Volvo status pagination exceeded the configured page limit."), { statusCode: 502 });
  }

  async fetchLatestVehicleStatuses(options = {}) {
    return (await this.fetchLatestVehicleStatusBatch(options)).events;
  }

  async fetchHistoricalVehicleStatusBatch(options = {}) {
    const startTime = requireValue("Volvo historical start time", options.startTime);
    const stopTime = requireValue("Volvo historical stop time", options.stopTime);
    const statuses = [];
    const cursors = new Set();
    let cursor = startTime;
    let requestServerDateTime = null;
    const maxPages = Number(options.maxPages || this.maxPages);
    for (let pageCount = 1; pageCount <= maxPages; pageCount += 1) {
      const parsed = parseVehicleStatusResponse(await this.request(this.statusesUrl, {
        datetype: "received",
        starttime: cursor,
        stoptime: stopTime,
        contentFilter: options.contentFilter || "ACCUMULATED",
        vin: options.vin,
      }, this.acceptStatuses));
      statuses.push(...parsed.events);
      requestServerDateTime = requestServerDateTime || parsed.requestServerDateTime;
      if (!parsed.moreDataAvailable) {
        return { events: deduplicateEvents(statuses), requestServerDateTime, moreDataAvailable: false, pageCount };
      }
      const nextCursor = nextReceivedCursor(parsed.events);
      if (!nextCursor || cursors.has(nextCursor)) {
        throw Object.assign(new Error("Volvo historical status pagination did not advance."), { statusCode: 502 });
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw Object.assign(new Error("Volvo historical status pagination exceeded the configured page limit."), { statusCode: 502 });
  }

  async fetchHistoricalVehicleStatuses(options = {}) {
    return (await this.fetchHistoricalVehicleStatusBatch(options)).events;
  }
}

function createVolvoGroupClientFromEnv(env = process.env, options = {}) {
  return new VolvoGroupClient({
    tokenUrl: env.VOLVO_TOKEN_URL,
    clientId: env.VOLVO_CLIENT_ID,
    clientSecret: env.VOLVO_CLIENT_SECRET,
    scope: env.VOLVO_SCOPE,
    vehiclesUrl: env.VOLVO_VEHICLES_URL,
    positionsUrl: env.VOLVO_POSITIONS_URL,
    statusesUrl: env.VOLVO_STATUSES_URL,
    acceptVehicles: env.VOLVO_ACCEPT_VEHICLES || DEFAULT_ACCEPT_VEHICLES,
    acceptPositions: env.VOLVO_ACCEPT_POSITIONS || DEFAULT_ACCEPT_POSITIONS,
    acceptStatuses: env.VOLVO_ACCEPT_STATUSES || DEFAULT_ACCEPT_STATUSES,
    apiKey: env.VOLVO_API_KEY,
    apiKeyHeader: env.VOLVO_API_KEY_HEADER,
    tokenAuthMethod: env.VOLVO_TOKEN_AUTH_METHOD || "basic",
    timeoutMs: env.VOLVO_REQUEST_TIMEOUT_MS || options.timeoutMs,
    maxPages: env.VOLVO_MAX_PAGES || options.maxPages,
    ...options,
    fetchFn: guardedVolvoFetch(options.fetchFn || globalThis.fetch),
  });
}

module.exports = {
  DEFAULT_ACCEPT_POSITIONS,
  DEFAULT_ACCEPT_STATUSES,
  DEFAULT_ACCEPT_VEHICLES,
  VolvoGroupClient,
  createVolvoGroupClientFromEnv,
  isVolvoGroupConfigured,
  parsePositionPage,
  parseVehiclePage,
  positionToSnapshotEvent,
};
