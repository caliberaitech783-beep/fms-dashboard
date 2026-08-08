const { app } = require("@azure/functions");
const { loadLocalEnv } = require("../lib/loadLocalEnv");

loadLocalEnv();

const authStore = require("../lib/authStore");
const { safeErrorMessage } = require("../lib/tracking/masking");
const { getCaseEquipment } = require("../lib/case/caseClient");
const { getCaseReport } = require("../lib/case/caseReportClient");

const LIVE_ROLES = new Set(["Super Admin", "Management", "Fleet Manager"]);

function allowedOrigin(request) {
  const configured = (process.env.ALLOWED_ORIGINS || "https://fms.cmll.in")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin");
  return origin && configured.includes(origin)
    ? origin
    : configured[0] || "https://fms.cmll.in";
}

function response(request, status, body) {
  return {
    status,
    jsonBody: body,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(request),
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "private, no-store",
      Vary: "Origin",
    },
  };
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function requireActor(request) {
  const token = bearerToken(request);
  if (!token) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, isPortalAuth: true });
  }
  const payload = authStore.verifyToken(token);
  const actor = await authStore.getUser(payload.sub);
  if (!actor || !actor.isActive) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, isPortalAuth: true });
  }
  return actor;
}

function requireLiveRole(actor) {
  if (!LIVE_ROLES.has(actor?.role)) {
    throw Object.assign(new Error("Permission denied."), { statusCode: 403, isPortalAuth: true });
  }
}

function caseSecrets() {
  return [
    process.env.CASE_ACCESS_TOKEN,
    process.env.CASE_BEARER_TOKEN,
    process.env.bearerToken,
    process.env.CASE_SUBSCRIPTION_KEY,
    process.env.Subscription,
    process.env.CASE_API_KEY,
    process.env.CASE_CLIENT_ID,
    process.env.CASE_CLIENT_SECRET,
    process.env.CASE_REFRESH_TOKEN,
    process.env.CASE_TOKEN_URL,
    process.env.CASE_AUDIENCE,
    process.env.CASE_CUMULATIVE_OPERATING_HOURS_URL,
    process.env.CASE_CUMULATIVE_FUEL_USED_URL,
    process.env.CASE_CUMULATIVE_IDLE_HOURS_URL,
  ].filter(Boolean);
}

function failureResponse(request, context, error, operation = "equipment") {
  context.error(`[CASE] ${operation} request failed`, safeErrorMessage(error, caseSecrets()));
  const status = error?.isPortalAuth
    ? error.statusCode
    : error?.kind === "validation"
      ? 400
    : error?.kind === "configuration" || error?.kind === "rate_limit"
      ? 503
      : error?.kind === "timeout"
        ? 504
        : 502;
  const code = error?.isPortalAuth
    ? status === 403 ? "CASE_PORTAL_PERMISSION" : "CASE_PORTAL_AUTHENTICATION"
    : error?.kind === "authentication"
      ? "CASE_AUTHENTICATION"
      : error?.kind === "configuration"
        ? "CASE_CONFIGURATION"
        : error?.kind === "validation"
          ? "CASE_VALIDATION"
        : error?.kind === "timeout"
          ? "CASE_TIMEOUT"
          : error?.kind === "rate_limit"
            ? "CASE_RATE_LIMIT"
            : "CASE_UPSTREAM";
  const message = error?.isPortalAuth
    ? status === 403
      ? "Your dashboard role cannot access live CASE data."
      : "Dashboard authentication is required."
    : "CASE data unavailable";

  return response(request, status, {
    error: {
      code,
      message,
      retryable: !error?.isPortalAuth && error?.kind !== "configuration" && error?.kind !== "authentication",
    },
  });
}

async function handleEquipment(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    const actor = await requireActor(request);
    requireLiveRole(actor);
    const force = String(request.query.get("refresh") || "").toLowerCase() === "true";
    const payload = await getCaseEquipment({ force });
    context.log(`[CASE] equipment request succeeded with ${payload.equipment.length} records`);
    return response(request, 200, payload);
  } catch (error) {
    return failureResponse(request, context, error);
  }
}

async function handleReport(request, context) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    const actor = await requireActor(request);
    requireLiveRole(actor);
    const force = String(request.query.get("refresh") || "").toLowerCase() === "true";
    const payload = await getCaseReport({
      from: request.query.get("from"),
      to: request.query.get("to"),
      force,
    });
    context.log(`[CASE] metrics report request succeeded with ${payload.rows.length} records`);
    return response(request, 200, payload);
  } catch (error) {
    return failureResponse(request, context, error, "metrics report");
  }
}

app.http("caseEquipment", {
  route: "case/equipment",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleEquipment,
});

app.http("caseReport", {
  route: "case/report",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleReport,
});

module.exports = {
  handleEquipment,
  handleReport,
};
