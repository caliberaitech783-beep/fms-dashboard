const webpush = require("web-push");

const DEFAULT_TTL_SECONDS = 60 * 60;
const BLOCKED_METADATA_KEYS = /(password|token|secret|credential|api.?key|phone|mobile)/i;

function hasVapidConfig(env = process.env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

function sanitizeMetadata(metadata = {}) {
  return Object.entries(metadata || {}).reduce((safe, [key, value]) => {
    if (BLOCKED_METADATA_KEYS.test(key)) return safe;
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      safe[key] = value;
    }
    return safe;
  }, {});
}

function createPushPayload(notification) {
  return JSON.stringify({
    notificationId: notification.id,
    title: String(notification.title || "CMLL FMS").slice(0, 140),
    body: String(notification.body || "You have a new notification.").slice(0, 240),
    severity: notification.severity,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    deepLinkUrl: notification.deepLinkUrl || "/?section=notifications",
    entityType: notification.entityType || "",
    entityId: notification.entityId || "",
    expiresAt: notification.expiresAt || "",
    metadata: sanitizeMetadata(notification.metadata),
  });
}

async function sendWebPush(subscription, notification, { env = process.env, ttl = DEFAULT_TTL_SECONDS } = {}) {
  if (!hasVapidConfig(env)) {
    return {
      ok: false,
      status: "blocked",
      permanentFailure: false,
      reason: "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT are required.",
    };
  }

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  try {
    const providerResponse = await webpush.sendNotification(subscription, createPushPayload(notification), { TTL: ttl });
    return {
      ok: true,
      status: "provider_accepted",
      providerMessageId: providerResponse.headers?.location || "",
      statusCode: providerResponse.statusCode || null,
    };
  } catch (error) {
    const statusCode = error.statusCode || error.status || null;
    const permanentFailure = statusCode === 404 || statusCode === 410;
    return {
      ok: false,
      status: permanentFailure ? "revoked" : "failed",
      permanentFailure,
      statusCode,
      reason: permanentFailure ? "Push subscription is expired or invalid." : "Push provider request failed.",
    };
  }
}

module.exports = {
  createPushPayload,
  hasVapidConfig,
  sanitizeMetadata,
  sendWebPush,
};
