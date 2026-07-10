const SECRET_KEY_PATTERN = /(authorization|password|secret|token|api[_-]?key|credential)/i;

function maskSecret(value) {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  return "[masked]";
}

function maskObject(value) {
  if (Array.isArray(value)) {
    return value.map(maskObject);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? maskSecret(entry) : maskObject(entry),
      ]),
    );
  }

  return value;
}

function sanitizeText(text, secrets = []) {
  let sanitized = String(text || "");
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }

    sanitized = sanitized.split(String(secret)).join("[masked]");
  }

  return sanitized;
}

function safeErrorMessage(error, secrets = []) {
  return sanitizeText(error instanceof Error ? error.message : String(error), secrets);
}

module.exports = {
  maskObject,
  maskSecret,
  safeErrorMessage,
  sanitizeText,
};
