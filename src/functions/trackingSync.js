const { app } = require("@azure/functions");
const store = require("../lib/authStore");
const { syncTrackingWorkbookBuffer } = require("../lib/tracking/syncWorkflow");
const { createTrackingApiClientFromEnv } = require("../lib/tracking/trackingApiClient");
const { safeErrorMessage } = require("../lib/tracking/masking");

function allowedOrigin(request) {
  const configured = (process.env.ALLOWED_ORIGINS || "https://fms.cmll.in")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin");

  if (configured.includes("*")) {
    return "*";
  }

  if (origin && configured.includes(origin)) {
    return origin;
  }

  return configured[0] || "https://fms.cmll.in";
}

function response(request, status, body) {
  return {
    status,
    jsonBody: body,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(request),
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  };
}

function emptyResponse(request) {
  return {
    status: 204,
    body: "",
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(request),
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireSuperAdmin(request) {
  const token = bearerToken(request);
  if (!token) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
  }

  const payload = store.verifyToken(token);
  const actor = await store.getUser(payload.sub);
  if (!actor || !actor.isActive) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
  }

  if (actor.role !== "Super Admin") {
    throw Object.assign(new Error("Only Super Admin users can perform this action."), { statusCode: 403 });
  }

  return actor;
}

app.http("trackingSync", {
  route: "tracking/sync",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return emptyResponse(request);
    }

    try {
      await requireSuperAdmin(request);
      const body = await readJson(request);
      const fileBase64 = String(body.fileBase64 || "");
      if (!fileBase64) {
        return response(request, 400, { message: "fileBase64 is required." });
      }

      const dryRun = body.dryRun !== false;
      const summary = await syncTrackingWorkbookBuffer(Buffer.from(fileBase64, "base64"), {
        dryRun,
        defaultSite: String(body.defaultSite || ""),
        defaultTimestamp: String(body.defaultTimestamp || ""),
        client: dryRun ? null : createTrackingApiClientFromEnv(process.env, { logger: context }),
      });

      const { updatedWorkbook, results, ...rest } = summary;
      return response(request, 200, {
        ...rest,
        results: results.map((result) => ({
          rowNumber: result.rowNumber,
          status: result.status,
          responseId: result.responseId,
          error: result.error,
          validationErrors: result.validationErrors,
          payloadPreview: result.payloadPreview,
        })),
        updatedWorkbookBase64: updatedWorkbook.toString("base64"),
      });
    } catch (error) {
      context.error("Tracking sync failed", safeErrorMessage(error, [
        process.env.TRACKING_API_USERNAME,
        process.env.TRACKING_API_PASSWORD,
      ]));
      const status = error.statusCode || error.status || 500;
      return response(request, status, {
        message: status >= 500 ? "Server error." : error.message,
      });
    }
  },
});
