const { safeErrorMessage } = require("../tracking/masking");

const DEFAULT_DRIVER_BASE_URL = "https://api.volvotrucks.com/driver";
const DEFAULT_ACCEPT_DRIVERS = "application/x.volvogroup.com.drivers.v1.0+json; UTF-8";
const DEFAULT_ACCEPT_DRIVER_TIMES = "application/x.volvogroup.com.drivertimes.v1.1+json; UTF-8";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

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
  if (!Array.isArray(drivers)) {
    throw Object.assign(new Error("Volvo driver response has an unexpected structure."), { statusCode: 502 });
  }
  return { drivers, moreDataAvailable: Boolean(moreDataAvailable) };
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
    this.driverIdType = String(options.driverIdType || "Tacho").trim() || "Tacho";
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs || 30_000);
    this.retries = Number(options.retries ?? 2);
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
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchFn(url, {
          method: "GET",
          headers: {
            Accept: accept,
            Authorization: authorization,
            "Cache-Control": "no-cache",
          },
          signal: controller.signal,
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

  async fetchDrivers() {
    return parseDriverPage(await this.request(this.driversUrl, {
      driverIdType: this.driverIdType,
    }, this.acceptDrivers));
  }

  async fetchLatestDriverTimes() {
    return parseDriverTimePage(await this.request(this.driverTimesUrl, {
      datetype: "received",
      driverIdType: this.driverIdType,
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
    driverIdType: env.VOLVO_DRIVER_ID_TYPE || "Tacho",
    timeoutMs: env.VOLVO_DRIVER_REQUEST_TIMEOUT_MS || env.VOLVO_REQUEST_TIMEOUT_MS || options.timeoutMs,
    retries: env.VOLVO_DRIVER_REQUEST_RETRIES ?? options.retries,
    ...options,
  });
}

module.exports = {
  DEFAULT_ACCEPT_DRIVERS,
  DEFAULT_ACCEPT_DRIVER_TIMES,
  DEFAULT_DRIVER_BASE_URL,
  VolvoDriverClient,
  createVolvoDriverClientFromEnv,
  parseDriverPage,
  parseDriverTimePage,
};
