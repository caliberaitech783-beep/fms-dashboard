const {
  CaseApiError,
  bearerValue,
  caseConfiguration,
  getCaseEquipment,
  httpFailure,
  normalizeBaseUrl,
  timeoutMs,
  validateConfiguration,
} = require("./caseClient");

const DEFAULT_REPORT_CACHE_MS = 5 * 60_000;
const DEFAULT_MAX_METRIC_PAGES = 100;
const DEFAULT_METRIC_CONCURRENCY = 8;
const DEFAULT_REQUEST_RETRIES = 2;
const DEFAULT_MAX_REPORT_DAYS = 31;
const MAX_CASE_SEGMENT_MS = 30 * 24 * 60 * 60 * 1000;

const METRIC_DEFINITIONS = {
  operating: {
    templateNames: ["CASE_CUMULATIVE_OPERATING_HOURS_URL", "CumulativeOperatingHours"],
    pathName: "CumulativeOperatingHours",
    payloadName: "CumulativeOperatingHours",
    valueName: "Hour",
    edgesOnly: true,
  },
  fuel: {
    templateNames: ["CASE_CUMULATIVE_FUEL_USED_URL", "Cumulative Fuel Used Time Series"],
    pathName: "CumulativeFuelUsed",
    payloadName: "FuelUsed",
    valueName: "FuelConsumed",
    edgesOnly: false,
  },
  idle: {
    templateNames: ["CASE_CUMULATIVE_IDLE_HOURS_URL", "Cumulative Idle Hours Time Series"],
    pathName: "CumulativeIdleHours",
    payloadName: "CumulativeIdleHours",
    valueName: "Hour",
    edgesOnly: false,
  },
};

const reportCache = new Map();
const pendingReports = new Map();

function configuredValue(env, names) {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function metricTemplates(env = process.env) {
  return Object.fromEntries(Object.entries(METRIC_DEFINITIONS).map(([key, definition]) => [
    key,
    configuredValue(env, definition.templateNames),
  ]));
}

function normalizedIso(value, label) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new CaseApiError(`CASE report ${label} timestamp is invalid.`, {
      kind: "validation",
      statusCode: 400,
    });
  }
  return parsed.toISOString().replace(".000Z", "Z");
}

function configuredPositiveNumber(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function configuredNonNegativeInteger(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function validateDateRange(from, to, env = process.env) {
  const normalizedFrom = normalizedIso(from, "start");
  const normalizedTo = normalizedIso(to, "end");
  const fromMs = Date.parse(normalizedFrom);
  const toMs = Date.parse(normalizedTo);
  if (toMs <= fromMs) {
    throw new CaseApiError("CASE report end timestamp must be after its start timestamp.", {
      kind: "validation",
      statusCode: 400,
    });
  }
  const maxDays = configuredPositiveNumber(env, "CASE_REPORT_MAX_DAYS", DEFAULT_MAX_REPORT_DAYS);
  if (toMs - fromMs > maxDays * 24 * 60 * 60 * 1000) {
    throw new CaseApiError(`CASE report range cannot exceed ${maxDays} days.`, {
      kind: "validation",
      statusCode: 400,
    });
  }
  return { from: normalizedFrom, to: normalizedTo };
}

function splitDateRange(from, to) {
  const ranges = [];
  let cursor = Date.parse(from);
  const end = Date.parse(to);
  while (cursor <= end) {
    const segmentEnd = Math.min(end, cursor + MAX_CASE_SEGMENT_MS - 1000);
    ranges.push({
      from: new Date(cursor).toISOString().replace(".000Z", "Z"),
      to: new Date(segmentEnd).toISOString().replace(".000Z", "Z"),
    });
    cursor = segmentEnd + 1000;
  }
  return ranges;
}

function buildMetricUrl(template, definition, options) {
  if (!template) {
    throw new CaseApiError(`${definition.templateNames[0]} is not configured.`, {
      kind: "configuration",
      statusCode: 503,
    });
  }
  const url = new URL(normalizeBaseUrl(template));
  const segments = url.pathname.split("/").filter(Boolean);
  const equipmentIndex = segments.findIndex((segment) => segment.toLowerCase() === "equipment");
  const metricIndex = equipmentIndex + 2;
  if (
    equipmentIndex < 0
    || metricIndex >= segments.length
    || segments[metricIndex].toLowerCase() !== definition.pathName.toLowerCase()
    || segments.length < metricIndex + 4
  ) {
    throw new CaseApiError(`${definition.templateNames[0]} does not match the supplied CASE endpoint shape.`, {
      kind: "configuration",
      statusCode: 503,
    });
  }

  const page = Number(options.page);
  if (!Number.isInteger(page) || page < 1) {
    throw new CaseApiError("CASE metric page must be a positive integer.", {
      kind: "validation",
      statusCode: 400,
    });
  }

  segments[equipmentIndex + 1] = encodeURIComponent(String(options.vin || "").trim());
  segments[metricIndex + 1] = encodeURIComponent(options.from);
  segments[metricIndex + 2] = encodeURIComponent(options.to);
  segments[metricIndex + 3] = String(page);
  url.pathname = `/${segments.join("/")}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= limit || !queue.length) return;
    const entry = queue.shift();
    active += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    runNext();
  });
}

async function fetchCaseJson(url, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CaseApiError("Fetch is unavailable in the CASE API runtime.", {
      kind: "configuration",
      statusCode: 503,
    });
  }

  const requestTimeoutMs = timeoutMs(options.env);
  const retries = configuredNonNegativeInteger(options.env, "CASE_REQUEST_RETRIES", DEFAULT_REQUEST_RETRIES);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let failure;
    try {
      const result = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${bearerValue(options.configuration.accessToken)}`,
          "Ocp-Apim-Subscription-Key": options.configuration.subscriptionKey,
        },
        signal: controller.signal,
      });
      if (!result.ok) throw httpFailure(result.status);
      const responseText = await result.text();
      try {
        return responseText ? JSON.parse(responseText) : null;
      } catch {
        throw new CaseApiError(`CASE ${options.label} response was not valid JSON.`, {
          kind: "invalid_json",
          statusCode: 502,
        });
      }
    } catch (error) {
      if (error instanceof CaseApiError) {
        failure = error;
      } else if (error?.name === "AbortError" || controller.signal.aborted) {
        failure = new CaseApiError(`CASE ${options.label} request timed out after ${requestTimeoutMs} ms.`, {
          kind: "timeout",
          statusCode: 504,
          retryable: true,
        });
      } else {
        failure = new CaseApiError(`CASE ${options.label} request could not reach the upstream API.`, {
          kind: "network",
          statusCode: 502,
          retryable: true,
        });
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!failure.retryable || attempt >= retries) throw failure;
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
  }

  throw new CaseApiError(`CASE ${options.label} request failed.`, {
    kind: "network",
    statusCode: 502,
    retryable: true,
  });
}

function validateMetricPayload(payload, definition) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload[definition.payloadName])) {
    throw new CaseApiError(`CASE ${definition.pathName} response did not contain the expected array.`, {
      kind: "mapping",
      statusCode: 502,
    });
  }
  return payload;
}

function lastPageNumber(payload, template, env = process.env) {
  const lastLink = (Array.isArray(payload?.Links) ? payload.Links : [])
    .find((link) => String(link?.rel || "").toLowerCase() === "last");
  if (!lastLink?.href) return 1;

  let linkedUrl;
  try {
    linkedUrl = new URL(lastLink.href, normalizeBaseUrl(template));
  } catch {
    throw new CaseApiError("CASE metric pagination link was invalid.", {
      kind: "mapping",
      statusCode: 502,
    });
  }
  const templateUrl = new URL(normalizeBaseUrl(template));
  if (linkedUrl.origin !== templateUrl.origin) {
    throw new CaseApiError("CASE metric pagination link used an unexpected origin.", {
      kind: "mapping",
      statusCode: 502,
    });
  }
  const lastSegment = linkedUrl.pathname.split("/").filter(Boolean).at(-1);
  const page = Number(lastSegment);
  const maxPages = configuredPositiveNumber(env, "CASE_MAX_METRIC_PAGES", DEFAULT_MAX_METRIC_PAGES);
  if (!Number.isInteger(page) || page < 1 || page > maxPages) {
    throw new CaseApiError("CASE metric pagination exceeded the configured limit.", {
      kind: "mapping",
      statusCode: 502,
    });
  }
  return page;
}

async function fetchMetricPage(definition, template, request, options) {
  const url = buildMetricUrl(template, definition, request);
  const payload = await options.limit(() => fetchCaseJson(url, {
    ...options,
    label: definition.pathName,
  }));
  return validateMetricPayload(payload, definition);
}

async function fetchMetricRange(definition, template, vin, range, options) {
  const first = await fetchMetricPage(definition, template, {
    vin,
    from: range.from,
    to: range.to,
    page: 1,
  }, options);
  const lastPage = lastPageNumber(first, template, options.env);
  if (lastPage === 1) return first[definition.payloadName];

  if (definition.edgesOnly) {
    const last = await fetchMetricPage(definition, template, {
      vin,
      from: range.from,
      to: range.to,
      page: lastPage,
    }, options);
    return [...first[definition.payloadName], ...last[definition.payloadName]];
  }

  const remaining = await Promise.all(Array.from({ length: lastPage - 1 }, (_, index) => (
    fetchMetricPage(definition, template, {
      vin,
      from: range.from,
      to: range.to,
      page: index + 2,
    }, options).then((payload) => payload[definition.payloadName])
  )));
  return [first[definition.payloadName], ...remaining].flat();
}

async function fetchMetricRecords(definition, template, vin, ranges, options) {
  const records = await Promise.all(ranges.map((range) => (
    fetchMetricRange(definition, template, vin, range, options)
  )));
  return records.flat();
}

function numericValues(records, name) {
  return records.flatMap((record) => {
    const value = Number(record?.[name]);
    return Number.isFinite(value) ? [value] : [];
  });
}

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

function aggregateCaseMetrics({ operatingRecords, fuelRecords, idleRecords }) {
  const operatingValues = numericValues(operatingRecords, "Hour");
  const fuelValues = numericValues(fuelRecords, "FuelConsumed");
  const idleValues = numericValues(idleRecords, "Hour");
  const fuelUnits = new Set(fuelRecords
    .map((record) => String(record?.FuelUnits || "").trim().toLowerCase())
    .filter(Boolean));

  const operatingHours = operatingValues.length >= 2
    ? Math.max(...operatingValues) - Math.min(...operatingValues)
    : null;
  const totalFuel = fuelValues.length && [...fuelUnits].every((unit) => ["litre", "liter", "litres", "liters"].includes(unit))
    ? fuelValues.reduce((sum, value) => sum + Math.max(0, value), 0)
    : null;
  const idleHours = idleValues.length
    ? idleValues.reduce((sum, value) => sum + Math.max(0, value), 0)
    : null;
  const workingHours = operatingHours !== null && idleHours !== null
    ? Math.max(0, operatingHours - idleHours)
    : null;
  const averageFuelPerHour = totalFuel !== null && workingHours !== null && workingHours > 0
    ? totalFuel / workingHours
    : null;
  const utilization = workingHours !== null && operatingHours !== null && operatingHours > 0
    ? workingHours / operatingHours * 100
    : null;

  return {
    totalFuel: rounded(totalFuel),
    averageFuelPerHour: rounded(averageFuelPerHour),
    workingHours: rounded(workingHours),
    idleHours: rounded(idleHours),
    utilization: rounded(utilization),
  };
}

async function fetchCaseReport(options = {}) {
  const env = options.env || process.env;
  const configuration = validateConfiguration(env);
  const templates = metricTemplates(env);
  const period = validateDateRange(options.from, options.to, env);
  const ranges = splitDateRange(period.from, period.to);
  const concurrency = configuredPositiveNumber(env, "CASE_METRIC_CONCURRENCY", DEFAULT_METRIC_CONCURRENCY);
  const limit = createLimiter(concurrency);
  const equipmentPayload = await getCaseEquipment({
    env,
    fetchImpl: options.fetchImpl,
    force: options.force,
  });
  const equipment = equipmentPayload.equipment.filter((item) => String(item?.vin || "").trim());
  const requestOptions = {
    env,
    configuration,
    fetchImpl: options.fetchImpl,
    limit,
  };

  const rows = await Promise.all(equipment.map(async (item) => {
    const vin = String(item.vin).trim();
    const [operatingRecords, fuelRecords, idleRecords] = await Promise.all([
      fetchMetricRecords(METRIC_DEFINITIONS.operating, templates.operating, vin, ranges, requestOptions),
      fetchMetricRecords(METRIC_DEFINITIONS.fuel, templates.fuel, vin, ranges, requestOptions),
      fetchMetricRecords(METRIC_DEFINITIONS.idle, templates.idle, vin, ranges, requestOptions),
    ]);
    return {
      machine: vin,
      model: String(item.model || "").trim() || null,
      ...aggregateCaseMetrics({ operatingRecords, fuelRecords, idleRecords }),
    };
  }));

  return {
    source: "CASE_EQUIPMENT_METRICS_LIVE",
    fetchedAt: new Date().toISOString(),
    period,
    equipmentCount: rows.length,
    rows,
  };
}

function reportCacheMs(env = process.env) {
  const configuredSeconds = Number(env.CASE_REPORT_CACHE_SECONDS);
  return Number.isFinite(configuredSeconds) && configuredSeconds >= 0
    ? configuredSeconds * 1000
    : DEFAULT_REPORT_CACHE_MS;
}

async function getCaseReport(options = {}) {
  const env = options.env || process.env;
  const period = validateDateRange(options.from, options.to, env);
  const cacheKey = `${period.from}|${period.to}`;
  const now = Date.now();
  const cached = reportCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > now) return cached.value;
  if (pendingReports.has(cacheKey)) return pendingReports.get(cacheKey);

  const pending = fetchCaseReport({ ...options, ...period, env })
    .then((payload) => {
      reportCache.set(cacheKey, {
        expiresAt: Date.now() + reportCacheMs(env),
        value: payload,
      });
      return payload;
    })
    .finally(() => pendingReports.delete(cacheKey));
  pendingReports.set(cacheKey, pending);
  return pending;
}

function resetCaseReportCache() {
  reportCache.clear();
  pendingReports.clear();
}

module.exports = {
  METRIC_DEFINITIONS,
  aggregateCaseMetrics,
  buildMetricUrl,
  fetchCaseReport,
  getCaseReport,
  lastPageNumber,
  metricTemplates,
  resetCaseReportCache,
  splitDateRange,
  validateDateRange,
  validateMetricPayload,
};
