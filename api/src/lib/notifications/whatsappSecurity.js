const crypto = require("node:crypto");

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function expectedSignature(rawBody, appSecret) {
  return `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

function verifyWhatsAppSignature({ rawBody, headerSignature, appSecret }) {
  if (!appSecret) {
    return false;
  }
  return timingSafeEqualText(headerSignature, expectedSignature(rawBody, appSecret));
}

function verifyChallenge({ mode, token, challenge, verifyToken }) {
  if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
    return String(challenge || "");
  }
  return null;
}

module.exports = {
  expectedSignature,
  verifyChallenge,
  verifyWhatsAppSignature,
};

