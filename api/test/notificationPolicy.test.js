const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  buildIdempotencyKey,
  canUseWhatsApp,
  maskPhone,
  normalizePhone,
  renderTemplate,
  resolveTargetUsers,
  shouldSuppressForQuietHours,
} = require("../src/lib/notifications/notificationPolicy");

const users = [
  { userId: "u1", name: "One", role: "Super Admin", isActive: true, mustChangePassword: false, siteAccess: ["Sasti"] },
  { userId: "u2", name: "Two", role: "Viewer", isActive: true, mustChangePassword: false, siteAccess: ["Majri"] },
  { userId: "u3", name: "Three", role: "Viewer", isActive: false, mustChangePassword: false, siteAccess: ["Sasti"] },
  { userId: "u4", name: "Four", role: "Viewer", isActive: true, mustChangePassword: true, siteAccess: ["Sasti"] },
];

test("resolves target users by role, site, and selected user", () => {
  assert.deepEqual(resolveTargetUsers(users, { roles: ["Viewer"] }).map((user) => user.userId), ["u2"]);
  assert.deepEqual(resolveTargetUsers(users, { sites: [" sasti "] }).map((user) => user.userId), ["u1"]);
  assert.deepEqual(resolveTargetUsers(users, { userIds: ["u2"] }).map((user) => user.userId), ["u2"]);
});

test("generates stable idempotency keys", () => {
  const input = {
    sourceEventId: "event-1",
    targetUserId: "u1",
    templateId: "template-1",
    channel: "push",
    scheduleWindow: "2026-07-10T05:00",
  };
  assert.equal(buildIdempotencyKey(input), buildIdempotencyKey(input));
  assert.notEqual(buildIdempotencyKey(input), buildIdempotencyKey({ ...input, channel: "whatsapp" }));
});

test("quiet hours can suppress non-critical notifications", () => {
  const preferences = { quietHoursStart: "22:00", quietHoursEnd: "06:00" };
  assert.equal(shouldSuppressForQuietHours(preferences, { priority: "normal" }, 23 * 60), true);
  assert.equal(shouldSuppressForQuietHours(preferences, { priority: "normal" }, 7 * 60), false);
  assert.equal(shouldSuppressForQuietHours(preferences, { priority: "critical" }, 23 * 60), false);
});

test("normalizes and masks phone numbers", () => {
  assert.equal(normalizePhone("90000 00000"), "+919000000000");
  assert.equal(normalizePhone("+91-90000-00000"), "+919000000000");
  assert.equal(maskPhone("9000000000"), "+91******00");
});

test("requires WhatsApp preference plus opt-in consent", () => {
  assert.equal(canUseWhatsApp({ whatsappEnabled: true }, { status: "opted_in", phoneNumber: "9000000000" }), true);
  assert.equal(canUseWhatsApp({ whatsappEnabled: false }, { status: "opted_in", phoneNumber: "9000000000" }), false);
  assert.equal(canUseWhatsApp({ whatsappEnabled: true }, { status: "contact_registered", phoneNumber: "9000000000" }), false);
});

test("renders notification templates with variables", () => {
  assert.equal(renderTemplate("Hello {{ name }}, status is {{status}}.", { name: "User", status: "ready" }), "Hello User, status is ready.");
});
