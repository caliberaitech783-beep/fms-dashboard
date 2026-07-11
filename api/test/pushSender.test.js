const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createPushPayload,
  hasVapidConfig,
  sanitizeMetadata,
  sendWebPush,
} = require("../src/lib/notifications/pushSender");

test("detects complete VAPID configuration only", () => {
  assert.equal(hasVapidConfig({}), false);
  assert.equal(hasVapidConfig({
    VAPID_PUBLIC_KEY: "public",
    VAPID_PRIVATE_KEY: "private",
    VAPID_SUBJECT: "mailto:admin@example.com",
  }), true);
});

test("push payload contains only short safe notification fields", () => {
  const payload = JSON.parse(createPushPayload({
    id: "n1",
    title: "Assignment updated",
    body: "A record was assigned to you.",
    severity: "info",
    deepLinkUrl: "/?section=notifications",
    entityType: "tracking_record",
    entityId: "row-1",
    expiresAt: "2026-07-10T12:00:00+05:30",
    metadata: {
      source: "test",
      authToken: "must-not-appear",
      password: "must-not-appear",
      phoneNumber: "must-not-appear",
      nested: { hidden: true },
    },
  }));

  assert.equal(payload.notificationId, "n1");
  assert.equal(payload.metadata.source, "test");
  assert.equal("authToken" in payload.metadata, false);
  assert.equal("password" in payload.metadata, false);
  assert.equal("phoneNumber" in payload.metadata, false);
  assert.equal("nested" in payload.metadata, false);
});

test("metadata sanitizer drops credential-like keys", () => {
  assert.deepEqual(sanitizeMetadata({
    ok: true,
    apiKey: "secret",
    mobile: "9000000000",
    count: 2,
  }), { ok: true, count: 2 });
});

test("web push send is blocked without backend VAPID secrets", async () => {
  const result = await sendWebPush({}, { id: "n1", title: "Test", body: "Body" }, { env: {} });
  assert.equal(result.status, "blocked");
  assert.equal(result.permanentFailure, false);
});
