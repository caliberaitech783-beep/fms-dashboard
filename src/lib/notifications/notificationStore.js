const crypto = require("node:crypto");
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const { buildIdempotencyKey, maskPhone, normalizePhone, resolveTargetUsers } = require("./notificationPolicy");
const { hasVapidConfig, sendWebPush } = require("./pushSender");

const PARTITION = {
  DEVICE: "DEVICE",
  PREF: "PREF",
  INBOX: "INBOX",
  CONSENT: "CONSENT",
  DELIVERY: "DELIVERY",
  RULE: "RULE",
  TEMPLATE: "TEMPLATE",
  WEBHOOK: "WEBHOOK",
};

let setupPromise = null;
let devicesTable = null;
let preferencesTable = null;
let inboxTable = null;
let deliveriesTable = null;
let whatsappTable = null;
let rulesTable = null;
let templatesTable = null;

function now() {
  return new Date().toISOString();
}

function tableName(envName, fallback) {
  return process.env[envName] || fallback;
}

function getConnectionString() {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw Object.assign(new Error("AzureWebJobsStorage is not configured."), { statusCode: 500 });
  }
  return connectionString;
}

function getTableClient(name) {
  const connectionString = getConnectionString();
  if (connectionString === "UseDevelopmentStorage=true" || connectionString.startsWith("DefaultEndpointsProtocol=")) {
    return TableClient.fromConnectionString(connectionString, name);
  }

  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.STORAGE_ACCOUNT_KEY;
  if (!accountName || !accountKey) {
    throw Object.assign(new Error("Storage account credentials are not configured."), { statusCode: 500 });
  }

  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    name,
    new AzureNamedKeyCredential(accountName, accountKey),
  );
}

function rowKeyFor(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function decodeRowKey(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

async function setupTables() {
  if (!setupPromise) {
    setupPromise = (async () => {
      devicesTable = getTableClient(tableName("NOTIFICATION_DEVICES_TABLE_NAME", "FmsUserDevices"));
      preferencesTable = getTableClient(tableName("NOTIFICATION_PREFERENCES_TABLE_NAME", "FmsNotificationPreferences"));
      inboxTable = getTableClient(tableName("NOTIFICATION_INBOX_TABLE_NAME", "FmsNotificationInbox"));
      deliveriesTable = getTableClient(tableName("NOTIFICATION_DELIVERIES_TABLE_NAME", "FmsNotificationDeliveries"));
      whatsappTable = getTableClient(tableName("WHATSAPP_CONSENTS_TABLE_NAME", "FmsWhatsAppConsents"));
      rulesTable = getTableClient(tableName("NOTIFICATION_RULES_TABLE_NAME", "FmsNotificationRules"));
      templatesTable = getTableClient(tableName("NOTIFICATION_TEMPLATES_TABLE_NAME", "FmsNotificationTemplates"));
      await Promise.all([
        devicesTable.createTable().catch(ignoreConflict),
        preferencesTable.createTable().catch(ignoreConflict),
        inboxTable.createTable().catch(ignoreConflict),
        deliveriesTable.createTable().catch(ignoreConflict),
        whatsappTable.createTable().catch(ignoreConflict),
        rulesTable.createTable().catch(ignoreConflict),
        templatesTable.createTable().catch(ignoreConflict),
      ]);
    })();
  }
  await setupPromise;
}

function ignoreConflict(error) {
  if (error.statusCode !== 409) throw error;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function deviceFromEntity(entity) {
  return {
    id: entity.deviceId,
    userId: decodeRowKey(entity.partitionKey),
    deviceId: entity.deviceId,
    label: entity.label || "Unnamed device",
    platform: entity.platform || "unknown",
    appType: entity.appType || "web",
    appVersion: entity.appVersion || "",
    pushSubscription: parseJson(entity.pushSubscriptionJson, null),
    createdAt: entity.createdAt,
    lastSeenAt: entity.lastSeenAt || null,
    lastSuccessfulDeliveryAt: entity.lastSuccessfulDeliveryAt || null,
    revokedAt: entity.revokedAt || null,
    isActive: entity.isActive !== false,
  };
}

function inboxFromEntity(entity) {
  return {
    id: entity.notificationId,
    userId: decodeRowKey(entity.partitionKey),
    title: entity.title,
    body: entity.body,
    severity: entity.severity || "info",
    deepLinkUrl: entity.deepLinkUrl || "/",
    entityType: entity.entityType || "",
    entityId: entity.entityId || "",
    metadata: parseJson(entity.metadataJson, {}),
    readAt: entity.readAt || null,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt || null,
  };
}

function preferencesFromEntity(entity, userId) {
  return {
    userId,
    inAppEnabled: entity?.inAppEnabled !== false,
    pushEnabled: entity?.pushEnabled === true,
    desktopEnabled: entity?.desktopEnabled === true,
    whatsappEnabled: entity?.whatsappEnabled === true,
    assignmentNotifications: entity?.assignmentNotifications !== false,
    statusChangeNotifications: entity?.statusChangeNotifications !== false,
    revertReminders: entity?.revertReminders !== false,
    escalationNotifications: entity?.escalationNotifications !== false,
    shiftNotifications: entity?.shiftNotifications !== false,
    announcements: entity?.announcements !== false,
    quietHoursStart: entity?.quietHoursStart || "22:00",
    quietHoursEnd: entity?.quietHoursEnd || "06:00",
    timezone: entity?.timezone || "Asia/Kolkata",
    updatedAt: entity?.updatedAt || null,
  };
}

function pushEndpointFromSubscription(subscription) {
  return subscription && typeof subscription === "object" ? String(subscription.endpoint || "") : "";
}

async function deactivateDuplicateSubscriptions(ownerUserId, ownerDeviceId, endpoint) {
  if (!endpoint) return 0;
  let revoked = 0;
  for await (const entity of devicesTable.listEntities()) {
    if (entity.isActive === false) continue;
    const subscription = parseJson(entity.pushSubscriptionJson, null);
    if (pushEndpointFromSubscription(subscription) !== endpoint) continue;
    const entityUserId = decodeRowKey(entity.partitionKey);
    if (entityUserId === ownerUserId && entity.deviceId === ownerDeviceId) continue;
    entity.isActive = false;
    entity.revokedAt = now();
    entity.pushSubscriptionJson = "";
    await devicesTable.updateEntity(entity, "Replace");
    revoked += 1;
  }
  return revoked;
}

async function saveDevice(userId, input = {}) {
  await setupTables();
  const createdAt = now();
  const deviceId = String(input.deviceId || crypto.randomUUID()).trim();
  const partitionKey = rowKeyFor(userId);
  const rowKey = rowKeyFor(deviceId);
  let existing = null;
  try {
    existing = await devicesTable.getEntity(partitionKey, rowKey);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }

  const endpoint = pushEndpointFromSubscription(input.pushSubscription);
  await deactivateDuplicateSubscriptions(userId, deviceId, endpoint);

  const entity = {
    partitionKey,
    rowKey,
    deviceId,
    label: String(input.label || existing?.label || "Current device").slice(0, 120),
    platform: String(input.platform || existing?.platform || "web").slice(0, 60),
    appType: String(input.appType || existing?.appType || "pwa").slice(0, 40),
    appVersion: String(input.appVersion || existing?.appVersion || "").slice(0, 40),
    pushSubscriptionJson: input.pushSubscription ? JSON.stringify(input.pushSubscription) : existing?.pushSubscriptionJson || "",
    createdAt: existing?.createdAt || createdAt,
    lastSeenAt: createdAt,
    lastSuccessfulDeliveryAt: existing?.lastSuccessfulDeliveryAt || "",
    revokedAt: "",
    isActive: true,
  };
  await devicesTable.upsertEntity(entity, "Replace");
  return deviceFromEntity(entity);
}

async function listDevices(userId) {
  await setupTables();
  const rows = [];
  for await (const entity of devicesTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${rowKeyFor(userId)}'` } })) {
    rows.push(deviceFromEntity(entity));
  }
  return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function listActivePushDevices(userId) {
  return (await listDevices(userId)).filter((device) => device.isActive && pushEndpointFromSubscription(device.pushSubscription));
}

async function revokeDevice(userId, deviceId) {
  await setupTables();
  const partitionKey = rowKeyFor(userId);
  const rowKey = rowKeyFor(deviceId);
  const entity = await devicesTable.getEntity(partitionKey, rowKey);
  entity.isActive = false;
  entity.revokedAt = now();
  entity.pushSubscriptionJson = "";
  await devicesTable.updateEntity(entity, "Replace");
  return deviceFromEntity(entity);
}

async function revokeDeviceByEndpoint(endpoint) {
  await setupTables();
  let revoked = 0;
  for await (const entity of devicesTable.listEntities()) {
    const subscription = parseJson(entity.pushSubscriptionJson, null);
    if (pushEndpointFromSubscription(subscription) === endpoint && entity.isActive !== false) {
      entity.isActive = false;
      entity.revokedAt = now();
      entity.pushSubscriptionJson = "";
      await devicesTable.updateEntity(entity, "Replace");
      revoked += 1;
    }
  }
  return { revoked };
}

async function getPreferences(userId) {
  await setupTables();
  try {
    return preferencesFromEntity(await preferencesTable.getEntity(PARTITION.PREF, rowKeyFor(userId)), userId);
  } catch (error) {
    if (error.statusCode === 404) return preferencesFromEntity(null, userId);
    throw error;
  }
}

async function savePreferences(userId, input = {}) {
  await setupTables();
  const current = await getPreferences(userId);
  const next = {
    ...current,
    ...input,
    userId,
    updatedAt: now(),
  };
  await preferencesTable.upsertEntity({
    partitionKey: PARTITION.PREF,
    rowKey: rowKeyFor(userId),
    ...next,
  }, "Replace");
  return next;
}

async function createInboxNotification(userId, input = {}) {
  await setupTables();
  const createdAt = now();
  const notificationId = input.notificationId || crypto.randomUUID();
  const entity = {
    partitionKey: rowKeyFor(userId),
    rowKey: `${createdAt}-${notificationId}`,
    notificationId,
    title: String(input.title || "Notification").slice(0, 140),
    body: String(input.body || "").slice(0, 500),
    severity: String(input.severity || "info"),
    deepLinkUrl: String(input.deepLinkUrl || "/"),
    entityType: String(input.entityType || ""),
    entityId: String(input.entityId || ""),
    metadataJson: JSON.stringify(input.metadata || {}),
    readAt: "",
    createdAt,
    expiresAt: input.expiresAt || "",
  };
  await inboxTable.createEntity(entity);
  return inboxFromEntity(entity);
}

async function listInbox(userId, { unreadOnly = false, limit = 100 } = {}) {
  await setupTables();
  const rows = [];
  for await (const entity of inboxTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${rowKeyFor(userId)}'` } })) {
    const notification = inboxFromEntity(entity);
    if (!unreadOnly || !notification.readAt) rows.push(notification);
  }
  return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
}

async function markRead(userId, notificationId) {
  await setupTables();
  for await (const entity of inboxTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${rowKeyFor(userId)}'` } })) {
    if (entity.notificationId === notificationId) {
      entity.readAt = entity.readAt || now();
      await inboxTable.updateEntity(entity, "Replace");
      return inboxFromEntity(entity);
    }
  }
  throw Object.assign(new Error("Notification not found."), { statusCode: 404 });
}

async function markAllRead(userId) {
  await setupTables();
  const updatedAt = now();
  let count = 0;
  for await (const entity of inboxTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${rowKeyFor(userId)}'` } })) {
    if (!entity.readAt) {
      entity.readAt = updatedAt;
      await inboxTable.updateEntity(entity, "Replace");
      count += 1;
    }
  }
  return { updated: count };
}

async function recordDelivery(input) {
  await setupTables();
  const createdAt = now();
  const rowKey = input.idempotencyKey || buildIdempotencyKey(input);
  let existing = null;
  try {
    existing = await deliveriesTable.getEntity(PARTITION.DELIVERY, rowKey);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
  const attemptCount = Number(input.attemptCount ?? existing?.attemptCount ?? 0);
  const permanentFailure = input.permanentFailure === true || existing?.permanentFailure === true;
  const failedTransiently = input.status === "failed" && !permanentFailure;
  const retryDelayMs = Math.min(60 * 60 * 1000, (2 ** Math.max(0, attemptCount)) * 60 * 1000);
  const entity = {
    partitionKey: PARTITION.DELIVERY,
    rowKey,
    idempotencyKey: rowKey,
    eventId: input.sourceEventId || input.eventId || "manual",
    targetUserId: input.targetUserId,
    channel: input.channel,
    status: input.status,
    providerMessageId: input.providerMessageId || "",
    failureReason: input.failureReason || "",
    attemptCount,
    maxAttempts: input.maxAttempts || existing?.maxAttempts || 5,
    permanentFailure,
    nextAttemptAt: input.nextAttemptAt || (failedTransiently ? new Date(Date.now() + retryDelayMs).toISOString() : ""),
    createdAt: existing?.createdAt || createdAt,
    updatedAt: createdAt,
  };
  await deliveriesTable.upsertEntity(entity, "Merge");
  return entity;
}

async function listDeliveries({ limit = 100 } = {}) {
  await setupTables();
  const rows = [];
  for await (const entity of deliveriesTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION.DELIVERY}'` } })) {
    rows.push({
      idempotencyKey: entity.idempotencyKey,
      eventId: entity.eventId,
      targetUserId: entity.targetUserId,
      channel: entity.channel,
      status: entity.status,
      providerMessageId: entity.providerMessageId || "",
      failureReason: entity.failureReason || "",
      attemptCount: entity.attemptCount || 0,
      maxAttempts: entity.maxAttempts || 5,
      permanentFailure: entity.permanentFailure === true,
      nextAttemptAt: entity.nextAttemptAt || "",
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
  return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
}

async function retryDelivery(idempotencyKey) {
  await setupTables();
  const entity = await deliveriesTable.getEntity(PARTITION.DELIVERY, idempotencyKey);
  if (!["failed", "blocked"].includes(entity.status)) {
    return { idempotencyKey, status: entity.status, retried: false };
  }
  if (entity.permanentFailure === true) {
    return { idempotencyKey, status: entity.status, retried: false, reason: "Permanent failure cannot be retried." };
  }
  const attemptCount = Number(entity.attemptCount || 0);
  const maxAttempts = Number(entity.maxAttempts || 5);
  if (attemptCount >= maxAttempts) {
    return { idempotencyKey, status: entity.status, retried: false, reason: "Maximum retry attempts reached." };
  }
  entity.status = "queued";
  entity.failureReason = "";
  entity.attemptCount = attemptCount + 1;
  entity.nextAttemptAt = "";
  entity.updatedAt = now();
  await deliveriesTable.updateEntity(entity, "Replace");
  return { idempotencyKey, status: "queued", retried: true, attemptCount: entity.attemptCount };
}

async function sendPushForNotification(user, notification) {
  const devices = await listActivePushDevices(user.userId);
  if (!devices.length) {
    await recordDelivery({
      sourceEventId: notification.id,
      targetUserId: user.userId,
      templateId: "manual-admin",
      channel: "push",
      scheduleWindow: "immediate",
      status: "blocked",
      failureReason: "No active push subscription registered.",
    });
    return [{ userId: user.userId, channel: "push", status: "blocked" }];
  }

  const deliveries = [];
  for (const device of devices) {
    const deliveryInput = {
      sourceEventId: notification.id,
      targetUserId: user.userId,
      templateId: "manual-admin",
      channel: "push",
      scheduleWindow: "immediate",
    };
    const pushResult = hasVapidConfig()
      ? await sendWebPush(device.pushSubscription, notification)
      : { status: "blocked", reason: "VAPID keys are not configured.", permanentFailure: false };
    await recordDelivery({
      ...deliveryInput,
      status: pushResult.status,
      providerMessageId: pushResult.providerMessageId || "",
      failureReason: pushResult.reason || "",
      permanentFailure: pushResult.permanentFailure === true,
    });
    if (pushResult.permanentFailure && device.pushSubscription?.endpoint) {
      await revokeDeviceByEndpoint(device.pushSubscription.endpoint);
    }
    deliveries.push({ userId: user.userId, deviceId: device.deviceId, channel: "push", status: pushResult.status });
  }
  return deliveries;
}

async function sendInAppNotification({ actor, users, criteria = {}, title, body, severity = "info", channels = ["in-app"], deepLinkUrl = "/", metadata = {} }) {
  const targets = resolveTargetUsers(users, criteria);
  const results = [];
  for (const user of targets) {
    if (channels.includes("in-app")) {
      const notification = await createInboxNotification(user.userId, {
        title,
        body,
        severity,
        deepLinkUrl,
        metadata: {
          ...metadata,
          actorUserId: actor?.userId || null,
        },
      });
      await recordDelivery({
        sourceEventId: notification.id,
        targetUserId: user.userId,
        templateId: "manual-admin",
        channel: "in-app",
        scheduleWindow: "immediate",
        status: "queued",
      });
      results.push({ userId: user.userId, notificationId: notification.id, channel: "in-app", status: "queued" });
    }
    if (channels.includes("push")) {
      const notification = await createInboxNotification(user.userId, {
        title,
        body,
        severity,
        deepLinkUrl,
        metadata: { ...metadata, actorUserId: actor?.userId || null, channel: "push_shadow" },
      });
      const pushResults = await sendPushForNotification(user, notification);
      results.push(...pushResults);
    }
    if (channels.includes("whatsapp")) {
      await recordDelivery({
        sourceEventId: `whatsapp-${Date.now()}`,
        targetUserId: user.userId,
        templateId: "manual-admin",
        channel: "whatsapp",
        scheduleWindow: "immediate",
        status: process.env.WHATSAPP_ACCESS_TOKEN ? "queued" : "blocked",
        failureReason: process.env.WHATSAPP_ACCESS_TOKEN ? "" : "WHATSAPP_ACCESS_TOKEN is not configured.",
      });
    }
  }
  return { targetCount: targets.length, results };
}

async function getWhatsAppConsent(userId) {
  await setupTables();
  try {
    const entity = await whatsappTable.getEntity(PARTITION.CONSENT, rowKeyFor(userId));
    return {
      userId,
      phoneNumber: entity.phoneNumber || "",
      maskedPhoneNumber: maskPhone(entity.phoneNumber),
      status: entity.status || "not_configured",
      optedInAt: entity.optedInAt || null,
      optedOutAt: entity.optedOutAt || null,
      updatedAt: entity.updatedAt || null,
    };
  } catch (error) {
    if (error.statusCode === 404) {
      return { userId, phoneNumber: "", maskedPhoneNumber: "", status: "not_configured", optedInAt: null, optedOutAt: null, updatedAt: null };
    }
    throw error;
  }
}

async function saveWhatsAppContact(userId, phoneNumber) {
  await setupTables();
  const current = await getWhatsAppConsent(userId);
  const normalized = normalizePhone(phoneNumber);
  const updatedAt = now();
  await whatsappTable.upsertEntity({
    partitionKey: PARTITION.CONSENT,
    rowKey: rowKeyFor(userId),
    userId,
    phoneNumber: normalized,
    status: current.status === "opted_in" ? "opted_in" : "contact_registered",
    optedInAt: current.optedInAt || "",
    optedOutAt: current.optedOutAt || "",
    updatedAt,
  }, "Replace");
  return getWhatsAppConsent(userId);
}

async function setWhatsAppConsent(userId, optedIn) {
  await setupTables();
  const current = await getWhatsAppConsent(userId);
  if (!current.phoneNumber) {
    throw Object.assign(new Error("WhatsApp phone number is required before consent can be recorded."), { statusCode: 400 });
  }
  const updatedAt = now();
  await whatsappTable.upsertEntity({
    partitionKey: PARTITION.CONSENT,
    rowKey: rowKeyFor(userId),
    userId,
    phoneNumber: current.phoneNumber,
    status: optedIn ? "opted_in" : "opted_out",
    optedInAt: optedIn ? updatedAt : current.optedInAt || "",
    optedOutAt: optedIn ? "" : updatedAt,
    updatedAt,
  }, "Replace");
  return getWhatsAppConsent(userId);
}

async function recordWhatsAppWebhook(eventId, payload) {
  await setupTables();
  const id = eventId || crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex");
  await whatsappTable.upsertEntity({
    partitionKey: PARTITION.WEBHOOK,
    rowKey: rowKeyFor(id),
    eventId: id,
    payloadJson: JSON.stringify(payload || {}).slice(0, 8000),
    receivedAt: now(),
  }, "Merge");
  return { eventId: id, recorded: true };
}

module.exports = {
  createInboxNotification,
  getPreferences,
  getWhatsAppConsent,
  listActivePushDevices,
  listDevices,
  listDeliveries,
  listInbox,
  markAllRead,
  markRead,
  recordWhatsAppWebhook,
  retryDelivery,
  revokeDevice,
  revokeDeviceByEndpoint,
  saveDevice,
  savePreferences,
  saveWhatsAppContact,
  sendInAppNotification,
  setWhatsAppConsent,
};
