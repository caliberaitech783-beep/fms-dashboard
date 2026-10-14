const { guardedVolvoFetch } = require("./volvoRequestGate");
const { safeErrorMessage } = require("../tracking/masking");

const DEFAULT_DRIVER_BASE_URL = "https://api.volvotrucks.com/driver";
const DEFAULT_ACCEPT_DRIVERS = "application/x.volvogroup.com.drivers.v1.0+json; UTF-8";
const DEFAULT_ACCEPT_DRIVER_TIMES = "application/x.volvogroup.com.drivertimes.v1.1+json; UTF-8";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const NEXT_LINK_QUERY_KEYS = new Set(["driverIdType", "lastDriverId"]);

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

function parseDriverPage(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const wrapped = root.driverResponse || root.DriverResponse || root;
  const drivers = wrapped.drivers || wrapped.Drivers || root.drivers || root.Drivers;
  const moreDataAvailable = root.moreDataAvailable ?? root.MoreDataAvailable
    ?? wrapped.moreDataAvailable ?? wrapped.MoreDataAvailable ?? false;
  const moreDataAvailableLink = root.moreDataAvailableLink || root.MoreDataAvailableLink
    || wrapped.moreDataAvailableLink || wrapped.MoreDataAvailableLink || null;
  if (!Array.isArray(drivers)) {
    throw Object.assign(new Error("Volvo driver response has an unexpected structure."), { statusCode: 502 });
  }
  return { drivers, moreDataAvailable: Boolean(moreDataAvailable), moreDataAvailableLink };
}

function identifierValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return String(value).trim() || null;
  const nested = value.oemDriverIdentification
    ?? value.OemDriverIdentification
    ?? value.tachoDriverIdentification
    ?? value.TachoDriverIdentification
    ?? value.driverIdentification
    ?? value.DriverIdentification
    ?? value.driverId
    ?? value.DriverId
    ?? value.value
    ?? value.Value;
  return nested === value ? null : identifierValue(nested);
}

function driverCursor(driver, driverIdType) {
  const identifications = driver?.oemDriverIdentifications
    || driver?.OemDriverIdentifications
    || driver?.driverIdentifications
    || driver?.DriverIdentifications
    || [];
  const candidates = Array.isArray(identifications) ? identifications : [identifications];
  const requestedType = String(driverIdType || "").trim().toLowerCase();
  const typed = candidates.find((item) => String(
    item?.idType || item?.IdType || item?.driverIdType || item?.DriverIdType || "",
  ).trim().toLowerCase() === requestedType);
  return identifierValue(typed)
    || identifierValue(candidates.at(-1))
    || identifierValue(driver?.driverId || driver?.DriverId);
}

function nextPageQuery(link, endpoint) {
  if (!link) return {};
  let url;
  try {
    url = new URL(link, endpoint);
  } catch {
    throw Object.assign(new Error("Volvo driver pagination link is invalid."), { statusCode: 502 });
  }
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([name]) => NEXT_LINK_QUERY_KEYS.has(name)),
  );
}

function parseDriverTimePage(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const wrapped = root.driverTimeResponse || root.DriverTimeResponse || root;
  const driverTimes = wrapped.driverTimes || wrapped.DriverTimes
    || root.driverTimes || root.DriverTimes;
  const moreDataAvailable = root.moreDataAvailable ?? root.MoreDataAvailable
    ?? wrapped.moreDataAvailable ?? wrapped.MoreDataAvailable ?? false;
  const requestServerDateTime = root.requestServerDateTime || root.RequestServerDateTime
    || wrapped.requestServerDateTime || wrapped.RequestServerDateTime || null;
  if (!Array.isArray(driverTimes)) {
    throw Object.assign(new Error("Volvo driver-time response has an unexpected structure."), { statusCode: 502 });
  }
  return { driverTimes, moreDataAvailable: Boolean(moreDataAvailable), requestServerDateTime };
}

class VolvoDriverClient {
  constructor(options = {}) {
    this.driversUrl = requiredValue("VOLVO_DRIVERS_URL", options.driversUrl);
    this.driverTimesUrl = requiredValue("VOLVO_DRIVER_TIMES_URL", options.driverTimesUrl);
    this.username = requiredValue("VOLVO_DRIVER_API_USERNAME", options.username);
    this.password = requiredValue("VOLVO_DRIVER_API_PASSWORD", options.password);
    this.acceptDrivers = requiredValue("VOLVO_ACCEPT_DRIVERS", options.acceptDrivers);
    this.acceptDriverTimes = requiredValue("VOLVO_ACCEPT_DRIVER_TIMES", options.acceptDriverTimes);
    this.driverIdType = String(options.driverIdType || "pin").trim() || "pin";
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs || 30_000);
    this.retries = Number(options.retries ?? 2);
    this.maxPages = Math.max(1, Number(options.maxPages || 100));
    this.sleepFn = options.sleepFn || sleep;
    this.randomFn = options.randomFn || Math.random;
    if (typeof this.fetchFn !== "function") throw new Error("A fetch implementation is required.");
  }

  async request(endpoint, query, accept) {
    const url = new URL(endpoint);
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
            Accept: accept,
            Authorization: authorization,
            "Cache-Control": "no-cache",
          },
          onRequestStart, signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const error = Object.assign(new Error(`Volvo driver API request failed with status ${response.status}.`), {
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
          throw Object.assign(new Error("Volvo driver API returned invalid JSON."), { statusCode: 502 });
        }
      } catch (error) {
        const safeMessage = safeErrorMessage(error, [
          this.username,
          this.password,
          authorization,
        ]);
        const safeError = Object.assign(new Error(safeMessage || "Volvo driver API request failed."), {
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
    throw lastError || Object.assign(new Error("Volvo driver API request failed."), { statusCode: 502 });
  }

  async fetchDrivers(options = {}) {
    const driverIdType = String(options.driverIdType || this.driverIdType).trim() || this.driverIdType;
    const maxPages = Math.max(1, Number(options.maxPages || this.maxPages));
    const drivers = [];
    const seenCursors = new Set();
    let pageQuery = {};

    for (let page = 1; page <= maxPages; page += 1) {
      const parsed = parseDriverPage(await this.request(this.driversUrl, {
        driverIdType,
        ...pageQuery,
      }, this.acceptDrivers));
      drivers.push(...parsed.drivers);
      if (!parsed.moreDataAvailable) {
        return {
          drivers,
          moreDataAvailable: false,
          moreDataAvailableLink: null,
          pagesFetched: page,
        };
      }

      const nextQuery = nextPageQuery(parsed.moreDataAvailableLink, this.driversUrl);
      if (!nextQuery.lastDriverId) {
        nextQuery.lastDriverId = driverCursor(parsed.drivers.at(-1), driverIdType);
      }
      if (!nextQuery.lastDriverId) {
        throw Object.assign(new Error("Volvo driver response did not provide a pagination cursor."), {
          statusCode: 502,
        });
      }
      const cursor = String(nextQuery.lastDriverId);
      if (seenCursors.has(cursor)) {
        throw Object.assign(new Error("Volvo driver pagination cursor repeated."), { statusCode: 502 });
      }
      seenCursors.add(cursor);
      pageQuery = nextQuery;
    }

    throw Object.assign(new Error("Volvo driver response exceeded the configured page limit."), {
      statusCode: 502,
    });
  }

  async fetchLatestDriverTimes(options = {}) {
    return parseDriverTimePage(await this.request(this.driverTimesUrl, {
      datetype: "received",
      driverIdType: options.driverIdType || this.driverIdType,
      latestOnly: true,
    }, this.acceptDriverTimes));
  }
}

function createVolvoDriverClientFromEnv(env = process.env, options = {}) {
  const baseUrl = String(env.VOLVO_DRIVER_API_BASE_URL || DEFAULT_DRIVER_BASE_URL).replace(/\/$/, "");
  return new VolvoDriverClient({
    driversUrl: env.VOLVO_DRIVERS_URL || `${baseUrl}/drivers`,
    driverTimesUrl: env.VOLVO_DRIVER_TIMES_URL || `${baseUrl}/drivertimes`,
    username: env.VOLVO_DRIVER_API_USERNAME || env.VOLVO_API_USERNAME || env.VOLVO_RFMS_USERNAME,
    password: env.VOLVO_DRIVER_API_PASSWORD || env.VOLVO_API_PASSWORD || env.VOLVO_RFMS_PASSWORD,
    acceptDrivers: env.VOLVO_ACCEPT_DRIVERS || DEFAULT_ACCEPT_DRIVERS,
    acceptDriverTimes: env.VOLVO_ACCEPT_DRIVER_TIMES || DEFAULT_ACCEPT_DRIVER_TIMES,
    driverIdType: env.VOLVO_DRIVER_ID_TYPE || "pin",
    timeoutMs: env.VOLVO_DRIVER_REQUEST_TIMEOUT_MS || env.VOLVO_REQUEST_TIMEOUT_MS || options.timeoutMs,
    retries: env.VOLVO_DRIVER_REQUEST_RETRIES ?? options.retries,
    maxPages: env.VOLVO_DRIVER_MAX_PAGES || options.maxPages,
    ...options,
    fetchFn: guardedVolvoFetch(options.fetchFn || globalThis.fetch),
  });
}

module.exports = {
  DEFAULT_ACCEPT_DRIVERS,
  DEFAULT_ACCEPT_DRIVER_TIMES,
  DEFAULT_DRIVER_BASE_URL,
  VolvoDriverClient,
  createVolvoDriverClientFromEnv,
  driverCursor,
  nextPageQuery,
  parseDriverPage,
  parseDriverTimePage,
};
