const { app } = require("@azure/functions");
const { loadLocalEnv } = require("../lib/loadLocalEnv");

loadLocalEnv();

const authStore = require("../lib/authStore");
const { safeErrorMessage } = require("../lib/tracking/masking");
const {
  getEicherSnapshot,
  resetEicherSnapshotCache,
} = require("../lib/eicher/vecvClient");

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
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

function eicherSecrets() {
  return [
    process.env.EICHER_API_KEY,
    process.env.APIKEY,
    process.env.EICHER_APIKEY,
    process.env.VECV_API_KEY,
    process.env.EICHER_BEARER_TOKEN,
    process.env.EICHER_TOKEN,
    process.env.VECV_BEARER_TOKEN,
  ].filter(Boolean);
}

function failureResponse(request, context, error, label) {
  context.error(`[Eicher] ${label} failed`, safeErrorMessage(error, eicherSecrets()));
  const status = error?.isPortalAuth
    ? error.statusCode
    : [400, 401, 403, 503, 504].includes(error?.statusCode)
      ? error.statusCode
      : 502;
  return response(request, status, {
    error: {
      code: status === 401 ? "EICHER_PORTAL_AUTHENTICATION" : "EICHER_UPSTREAM",
      message: status === 401
        ? "Dashboard authentication is required."
        : status === 403
          ? "Your dashboard role cannot access live Eicher data."
          : "Eicher live data is temporarily unavailable.",
      retryable: !error?.isPortalAuth,
    },
  });
}

async function withLiveActor(request, context, label, handler) {
  if (request.method === "OPTIONS") return response(request, 204, null);
  try {
    const actor = await requireActor(request);
    requireLiveRole(actor);
    return await handler(actor);
  } catch (error) {
    return failureResponse(request, context, error, label);
  }
}

async function handleSnapshot(request, context) {
  return withLiveActor(request, context, "snapshot", async () => {
    const force = String(request.query.get("refresh") || "").toLowerCase() === "true";
    const snapshot = await getEicherSnapshot({ force });
    return response(request, 200, snapshot);
  });
}

async function handleStatus(request, context) {
  return withLiveActor(request, context, "status", async () => {
    const snapshot = await getEicherSnapshot();
    return response(request, 200, {
      ...snapshot.integration,
      registry: snapshot.registry,
      summary: snapshot.summary,
      meta: snapshot.meta,
    });
  });
}

async function handleLocations(request, context) {
  return withLiveActor(request, context, "locations", async () => {
    const snapshot = await getEicherSnapshot();
    return response(request, 200, {
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      registry: snapshot.registry,
      locations: snapshot.telemetry.map((record) => ({
        vin: record.trackerId,
        chassisNumber: record.rawMetrics.chassisNumber || record.trackerId,
        registrationNumber: record.rawMetrics.registrationNumber || record.vehicleNumber,
        deviceId: record.rawMetrics.deviceId ?? null,
        status: record.status,
        vehicleStatus: record.rawMetrics.vehicleStatus ?? null,
        latitude: record.rawMetrics.latitude ?? null,
        longitude: record.rawMetrics.longitude ?? null,
        speedKph: record.rawMetrics.speedKph ?? null,
        vehicleDirection: record.rawMetrics.vehicleDirection ?? record.rawMetrics.heading ?? null,
        odometerKm: record.rawMetrics.odometerKm ?? record.odometerKm,
        ignitionState: record.rawMetrics.ignitionState ?? null,
        currentLocation: record.rawMetrics.currentLocation ?? record.location,
        gpsTimestamp: record.rawMetrics.gpsTimestamp ?? record.timestamp,
        lastSuccessfulUpdate: record.rawMetrics.lastSuccessfulUpdate ?? snapshot.meta.lastSuccessfulUpdate,
      })),
    });
  });
}

async function handleRefresh(request, context) {
  return withLiveActor(request, context, "refresh", async () => {
    resetEicherSnapshotCache();
    const snapshot = await getEicherSnapshot({ force: true });
    return response(request, 200, {
      ok: true,
      snapshot,
    });
  });
}

app.http("eicherVehicles", {
  route: "integrations/eicher/vehicles",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleSnapshot,
});

app.http("eicherStatus", {
  route: "integrations/eicher/status",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleStatus,
});

app.http("eicherLocations", {
  route: "integrations/eicher/locations",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: handleLocations,
});

app.http("eicherManualRefresh", {
  route: "integrations/eicher/refresh",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: handleRefresh,
});

module.exports = {
  handleLocations,
  handleRefresh,
  handleSnapshot,
  handleStatus,
};
