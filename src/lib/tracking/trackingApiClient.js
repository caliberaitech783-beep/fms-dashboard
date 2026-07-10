const { maskObject, safeErrorMessage } = require("./masking");

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

class TrackingApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TrackingApiError";
    this.statusCode = options.statusCode || null;
    this.retryable = Boolean(options.retryable);
    this.responseBody = options.responseBody || null;
  }
}

function requiredEnv(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) {
    throw new TrackingApiError(`${name} is required.`);
  }
  return value;
}

function responseIdFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return payload.id || payload.recordId || payload.responseId || payload.data?.id || null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateBody(text) {
  return String(text || "").slice(0, 500);
}

class TrackingApiClient {
  constructor({
    baseUrl,
    username,
    password,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    fetchFn = globalThis.fetch,
    logger = console,
  }) {
    if (!fetchFn) {
      throw new TrackingApiError("Fetch API is not available in this runtime.");
    }

    this.baseUrl = String(baseUrl || "").trim();
    this.username = String(username || "");
    this.password = String(password || "");
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.fetchFn = fetchFn;
    this.logger = logger;
    this.secrets = [this.username, this.password, Buffer.from(`${this.username}:${this.password}`).toString("base64")];

    if (!this.baseUrl) {
      throw new TrackingApiError("TRACKING_API_BASE_URL is required.");
    }
    if (!this.username) {
      throw new TrackingApiError("TRACKING_API_USERNAME is required.");
    }
    if (!this.password) {
      throw new TrackingApiError("TRACKING_API_PASSWORD is required.");
    }
  }

  authHeader() {
    return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
  }

  async upsertRecord(payload) {
    const body = JSON.stringify(payload);
    let lastError = null;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        this.logger?.info?.("Tracking API request", maskObject({ attempt: attempt + 1 }));
        const response = await this.fetchFn(this.baseUrl, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Authorization": this.authHeader(),
            "Content-Type": "application/json",
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const text = await response.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }

        if (response.ok) {
          return {
            ok: true,
            statusCode: response.status,
            responseId: responseIdFromPayload(json),
            responseBody: json,
          };
        }

        const retryable = response.status >= 500;
        lastError = new TrackingApiError(`Tracking API returned ${response.status}.`, {
          statusCode: response.status,
          retryable,
          responseBody: truncateBody(text),
        });

        if (!retryable || attempt === this.retries) {
          throw lastError;
        }
      } catch (error) {
        clearTimeout(timeout);
        const retryable = error.name === "AbortError" || !(error instanceof TrackingApiError) || error.retryable;
        lastError = error instanceof TrackingApiError
          ? error
          : new TrackingApiError(safeErrorMessage(error, this.secrets), { retryable });

        if (!retryable || attempt === this.retries) {
          throw lastError;
        }
      }

      await delay(250 * (attempt + 1));
    }

    throw lastError || new TrackingApiError("Tracking API request failed.");
  }
}

function createTrackingApiClientFromEnv(env = process.env, options = {}) {
  return new TrackingApiClient({
    baseUrl: requiredEnv(env, "TRACKING_API_BASE_URL"),
    username: requiredEnv(env, "TRACKING_API_USERNAME"),
    password: requiredEnv(env, "TRACKING_API_PASSWORD"),
    ...options,
  });
}

module.exports = {
  TrackingApiClient,
  TrackingApiError,
  createTrackingApiClientFromEnv,
};
