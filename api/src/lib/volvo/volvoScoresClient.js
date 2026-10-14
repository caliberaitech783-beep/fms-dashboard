const { guardedVolvoFetch } = require("./volvoRequestGate");
const { randomUUID } = require("node:crypto");
const { safeErrorMessage } = require("../tracking/masking");

const DEFAULT_SCORES_URL = "https://api.volvotrucks.com/score/scores";
const DEFAULT_ACCEPT_SCORES = "application/x.volvogroup.com.scores.v2.0+json; UTF-8";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const NEXT_LINK_QUERY_KEYS = new Set([
  "lastDriverId",
  "contentFilter",
  "starttime",
  "stoptime",
  "driverIdType",
]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiredValue(name, value) {
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

function scoreEnvelope(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  return root.vuScoreResponse
    || root.VuScoreResponse
    || root.scoreResponse
    || root.ScoreResponse
    || root;
}

function parseScorePage(payload) {
  const wrapped = scoreEnvelope(payload);
  const drivers = wrapped.drivers || wrapped.Drivers;
  if (!Array.isArray(drivers)) {
    throw Object.assign(new Error("Volvo Scores response has an unexpected structure."), { statusCode: 502 });
  }
  return {
    startTime: wrapped.startTime || wrapped.StartTime || null,
    stopTime: wrapped.stopTime || wrapped.StopTime || null,
    fleet: wrapped.fleet || wrapped.Fleet || null,
    drivers,
    moreDataAvailable: Boolean(wrapped.moreDataAvailable ?? wrapped.MoreDataAvailable ?? false),
    moreDataAvailableLink: wrapped.moreDataAvailableLink || wrapped.MoreDataAvailableLink || null,
    requestServerDateTime: wrapped.requestServerDateTime || wrapped.RequestServerDateTime || null,
  };
}

function driverIdentifier(record) {
  const driverId = record?.driverId || record?.DriverId || {};
  const oem = driverId.oemDriverIdentification || driverId.OemDriverIdentification || {};
  const tacho = driverId.tachoDriverIdentification || driverId.TachoDriverIdentification || {};
  const identifier = oem.oemDriverIdentification
    || oem.OemDriverIdentification
    || tacho.tachoDriverIdentification
    || tacho.TachoDriverIdentification
    || driverId.driverId
    || driverId.DriverId
    || null;
  return identifier === null || identifier === undefined ? null : String(identifier).trim() || null;
}

function nextPageQuery(link, endpoint) {
  if (!link) return {};
  let url;
  try {
    url = new URL(link, endpoint);
  } catch {
    throw Object.assign(new Error("Volvo Scores pagination link is invalid."), { statusCode: 502 });
  }
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([name]) => NEXT_LINK_QUERY_KEYS.has(name)),
  );
}

class VolvoScoresClient {
  constructor(options = {}) {
    this.scoresUrl = requiredValue("VOLVO_SCORES_URL", options.scoresUrl);
    this.username = requiredValue("VOLVO_SCORES_API_USERNAME", options.username);
    this.password = requiredValue("VOLVO_SCORES_API_PASSWORD", options.password);
    this.accept = requiredValue("VOLVO_ACCEPT_SCORES", options.accept);
    this.driverIdType = String(options.driverIdType || "pin").trim() || "pin";
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs || 30_000);
    this.retries = Number(options.retries ?? 2);
    this.maxPages = Math.max(1, Number(options.maxPages || 100));
    this.requestIdFactory = options.requestIdFactory || randomUUID;
    this.sleepFn = options.sleepFn || sleep;
    this.randomFn = options.randomFn || Math.random;
    if (typeof this.fetchFn !== "function") throw new Error("A fetch implementation is required.");
  }

  async request(query) {
    const url = new URL(this.scoresUrl);
    for (const [name, value] of Object.entries(query || {})) {
      if (value !== null && value !== undefined && value !== "") url.searchParams.set(name, String(value));
    }
    const authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      let timeout;
      const onRequestStart = () => { timeout = setTimeout(() => controller.abort(), this.timeoutMs); };
      if (!this.fetchFn.queuesRequests) onRequestStart();
      try {
        const response = await this.fetchFn(url, {
          method: "GET",
          headers: {
            Accept: this.accept,
            Authorization: authorization,
            "Cache-Control": "no-cache",
          },
          onRequestStart, signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const error = Object.assign(new Error(`Volvo Scores API request failed with status ${response.status}.`), {
            statusCode: response.status,
          });
          if (attempt < this.retries && RETRYABLE_STATUS_CODES.has(response.status)) {
            lastError = error;
            await this.sleepFn(retryAfterMilliseconds(response)
              ?? Math.round(500 * (2 ** attempt) + this.randomFn() * 250));
            continue;
          }
          throw error;
        }
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          throw Object.assign(new Error("Volvo Scores API returned invalid JSON."), { statusCode: 502 });
        }
      } catch (error) {
        const safeMessage = safeErrorMessage(error, [this.username, this.password, authorization]);
        const safeError = Object.assign(new Error(safeMessage || "Volvo Scores API request failed."), {
          statusCode: error.statusCode || (error.name === "AbortError" ? 504 : 502),
        });
        if (attempt < this.retries && (!error.statusCode || RETRYABLE_STATUS_CODES.has(error.statusCode))) {
          lastError = safeError;
          await this.sleepFn(Math.round(500 * (2 ** attempt) + this.randomFn() * 250));
          continue;
        }
        throw safeError;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError || Object.assign(new Error("Volvo Scores API request failed."), { statusCode: 502 });
  }

  async fetchScores(options = {}) {
    const startTime = requiredValue("starttime", options.startTime);
    const stopTime = requiredValue("stoptime", options.stopTime);
    const driverIdType = String(options.driverIdType || this.driverIdType).trim() || this.driverIdType;
    const maxPages = Math.max(1, Number(options.maxPages || this.maxPages));
    const driversById = new Map();
    const anonymousDrivers = [];
    const seenCursors = new Set();
    let fleet = null;
    let requestServerDateTime = null;
    let responseStartTime = startTime;
    let responseStopTime = stopTime;
    let pageQuery = {};

    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await this.request({
        requestId: this.requestIdFactory(),
        starttime: startTime,
        stoptime: stopTime,
        driverIdType,
        ...pageQuery,
      });
      const parsed = parseScorePage(payload);
      fleet = parsed.fleet || fleet;
      requestServerDateTime = parsed.requestServerDateTime || requestServerDateTime;
      responseStartTime = parsed.startTime || responseStartTime;
      responseStopTime = parsed.stopTime || responseStopTime;
      for (const driver of parsed.drivers) {
        const identifier = driverIdentifier(driver);
        if (identifier) driversById.set(identifier, driver);
        else anonymousDrivers.push(driver);
      }

      if (!parsed.moreDataAvailable) {
        return {
          startTime: responseStartTime,
          stopTime: responseStopTime,
          fleet,
          drivers: [...driversById.values(), ...anonymousDrivers],
          moreDataAvailable: false,
          moreDataAvailableLink: null,
          requestServerDateTime,
          pagesFetched: page,
        };
      }

      const nextQuery = nextPageQuery(parsed.moreDataAvailableLink, this.scoresUrl);
      if (!nextQuery.lastDriverId) {
        nextQuery.lastDriverId = driverIdentifier(parsed.drivers.at(-1));
      }
      if (!nextQuery.lastDriverId) {
        throw Object.assign(new Error("Volvo Scores response did not provide a pagination cursor."), { statusCode: 502 });
      }
      const cursor = String(nextQuery.lastDriverId);
      if (seenCursors.has(cursor)) {
        throw Object.assign(new Error("Volvo Scores pagination cursor repeated."), { statusCode: 502 });
      }
      seenCursors.add(cursor);
      pageQuery = nextQuery;
    }

    throw Object.assign(new Error("Volvo Scores response exceeded the configured page limit."), { statusCode: 502 });
  }
}

function createVolvoScoresClientFromEnv(env = process.env, options = {}) {
  return new VolvoScoresClient({
    scoresUrl: env.VOLVO_SCORES_URL || DEFAULT_SCORES_URL,
    username: env.VOLVO_SCORES_API_USERNAME
      || env.VOLVO_DRIVER_API_USERNAME
      || env.VOLVO_API_USERNAME
      || env.VOLVO_RFMS_USERNAME,
    password: env.VOLVO_SCORES_API_PASSWORD
      || env.VOLVO_DRIVER_API_PASSWORD
      || env.VOLVO_API_PASSWORD
      || env.VOLVO_RFMS_PASSWORD,
    accept: env.VOLVO_ACCEPT_SCORES || DEFAULT_ACCEPT_SCORES,
    driverIdType: env.VOLVO_SCORES_DRIVER_ID_TYPE || "pin",
    timeoutMs: env.VOLVO_SCORES_REQUEST_TIMEOUT_MS || env.VOLVO_REQUEST_TIMEOUT_MS || options.timeoutMs,
    retries: env.VOLVO_SCORES_REQUEST_RETRIES ?? options.retries,
    maxPages: env.VOLVO_SCORES_MAX_PAGES || options.maxPages,
    ...options,
    fetchFn: guardedVolvoFetch(options.fetchFn || globalThis.fetch),
  });
}

module.exports = {
  DEFAULT_ACCEPT_SCORES,
  DEFAULT_SCORES_URL,
  VolvoScoresClient,
  createVolvoScoresClientFromEnv,
  driverIdentifier,
  nextPageQuery,
  parseScorePage,
};
