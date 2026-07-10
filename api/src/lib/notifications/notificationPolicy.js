const crypto = require("node:crypto");

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DELIVERY_STATES = {
  QUEUED: "queued",
  PROVIDER_ACCEPTED: "provider_accepted",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
  EXPIRED: "expired",
  BLOCKED: "blocked",
};

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)];
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withDigitsOnly = raw.replace(/[^\d+]/g, "");
  if (withDigitsOnly.startsWith("+")) {
    return `+${withDigitsOnly.slice(1).replace(/\D/g, "")}`;
  }
  const digits = withDigitsOnly.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return digits ? `+${digits}` : "";
}

function maskPhone(value) {
  const normalized = normalizePhone(value);
  if (normalized.length <= 5) return normalized ? "[masked]" : "";
  return `${normalized.slice(0, 3)}******${normalized.slice(-2)}`;
}

function buildIdempotencyKey({ sourceEventId, targetUserId, templateId, channel, scheduleWindow }) {
  const stable = [
    sourceEventId || "manual",
    targetUserId || "unknown-user",
    templateId || "default-template",
    channel || "in-app",
    scheduleWindow || "immediate",
  ].join("|");
  return crypto.createHash("sha256").update(stable).digest("hex");
}

function timeToMinutes(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function isWithinQuietHours({ quietHoursStart, quietHoursEnd }, currentMinutes) {
  const start = timeToMinutes(quietHoursStart);
  const end = timeToMinutes(quietHoursEnd);
  if (start === null || end === null || start === end) return false;
  if (start < end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
}

function shouldSuppressForQuietHours(preferences = {}, event = {}, currentMinutes) {
  if (event.priority === "critical" || event.quietHoursOverride) return false;
  return isWithinQuietHours(preferences, currentMinutes);
}

function userHasSite(user, sites) {
  const requiredSites = normalizeList(sites).map((site) => site.trim().toLowerCase());
  if (!requiredSites.length) return true;
  const userSites = normalizeList(user.siteAccess).map((site) => site.trim().toLowerCase());
  if (!userSites.length) return false;
  return requiredSites.some((site) => userSites.includes(site));
}

function resolveTargetUsers(users, criteria = {}) {
  const selectedUserIds = new Set(normalizeList(criteria.userIds));
  const roles = new Set(normalizeList(criteria.roles));
  return users.filter((user) => {
    if (!user || user.isActive === false || user.mustChangePassword) return false;
    if (selectedUserIds.size && !selectedUserIds.has(user.userId)) return false;
    if (roles.size && !roles.has(user.role)) return false;
    if (!userHasSite(user, criteria.sites)) return false;
    return true;
  });
}

function renderTemplate(template, variables = {}) {
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function canUseWhatsApp(preferences = {}, consent = {}) {
  return preferences.whatsappEnabled === true
    && consent.status === "opted_in"
    && Boolean(normalizePhone(consent.phoneNumber));
}

function createDeliveryRecord({ eventId, targetUserId, channel, providerMessageId = "", status = DELIVERY_STATES.QUEUED, error = "" }) {
  return {
    id: crypto.randomUUID(),
    eventId,
    targetUserId,
    channel,
    providerMessageId,
    status,
    error,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  DELIVERY_STATES,
  buildIdempotencyKey,
  canUseWhatsApp,
  createDeliveryRecord,
  maskPhone,
  normalizePhone,
  renderTemplate,
  resolveTargetUsers,
  shouldSuppressForQuietHours,
};

