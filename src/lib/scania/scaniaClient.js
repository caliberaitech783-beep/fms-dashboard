const { createHmac } = require("node:crypto");
const { safeErrorMessage } = require("../tracking/masking");

const DEFAULT_AUTH_BASE_URL = "https://dataaccess.scania.com/auth";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TOKEN_TTL_MS = 60 * 60_000;
const DEFAULT_TOKEN_REFRESH_SKEW_MS = 60_000;

const ACCEPT_HEADERS = {
  vehicles: "application/json; rfms=vehicles.v4.0",
  positions: "application/json; rfms=vehiclepositions.v4.0",
  statuses: "application/json; rfms=vehiclestatuses.v4.0",
  json: "application/json",
};

class ScaniaApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ScaniaApiError";
    this.kind = options.kind || "upstream";
    this.statusCode = options.statusCode || 502;
    this.httpStatus = options.httpStatus || null;
    this.endpoint = options.endpoint || null;
    this.retryable = Boolean(options.retryable);
    this.cause = options.cause;
  }
}

function required(name, value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new ScaniaApiError(`${name} is not configured.`, {
      kind: "configuration",
      statusCode: 503,
    });
  }
  return normalized;
}

function configuredUrl(name, value) {
  const normalized = required(name, value);
  try {
    return new URL(normalized).toString();
  } catch {
    throw new ScaniaApiError(`${name} is not a valid URL.`, {
      kind: "configuration",
      statusCode: 503,
    });
  }
}

function endpointForLog(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value || "").split("?")[0];
  }
}

function computeScaniaChallengeResponse(challenge, clientSecret) {
  try {
    const decodedChallenge = Buffer.from(required("Scania challenge", challenge), "base64url");
    const decodedSecret = Buffer.from(required("SCANIA_CLIENT_SECRET", clientSecret), "base64url");
    if (!decodedChallenge.length || !decodedSecret.length) {
      throw new Error("Decoded challenge or secret is empty.");
    }
    return createHmac("sha256", decodedSecret)
      .update(decodedChallenge)
      .digest("base64url");
  } catch (error) {
    if (error instanceof ScaniaApiError) throw error;
    throw new ScaniaApiError("Scania challenge response could not be generated.", {
      kind: "authentication",
      statusCode: 502,
      cause: error,
    });
  }
}

function httpErrorKind(status) {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  return "upstream";
}

function portalStatusForUpstream(status) {
  if (status === 401 || status === 403) return 502;
  if (status === 408 || status === 504) return 504;
  if (status === 429) return 503;
  return 502;
}

function firstArray(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") return [candidate];
  }
  return [];
}

function vehicleRows(payload) {
  return firstArray(
    payload?.vehicleResponse?.vehicles,
    payload?.VehicleResponse?.Vehicles,
    payload?.vehicles,
    payload?.Vehicles,
  );
}

function positionRows(payload) {
  return firstArray(
    payload?.vehiclePositionResponse?.vehiclePositions,
    payload?.VehiclePositionResponse?.VehiclePositions,
    payload?.vehiclePositions,
    payload?.VehiclePositions,
    payload?.VehicleTracksList,
    payload?.vehicleTracksList,
    payload,
  );
}

function statusRows(payload) {
  return firstArray(
    payload?.vehicleStatusResponse?.vehicleStatuses,
    payload?.VehicleStatusResponse?.VehicleStatuses,
    payload?.vehicleStatuses,
    payload?.VehicleStatuses,
  );
}

function exceptionRows(payload) {
  return firstArray(
    payload?.VehiclesExceptionInformation?.CustomerVehicles?.VehicleExceptionInformation,
    payload?.vehiclesExceptionInformation?.customerVehicles?.vehicleExceptionInformation,
    payload?.VehicleExceptionInformation,
  );
}

function moreDataLink(payload) {
  return payload?.moreDataAvailableLink
    || payload?.MoreDataAvailableLink
    || payload?.vehicleResponse?.moreDataAvailableLink
    || payload?.vehiclePositionResponse?.moreDataAvailableLink
    || payload?.vehicleStatusResponse?.moreDataAvailableLink
    || null;
}

function hasMoreData(payload) {
  return payload?.moreDataAvailable === true
    || payload?.MoreDataAvailable === true
    || payload?.vehicleResponse?.moreDataAvailable === true
    || payload?.vehiclePositionResponse?.moreDataAvailable === true
    || payload?.vehicleStatusResponse?.moreDataAvailable === true;
}

class ScaniaClient {
  constructor(options = {}) {
    this.clientId = String(options.clientId || "").trim();
    this.clientSecret = String(options.clientSecret || "").trim();
    this.initialAccessToken = String(options.accessToken || "").trim();
    this.authBaseUrl = configuredUrl(
      "SCANIA_AUTH_BASE_URL",
      options.authBaseUrl || DEFAULT_AUTH_BASE_URL,
    ).replace(/\/$/, "");
    this.authUrls = {
      challenge: options.challengeUrl
        ? configuredUrl("SCANIA_CHALLENGE_URL", options.challengeUrl)
        : `${this.authBaseUrl}/clientid2challenge`,
      token: options.tokenUrl
        ? configuredUrl("SCANIA_TOKEN_URL", options.tokenUrl)
        : `${this.authBaseUrl}/response2token`,
    };
    this.urls = {
      vehicles: configuredUrl("SCANIA_RFMS_VEHICLES_URL", options.vehiclesUrl),
      positions: configuredUrl("SCANIA_RFMS_VEHICLE_POSITIONS_URL", options.positionsUrl),
      statuses: configuredUrl("SCANIA_RFMS_VEHICLE_STATUSES_URL", options.statusesUrl),
      lastReportedPosition: options.lastReportedPositionUrl
        ? configuredUrl("SCANIA_LAST_REPORTED_POSITION_URL", options.lastReportedPositionUrl)
        : null,
      exceptions: configuredUrl("SCANIA_EXCEPTION_HISTORY_URL", options.exceptionsUrl),
      vehicleEvaluation: configuredUrl(
        "SCANIA_VEHICLE_EVALUATION_URL",
        options.vehicleEvaluationUrl,
      ),
      vehicleEvaluationGas: configuredUrl(
        "SCANIA_VEHICLE_EVALUATION_GAS_URL",
        options.vehicleEvaluationGasUrl || options.vehicleEvaluationUrl,
      ),
      vehicleEvaluationResult: options.vehicleEvaluationResultUrl
        ? configuredUrl(
          "SCANIA_VEHICLE_EVALUATION_RESULT_URL",
          options.vehicleEvaluationResultUrl,
        )
        : null,
      driverEvaluation: options.driverEvaluationUrl
        ? configuredUrl("SCANIA_DRIVER_EVALUATION_URL", options.driverEvaluationUrl)
        : null,
      driverEvaluationRequest: options.driverEvaluationRequestUrl
        ? configuredUrl(
          "SCANIA_DRIVER_EVALUATION_V3_REQUEST_URL",
          options.driverEvaluationRequestUrl,
        )
        : null,
      driverEvaluationResult: options.driverEvaluationResultUrl
        ? configuredUrl(
          "SCANIA_DRIVER_EVALUATION_V3_RESPONSE_URL",
          options.driverEvaluationResultUrl,
        )
        : null,
    };
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    this.retries = Number(options.retries ?? 1);
    this.maxPages = Number(options.maxPages || 20);
    this.tokenTtlMs = Number(options.tokenTtlMs || DEFAULT_TOKEN_TTL_MS);
    this.tokenRefreshSkewMs = Number(
      options.tokenRefreshSkewMs || DEFAULT_TOKEN_REFRESH_SKEW_MS,
    );
    this.initialTokenTtlMs = Number(options.initialTokenTtlMs || 0);
    this.gasQueryParameter = String(
      options.gasQueryParameter === undefined
        ? "includeGasConsumption"
        : options.gasQueryParameter,
    ).trim();
    this.nowFn = options.nowFn || Date.now;
    this.sleepFn = options.sleepFn || ((milliseconds) => (
      new Promise((resolve) => setTimeout(resolve, milliseconds))
    ));
    this.onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
    this.tokenCache = this.initialAccessToken && this.initialTokenTtlMs > 0
      ? {
        token: this.initialAccessToken,
        expiresAt: this.nowFn() + this.initialTokenTtlMs,
      }
      : null;
    this.pendingToken = null;

    if (typeof this.fetchFn !== "function") {
      throw new ScaniaApiError("A fetch implementation is required.", {
        kind: "configuration",
        statusCode: 503,
      });
    }
    if ((!this.clientId || !this.clientSecret) && !this.initialAccessToken) {
      throw new ScaniaApiError(
        "SCANIA_CLIENT_ID and SCANIA_CLIENT_SECRET are required when no access token is configured.",
        { kind: "configuration", statusCode: 503 },
      );
    }
  }

  invalidateToken() {
    this.tokenCache = null;
  }

  async accessToken(forceRefresh = false) {
    if (
      !forceRefresh
      && this.tokenCache
      && this.tokenCache.expiresAt > this.nowFn() + this.tokenRefreshSkewMs
    ) {
      return this.tokenCache.token;
    }
    if (this.pendingToken) return this.pendingToken;

    if (!this.clientId || !this.clientSecret) {
      if (!this.initialAccessToken) {
        throw new ScaniaApiError("Scania API credentials are not configured.", {
          kind: "configuration",
          statusCode: 503,
        });
      }
      this.tokenCache = {
        token: this.initialAccessToken,
        expiresAt: this.nowFn() + Math.max(this.initialTokenTtlMs, 5 * 60_000),
      };
      return this.tokenCache.token;
    }

    this.pendingToken = this.generateAccessToken()
      .finally(() => {
        this.pendingToken = null;
      });
    return this.pendingToken;
  }

  async generateAccessToken() {
    const challengeResponse = await this.authForm(
      this.authUrls.challenge,
      { clientId: this.clientId },
      "challenge",
    );
    const challenge = required("Scania authentication challenge", challengeResponse.challenge);
    const responseValue = computeScaniaChallengeResponse(challenge, this.clientSecret);
    const tokenResponse = await this.authForm(
      this.authUrls.token,
      { clientId: this.clientId, Response: responseValue },
      "token",
    );
    const token = required("Scania access token", tokenResponse.token || tokenResponse.access_token);
    const expiresInSeconds = Number(
      tokenResponse.expiresIn
      || tokenResponse.expires_in
      || this.tokenTtlMs / 1000,
    );
    this.tokenCache = {
      token,
      expiresAt: this.nowFn() + Math.max(60, expiresInSeconds) * 1000,
    };
    return token;
  }

  async authForm(url, fields, stage) {
    const endpoint = endpointForLog(url);
    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Accept: ACCEPT_HEADERS.json,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "CMLL-FMS-Scania-Integration/1.0",
      },
      body: new URLSearchParams(fields).toString(),
    }, endpoint);
    this.onEvent("http_response", { endpoint, status: response.status, operation: `auth_${stage}` });
    const payload = await this.parseResponse(response, endpoint);
    if (!response.ok) {
      throw new ScaniaApiError(
        stage === "challenge"
          ? "Scania authentication challenge request failed."
          : "Scania access-token generation failed.",
        {
          kind: "authentication",
          statusCode: 502,
          httpStatus: response.status,
          endpoint,
        },
      );
    }
    return payload;
  }

  async fetchWithTimeout(url, options, endpoint = endpointForLog(url)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, { ...options, signal: controller.signal });
    } catch (error) {
      const isTimeout = error?.name === "AbortError";
      throw new ScaniaApiError(
        isTimeout ? "Scania API request timed out." : "Scania API could not be reached.",
        {
          kind: isTimeout ? "timeout" : "network",
          statusCode: isTimeout ? 504 : 502,
          endpoint,
          retryable: true,
          cause: error,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async parseResponse(response, endpoint) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new ScaniaApiError("Scania API returned invalid JSON.", {
        kind: "invalid_response",
        statusCode: 502,
        httpStatus: response.status,
        endpoint,
        cause: error,
      });
    }
  }

  async requestJson(options) {
    const url = new URL(options.url);
    for (const [name, value] of Object.entries(options.query || {})) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(name, String(value));
      }
    }
    const endpoint = endpointForLog(url);
    let lastError;
    let forcedTokenRefresh = false;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const token = await this.accessToken(forcedTokenRefresh);
        const headers = {
          Accept: options.accept || ACCEPT_HEADERS.json,
          Authorization: `Bearer ${token}`,
          "User-Agent": "CMLL-FMS-Scania-Integration/1.0",
        };
        if (options.body) headers["Content-Type"] = "application/json";
        const response = await this.fetchWithTimeout(url, {
          method: options.method || "GET",
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
        }, endpoint);
        this.onEvent("http_response", {
          endpoint,
          status: response.status,
          operation: options.operation || "request",
        });
        const payload = await this.parseResponse(response, endpoint);
        if (response.ok) {
          return { payload, status: response.status, endpoint };
        }

        if (response.status === 401 && !forcedTokenRefresh && this.clientId && this.clientSecret) {
          this.invalidateToken();
          forcedTokenRefresh = true;
          continue;
        }

        const kind = httpErrorKind(response.status);
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new ScaniaApiError(
          kind === "authentication"
            ? "Scania API authentication failed."
            : kind === "permission"
              ? "Scania API permission was denied."
              : kind === "rate_limit"
                ? "Scania API rate limit was reached."
                : "Scania API request failed.",
          {
            kind,
            statusCode: portalStatusForUpstream(response.status),
            httpStatus: response.status,
            endpoint,
            retryable,
          },
        );
        if (!retryable || attempt >= this.retries) throw lastError;
      } catch (error) {
        lastError = error instanceof ScaniaApiError
          ? error
          : new ScaniaApiError(
            safeErrorMessage(error, [this.clientId, this.clientSecret, this.initialAccessToken]),
            { kind: "upstream", statusCode: 502, endpoint, cause: error },
          );
        if (!lastError.retryable || attempt >= this.retries) throw lastError;
      }
      await this.sleepFn(Math.min(1_000 * (attempt + 1), 3_000));
    }

    throw lastError || new ScaniaApiError("Scania API request failed.");
  }

  async getVehicles(query = {}) {
    return this.collectPages({
      url: this.urls.vehicles,
      query,
      accept: ACCEPT_HEADERS.vehicles,
      operation: "vehicles",
      rows: vehicleRows,
    });
  }

  async getLatestPositions(query = {}) {
    return this.collectPages({
      url: this.urls.positions,
      query: { latestOnly: true, ...query },
      accept: ACCEPT_HEADERS.positions,
      operation: "positions",
      rows: positionRows,
    });
  }

  async getLastReportedPositions(query = {}) {
    if (!this.urls.lastReportedPosition) return this.getLatestPositions(query);
    const result = await this.requestJson({
      url: this.urls.lastReportedPosition,
      query,
      accept: ACCEPT_HEADERS.json,
      operation: "last_reported_positions",
    });
    return { ...result, records: positionRows(result.payload) };
  }

  async getVehicleStatuses(query = {}) {
    return this.collectPages({
      url: this.urls.statuses,
      query: { latestOnly: true, ...query },
      accept: ACCEPT_HEADERS.statuses,
      operation: "statuses",
      rows: statusRows,
    });
  }

  async getExceptions(query = {}) {
    const result = await this.requestJson({
      url: this.urls.exceptions,
      query,
      accept: ACCEPT_HEADERS.json,
      operation: "exceptions",
    });
    return { ...result, records: exceptionRows(result.payload) };
  }

  async getVehicleEvaluation(query = {}) {
    return this.requestJson({
      url: this.urls.vehicleEvaluation,
      query,
      accept: ACCEPT_HEADERS.json,
      operation: "vehicle_evaluation",
    });
  }

  async getVehicleEvaluationWithGasConsumption(query = {}) {
    const gasQuery = { ...query };
    if (this.gasQueryParameter) gasQuery[this.gasQueryParameter] = true;
    return this.requestJson({
      url: this.urls.vehicleEvaluationGas,
      query: gasQuery,
      accept: ACCEPT_HEADERS.json,
      operation: "vehicle_evaluation_gas",
    });
  }

  async getVehicleEvaluationResult(sessionId) {
    if (!this.urls.vehicleEvaluationResult) {
      throw new ScaniaApiError(
        "SCANIA_VEHICLE_EVALUATION_RESULT_URL is required for asynchronous vehicle reports.",
        { kind: "configuration", statusCode: 503 },
      );
    }
    return this.requestJson({
      url: this.urls.vehicleEvaluationResult,
      query: { sessionId },
      accept: ACCEPT_HEADERS.json,
      operation: "vehicle_evaluation_result",
    });
  }

  async getDriverEvaluation(query = {}) {
    if (!this.urls.driverEvaluation) {
      throw new ScaniaApiError("SCANIA_DRIVER_EVALUATION_URL is not configured.", {
        kind: "configuration",
        statusCode: 503,
      });
    }
    return this.requestJson({
      url: this.urls.driverEvaluation,
      query,
      accept: ACCEPT_HEADERS.json,
      operation: "driver_evaluation",
    });
  }

  async requestDriverEvaluation(body = {}) {
    if (!this.urls.driverEvaluationRequest) {
      throw new ScaniaApiError(
        "SCANIA_DRIVER_EVALUATION_V3_REQUEST_URL is not configured.",
        { kind: "configuration", statusCode: 503 },
      );
    }
    return this.requestJson({
      url: this.urls.driverEvaluationRequest,
      method: "POST",
      body,
      accept: ACCEPT_HEADERS.json,
      operation: "driver_evaluation_request",
    });
  }

  async getDriverEvaluationResult(sessionId) {
    if (!this.urls.driverEvaluationResult) {
      throw new ScaniaApiError(
        "SCANIA_DRIVER_EVALUATION_V3_RESPONSE_URL is not configured.",
        { kind: "configuration", statusCode: 503 },
      );
    }
    return this.requestJson({
      url: this.urls.driverEvaluationResult,
      query: { sessionId },
      accept: ACCEPT_HEADERS.json,
      operation: "driver_evaluation_result",
    });
  }

  async collectPages(options) {
    const records = [];
    let pageUrl = options.url;
    let pageQuery = options.query;
    let lastResult = null;

    for (let page = 0; page < this.maxPages; page += 1) {
      lastResult = await this.requestJson({
        url: pageUrl,
        query: pageQuery,
        accept: options.accept,
        operation: options.operation,
      });
      records.push(...options.rows(lastResult.payload));
      if (!hasMoreData(lastResult.payload)) break;
      const next = moreDataLink(lastResult.payload);
      if (!next) {
        throw new ScaniaApiError(
          `Scania ${options.operation} response says more data is available but did not provide a continuation link.`,
          {
            kind: "invalid_response",
            statusCode: 502,
            endpoint: lastResult.endpoint,
          },
        );
      }
      pageUrl = new URL(next, pageUrl).toString();
      pageQuery = {};
    }

    return {
      ...(lastResult || {
        payload: {},
        status: 200,
        endpoint: endpointForLog(options.url),
      }),
      records,
    };
  }
}

function createScaniaClientFromEnv(options = {}) {
  const env = options.env || process.env;
  return new ScaniaClient({
    clientId: env.SCANIA_CLIENT_ID,
    clientSecret: env.SCANIA_CLIENT_SECRET,
    accessToken: env.SCANIA_ACCESS_TOKEN,
    initialTokenTtlMs: Number(env.SCANIA_ACCESS_TOKEN_TTL_SECONDS || 0) * 1000,
    authBaseUrl: env.SCANIA_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL,
    challengeUrl: env.SCANIA_CHALLENGE_URL,
    tokenUrl: env.SCANIA_TOKEN_URL,
    vehiclesUrl: env.SCANIA_RFMS_VEHICLES_URL,
    positionsUrl: env.SCANIA_RFMS_VEHICLE_POSITIONS_URL,
    statusesUrl: env.SCANIA_RFMS_VEHICLE_STATUSES_URL,
    lastReportedPositionUrl: env.SCANIA_LAST_REPORTED_POSITION_URL,
    exceptionsUrl: env.SCANIA_EXCEPTION_HISTORY_URL,
    vehicleEvaluationUrl: env.SCANIA_VEHICLE_EVALUATION_URL,
    vehicleEvaluationGasUrl:
      env.SCANIA_VEHICLE_EVALUATION_GAS_URL
      || env.SCANIA_VEHICLE_EVALUATION_URL,
    vehicleEvaluationResultUrl: env.SCANIA_VEHICLE_EVALUATION_RESULT_URL,
    driverEvaluationUrl:
      env.SCANIA_DRIVER_EVALUATION_URL
      || env.SCANIA_DRIVER_EVALUATION_V2_URL
      || env.SCANIA_DRIVER_EVALUATION_V1_URL,
    driverEvaluationRequestUrl: env.SCANIA_DRIVER_EVALUATION_V3_REQUEST_URL,
    driverEvaluationResultUrl: env.SCANIA_DRIVER_EVALUATION_V3_RESPONSE_URL,
    gasQueryParameter: env.SCANIA_VEHICLE_EVALUATION_GAS_QUERY_PARAM,
    timeoutMs: Number(env.SCANIA_HTTP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    retries: Number(env.SCANIA_HTTP_RETRIES ?? 1),
    maxPages: Number(env.SCANIA_MAX_PAGES || 20),
    tokenTtlMs: Number(env.SCANIA_TOKEN_TTL_SECONDS || 3600) * 1000,
    ...options,
  });
}

module.exports = {
  ACCEPT_HEADERS,
  ScaniaApiError,
  ScaniaClient,
  computeScaniaChallengeResponse,
  createScaniaClientFromEnv,
  endpointForLog,
  exceptionRows,
  positionRows,
  statusRows,
  vehicleRows,
};
