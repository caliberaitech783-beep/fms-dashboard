const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CACHE_MS = 60_000;

let equipmentCache = null;
let pendingEquipment = null;

class CaseApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "CaseApiError";
    this.kind = options.kind || "upstream";
    this.statusCode = options.statusCode || 502;
    this.retryable = Boolean(options.retryable);
    this.upstreamStatus = options.upstreamStatus || null;
  }
}

function configuredValue(env, names) {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function caseConfiguration(env = process.env) {
  return {
    baseUrl: configuredValue(env, ["CASE_BASE_URL", "CASE_API_BASE_URL"]),
    accessToken: configuredValue(env, ["CASE_BEARER_TOKEN", "bearerToken", "CASE_ACCESS_TOKEN"]),
    subscriptionKey: configuredValue(env, ["CASE_SUBSCRIPTION_KEY", "Subscription", "CASE_API_KEY"]),
  };
}

function normalizeBaseUrl(value) {
  const repaired = String(value || "")
    .trim()
    .replace(/^https:(https?:\/\/)/i, "$1")
    .replace(/\/+$/, "");

  let url;
  try {
    url = new URL(repaired);
  } catch {
    throw new CaseApiError("CASE_BASE_URL is invalid.", {
      kind: "configuration",
      statusCode: 503,
    });
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new CaseApiError("CASE_BASE_URL must use HTTP or HTTPS.", {
      kind: "configuration",
      statusCode: 503,
    });
  }

  return url.toString().replace(/\/$/, "");
}

function equipmentUrl(env = process.env) {
  const { baseUrl } = caseConfiguration(env);
  if (!baseUrl) {
    throw new CaseApiError("CASE_BASE_URL is not configured.", {
      kind: "configuration",
      statusCode: 503,
    });
  }
  const normalized = normalizeBaseUrl(baseUrl);
  const pathname = new URL(normalized).pathname.replace(/\/+$/, "");
  return pathname.toLowerCase().endsWith("/equipment")
    ? normalized
    : `${normalized}/equipment`;
}

function bearerValue(accessToken) {
  return String(accessToken || "").replace(/^Bearer\s+/i, "").trim();
}

function validateConfiguration(env = process.env) {
  const configuration = caseConfiguration(env);
  equipmentUrl(env);
  if (!bearerValue(configuration.accessToken)) {
    throw new CaseApiError("CASE_ACCESS_TOKEN is not configured.", {
      kind: "configuration",
      statusCode: 503,
    });
  }
  if (!configuration.subscriptionKey) {
    throw new CaseApiError("CASE_SUBSCRIPTION_KEY is not configured.", {
      kind: "configuration",
      statusCode: 503,
    });
  }
  return configuration;
}

function timeoutMs(env = process.env) {
  const configured = Number(env.CASE_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function cacheMs(env = process.env) {
  const configuredSeconds = Number(env.CASE_CACHE_SECONDS);
  return Number.isFinite(configuredSeconds) && configuredSeconds >= 0
    ? configuredSeconds * 1000
    : DEFAULT_CACHE_MS;
}

function httpFailure(status) {
  if (status === 401 || status === 403) {
    return new CaseApiError("CASE authentication was rejected by the upstream API.", {
      kind: "authentication",
      statusCode: 502,
      upstreamStatus: status,
    });
  }
  if (status === 429) {
    return new CaseApiError("CASE API rate limit was reached.", {
      kind: "rate_limit",
      statusCode: 503,
      retryable: true,
      upstreamStatus: status,
    });
  }
  return new CaseApiError(`CASE equipment request failed with HTTP ${status}.`, {
    kind: "upstream",
    statusCode: status >= 500 ? 502 : 502,
    retryable: status >= 500,
    upstreamStatus: status,
  });
}

function validateEquipmentPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.equipment)) {
    throw new CaseApiError("CASE equipment response did not contain an equipment array.", {
      kind: "mapping",
      statusCode: 502,
    });
  }
  return payload;
}

async function fetchCaseEquipment(options = {}) {
  const env = options.env || process.env;
  const configuration = validateConfiguration(env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CaseApiError("Fetch is unavailable in the CASE API runtime.", {
      kind: "configuration",
      statusCode: 503,
    });
  }

  const controller = new AbortController();
  const requestTimeoutMs = timeoutMs(env);
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const result = await fetchImpl(equipmentUrl(env), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${bearerValue(configuration.accessToken)}`,
        "Ocp-Apim-Subscription-Key": configuration.subscriptionKey,
      },
      signal: controller.signal,
    });

    if (!result.ok) {
      throw httpFailure(result.status);
    }

    const responseText = await result.text();
    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new CaseApiError("CASE equipment response was not valid JSON.", {
        kind: "invalid_json",
        statusCode: 502,
      });
    }
    return validateEquipmentPayload(payload);
  } catch (error) {
    if (error instanceof CaseApiError) throw error;
    if (error?.name === "AbortError" || controller.signal.aborted) {
      throw new CaseApiError(`CASE equipment request timed out after ${requestTimeoutMs} ms.`, {
        kind: "timeout",
        statusCode: 504,
        retryable: true,
      });
    }
    throw new CaseApiError("CASE equipment request could not reach the upstream API.", {
      kind: "network",
      statusCode: 502,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getCaseEquipment(options = {}) {
  const now = Date.now();
  if (!options.force && equipmentCache && equipmentCache.expiresAt > now) {
    return equipmentCache.value;
  }
  if (pendingEquipment) return pendingEquipment;

  pendingEquipment = fetchCaseEquipment(options)
    .then((payload) => {
      equipmentCache = {
        expiresAt: Date.now() + cacheMs(options.env || process.env),
        value: payload,
      };
      return payload;
    })
    .finally(() => {
      pendingEquipment = null;
    });

  return pendingEquipment;
}

function resetCaseEquipmentCache() {
  equipmentCache = null;
  pendingEquipment = null;
}

module.exports = {
  CaseApiError,
  caseConfiguration,
  equipmentUrl,
  fetchCaseEquipment,
  getCaseEquipment,
  normalizeBaseUrl,
  resetCaseEquipmentCache,
  validateEquipmentPayload,
};
