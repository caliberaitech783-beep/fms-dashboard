const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  expectedSignature,
  verifyChallenge,
  verifyWhatsAppSignature,
} = require("../src/lib/notifications/whatsappSecurity");

test("verifies Meta webhook challenge", () => {
  assert.equal(verifyChallenge({
    mode: "subscribe",
    token: "verify-token",
    challenge: "challenge-text",
    verifyToken: "verify-token",
  }), "challenge-text");

  assert.equal(verifyChallenge({
    mode: "subscribe",
    token: "wrong-token",
    challenge: "challenge-text",
    verifyToken: "verify-token",
  }), null);
});

test("verifies WhatsApp webhook signature", () => {
  const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
  const appSecret = "test-app-secret";
  const signature = expectedSignature(rawBody, appSecret);

  assert.equal(verifyWhatsAppSignature({ rawBody, headerSignature: signature, appSecret }), true);
  assert.equal(verifyWhatsAppSignature({ rawBody, headerSignature: "sha256=bad", appSecret }), false);
  assert.equal(verifyWhatsAppSignature({ rawBody, headerSignature: signature, appSecret: "" }), false);
});

