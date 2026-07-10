const { app } = require("@azure/functions");
const store = require("../lib/authStore");
const notificationStore = require("../lib/notifications/notificationStore");
const { verifyChallenge, verifyWhatsAppSignature } = require("../lib/notifications/whatsappSecurity");

function allowedOrigin(request) {
  const configured = (process.env.ALLOWED_ORIGINS || "https://fms.cmll.in")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin");

  if (configured.includes("*")) return "*";
  if (origin && configured.includes(origin)) return origin;
  return configured[0] || "https://fms.cmll.in";
}

function response(request, status, body, extraHeaders = {}) {
  return {
    status,
    jsonBody: body,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(request),
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Hub-Signature-256",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
      ...extraHeaders,
    },
  };
}

function textResponse(request, status, body) {
  return {
    status,
    body,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(request),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Hub-Signature-256",
      "Content-Type": "text/plain; charset=utf-8",
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
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Hub-Signature-256",
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

async function readText(request) {
  try {
    return await request.text();
  } catch {
    return "";
  }
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireActor(request) {
  const token = bearerToken(request);
  if (!token) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
  }
  const payload = store.verifyToken(token);
  const actor = await store.getUser(payload.sub);
  if (!actor || !actor.isActive) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
  }
  return actor;
}

function requireSuperAdmin(actor) {
  if (actor.role !== "Super Admin") {
    throw Object.assign(new Error("Only Super Admin users can perform this action."), { statusCode: 403 });
  }
}

async function handle(request, context, handler) {
  if (request.method === "OPTIONS") return emptyResponse(request);
  try {
    return await handler();
  } catch (error) {
    context.error("Notification API failed", error.message);
    const status = error.statusCode || error.status || 500;
    return response(request, status, { message: status >= 500 ? "Server error." : error.message });
  }
}

function queryBoolean(request, name) {
  return request.query.get(name) === "true";
}

function deviceInputFromBody(body) {
  return {
    deviceId: body.deviceId,
    label: body.label || body.deviceName,
    platform: body.platform,
    appType: body.appType,
    appVersion: body.appVersion,
    pushSubscription: body.pushSubscription || body.subscription || null,
  };
}

app.http("notificationDevices", {
  route: "notifications/devices",
  authLevel: "anonymous",
  methods: ["GET", "POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    if (request.method === "GET") {
      return response(request, 200, await notificationStore.listDevices(actor.userId));
    }

    const body = await readJson(request);
    const device = await notificationStore.saveDevice(actor.userId, {
      deviceId: body.deviceId,
      label: body.label,
      platform: body.platform,
      appType: body.appType,
      appVersion: body.appVersion,
      pushSubscription: body.pushSubscription,
    });
    await store.addAuditLog({ actor, action: "DEVICE_REGISTERED", targetType: "Device", targetId: device.deviceId });
    return response(request, 200, device);
  }),
});

app.http("devicesRegister", {
  route: "devices/register",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    const body = await readJson(request);
    const device = await notificationStore.saveDevice(actor.userId, deviceInputFromBody(body));
    await store.addAuditLog({ actor, action: "DEVICE_REGISTERED", targetType: "Device", targetId: device.deviceId });
    return response(request, 200, device);
  }),
});

app.http("devicesList", {
  route: "devices",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    return response(request, 200, await notificationStore.listDevices(actor.userId));
  }),
});

app.http("devicesDelete", {
  route: "devices/{deviceId}",
  authLevel: "anonymous",
  methods: ["DELETE", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    const device = await notificationStore.revokeDevice(actor.userId, decodeURIComponent(request.params.deviceId || ""));
    await store.addAuditLog({ actor, action: "DEVICE_REVOKED", targetType: "Device", targetId: device.deviceId });
    return response(request, 200, device);
  }),
});

app.http("pushSubscribe", {
  route: "push/subscribe",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    const body = await readJson(request);
    const device = await notificationStore.saveDevice(actor.userId, deviceInputFromBody({
      ...body,
      pushSubscription: body.subscription || body.pushSubscription,
    }));
    await store.addAuditLog({ actor, action: "PUSH_SUBSCRIBED", targetType: "Device", targetId: device.deviceId });
    return response(request, 200, device);
  }),
});

app.http("pushUnsubscribe", {
  route: "push/unsubscribe",
  authLevel: "anonymous",
  methods: ["DELETE", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    const body = await readJson(request);
    const result = body.deviceId
      ? await notificationStore.revokeDevice(actor.userId, body.deviceId)
      : await notificationStore.revokeDeviceByEndpoint(body.endpoint || "");
    await store.addAuditLog({ actor, action: "PUSH_UNSUBSCRIBED", targetType: "Device", targetId: body.deviceId || null });
    return response(request, 200, result);
  }),
});

app.http("notificationDeviceRevoke", {
  route: "notifications/devices/{deviceId}",
  authLevel: "anonymous",
  methods: ["DELETE", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    const device = await notificationStore.revokeDevice(actor.userId, decodeURIComponent(request.params.deviceId || ""));
    await store.addAuditLog({ actor, action: "DEVICE_REVOKED", targetType: "Device", targetId: device.deviceId });
    return response(request, 200, device);
  }),
});

app.http("notificationPreferences", {
  route: "notifications/preferences",
  authLevel: "anonymous",
  methods: ["GET", "PATCH", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    if (request.method === "GET") {
      return response(request, 200, await notificationStore.getPreferences(actor.userId));
    }

    const body = await readJson(request);
    const preferences = await notificationStore.savePreferences(actor.userId, body);
    await store.addAuditLog({ actor, action: "NOTIFICATION_PREFERENCES_UPDATED", targetType: "User", targetId: actor.userId });
    return response(request, 200, preferences);
  }),
});

app.http("notificationPreferencesCanonical", {
  route: "notification-preferences",
  authLevel: "anonymous",
  methods: ["GET", "PUT", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    if (request.method === "GET") {
      return response(request, 200, await notificationStore.getPreferences(actor.userId));
    }

    const body = await readJson(request);
    const preferences = await notificationStore.savePreferences(actor.userId, body);
    await store.addAuditLog({ actor, action: "NOTIFICATION_PREFERENCES_UPDATED", targetType: "User", targetId: actor.userId });
    return response(request, 200, preferences);
  }),
});

app.http("notificationInbox", {
  route: "notifications/inbox",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    const inbox = await notificationStore.listInbox(actor.userId, {
      unreadOnly: queryBoolean(request, "unreadOnly"),
      limit: Number(request.query.get("limit") || 100),
    });
    return response(request, 200, inbox);
  }),
});

app.http("notificationsCanonical", {
  route: "notifications",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    return response(request, 200, await notificationStore.listInbox(actor.userId, {
      unreadOnly: queryBoolean(request, "unreadOnly"),
      limit: Number(request.query.get("limit") || 100),
    }));
  }),
});

app.http("notificationRead", {
  route: "notifications/inbox/{notificationId}/read",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    return response(request, 200, await notificationStore.markRead(actor.userId, decodeURIComponent(request.params.notificationId || "")));
  }),
});

app.http("notificationReadCanonical", {
  route: "notifications/{notificationId}/read",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    return response(request, 200, await notificationStore.markRead(actor.userId, decodeURIComponent(request.params.notificationId || "")));
  }),
});

app.http("notificationReadAll", {
  route: "notifications/inbox/read-all",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    return response(request, 200, await notificationStore.markAllRead(actor.userId));
  }),
});

app.http("notificationReadAllCanonical", {
  route: "notifications/read-all",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    return response(request, 200, await notificationStore.markAllRead(actor.userId));
  }),
});

app.http("notificationTest", {
  route: "notifications/test",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    const result = await notificationStore.sendInAppNotification({
      actor,
      users: [store.safeUser(actor)],
      criteria: { userIds: [actor.userId] },
      title: "Test notification",
      body: "Your in-app notification channel is working.",
      severity: "info",
      channels: ["in-app"],
      deepLinkUrl: "/?section=notifications",
    });
    return response(request, 200, result);
  }),
});

app.http("whatsappContact", {
  route: "notifications/whatsapp/contact",
  authLevel: "anonymous",
  methods: ["GET", "POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    if (request.method === "GET") {
      return response(request, 200, await notificationStore.getWhatsAppConsent(actor.userId));
    }

    const body = await readJson(request);
    const contact = await notificationStore.saveWhatsAppContact(actor.userId, body.phoneNumber);
    await store.addAuditLog({ actor, action: "WHATSAPP_CONTACT_UPDATED", targetType: "User", targetId: actor.userId });
    return response(request, 200, contact);
  }),
});

app.http("whatsappConsent", {
  route: "notifications/whatsapp/consent",
  authLevel: "anonymous",
  methods: ["POST", "DELETE", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    const consent = await notificationStore.setWhatsAppConsent(actor.userId, request.method === "POST");
    await store.addAuditLog({
      actor,
      action: request.method === "POST" ? "WHATSAPP_OPT_IN" : "WHATSAPP_OPT_OUT",
      targetType: "User",
      targetId: actor.userId,
    });
    return response(request, 200, consent);
  }),
});

app.http("adminNotificationPreview", {
  route: "admin/notifications/preview-targets",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    const body = await readJson(request);
    const users = await store.listUsers();
    const targetUsers = require("../lib/notifications/notificationPolicy").resolveTargetUsers(users, body.criteria || {});
    return response(request, 200, {
      targetCount: targetUsers.length,
      users: targetUsers.map((user) => ({ userId: user.userId, name: user.name, role: user.role })),
    });
  }),
});

app.http("adminNotificationSend", {
  route: "admin/notifications/send",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    const body = await readJson(request);
    const users = await store.listUsers();
    const channels = Array.isArray(body.channels) && body.channels.length ? body.channels : ["in-app"];
    if (body.confirmLargeSend !== true && body.criteria?.allUsers === true) {
      throw Object.assign(new Error("Large broadcasts require explicit confirmation."), { statusCode: 400 });
    }

    const result = await notificationStore.sendInAppNotification({
      actor,
      users,
      criteria: body.criteria || {},
      title: body.title,
      body: body.body,
      severity: body.severity || "info",
      channels,
      deepLinkUrl: body.deepLinkUrl || "/?section=notifications",
      metadata: { source: "admin_notification" },
    });
    await store.addAuditLog({
      actor,
      action: "ADMIN_NOTIFICATION_SENT",
      targetType: "Notification",
      targetId: null,
      metadata: { targetCount: result.targetCount, channels: channels.join(",") },
    });
    return response(request, 200, result);
  }),
});

app.http("adminNotificationSchedule", {
  route: "admin/notifications/schedule",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    const body = await readJson(request);
    const scheduled = await notificationStore.createInboxNotification(actor.userId, {
      title: "Scheduled notification draft",
      body: `Scheduled for ${body.scheduledAt || "unspecified time"}. Worker activation is pending queue setup.`,
      severity: "warning",
      deepLinkUrl: "/?section=admin-notifications",
      metadata: { type: "scheduled_notification_draft" },
    });
    return response(request, 202, { scheduledId: scheduled.id, status: "queued_for_worker_setup" });
  }),
});

app.http("adminNotificationCancel", {
  route: "admin/notifications/schedule/{scheduleId}",
  authLevel: "anonymous",
  methods: ["DELETE", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    await store.addAuditLog({
      actor,
      action: "ADMIN_NOTIFICATION_CANCEL_REQUESTED",
      targetType: "NotificationSchedule",
      targetId: decodeURIComponent(request.params.scheduleId || ""),
    });
    return response(request, 202, { status: "cancel_requested" });
  }),
});

app.http("adminNotificationCancelCanonical", {
  route: "admin/notifications/{scheduleId}/schedule",
  authLevel: "anonymous",
  methods: ["DELETE", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    await store.addAuditLog({
      actor,
      action: "ADMIN_NOTIFICATION_CANCEL_REQUESTED",
      targetType: "NotificationSchedule",
      targetId: decodeURIComponent(request.params.scheduleId || ""),
    });
    return response(request, 202, { status: "cancel_requested" });
  }),
});

app.http("adminNotificationDeliveries", {
  route: "admin/notification-deliveries",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    return response(request, 200, await notificationStore.listDeliveries({ limit: Number(request.query.get("limit") || 100) }));
  }),
});

app.http("adminNotificationDeliveryRetry", {
  route: "admin/notification-deliveries/{deliveryId}/retry",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    const result = await notificationStore.retryDelivery(decodeURIComponent(request.params.deliveryId || ""));
    await store.addAuditLog({
      actor,
      action: "ADMIN_NOTIFICATION_RETRY_REQUESTED",
      targetType: "NotificationDelivery",
      targetId: result.idempotencyKey,
    });
    return response(request, 202, result);
  }),
});

app.http("whatsappWebhook", {
  route: "webhooks/whatsapp",
  authLevel: "anonymous",
  methods: ["GET", "POST", "OPTIONS"],
  handler: async (request, context) => {
    if (request.method === "OPTIONS") return emptyResponse(request);
    try {
      if (request.method === "GET") {
        const challenge = verifyChallenge({
          mode: request.query.get("hub.mode"),
          token: request.query.get("hub.verify_token"),
          challenge: request.query.get("hub.challenge"),
          verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
        });
        return challenge === null ? textResponse(request, 403, "Forbidden") : textResponse(request, 200, challenge);
      }

      const rawBody = await readText(request);
      const valid = verifyWhatsAppSignature({
        rawBody,
        headerSignature: request.headers.get("x-hub-signature-256"),
        appSecret: process.env.WHATSAPP_APP_SECRET,
      });
      if (!valid) {
        return textResponse(request, 401, "Invalid signature");
      }

      const payload = rawBody ? JSON.parse(rawBody) : {};
      const eventId = payload.entry?.[0]?.id || payload.object || "";
      await notificationStore.recordWhatsAppWebhook(eventId, payload);
      return response(request, 200, { ok: true });
    } catch (error) {
      context.error("WhatsApp webhook failed", error.message);
      return response(request, 500, { message: "Server error." });
    }
  },
});
