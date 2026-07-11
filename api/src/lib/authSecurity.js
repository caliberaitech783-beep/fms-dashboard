const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const BASE_LOGIN_LOCKOUT_MS = 60_000;
const MAX_LOGIN_LOCKOUT_MS = 15 * 60_000;
const TEMPORARY_PASSWORD_TTL_MS = 24 * 60 * 60_000;

function generateTemporaryPassword() {
  return `Tmp-${require("node:crypto").randomBytes(18).toString("base64url")}-9`;
}

function temporaryPasswordExpiresAt(at = Date.now()) {
  return new Date(at + TEMPORARY_PASSWORD_TTL_MS).toISOString();
}

function isLoginLocked(user, at = Date.now()) {
  if (!user?.lockedUntil) return false;
  const lockedUntil = Date.parse(user.lockedUntil);
  return Number.isFinite(lockedUntil) && lockedUntil > at;
}

function registerFailedLogin(user, at = Date.now()) {
  user.failedLoginAttempts = Math.max(0, Number(user.failedLoginAttempts || 0)) + 1;

  if (user.failedLoginAttempts < MAX_FAILED_LOGIN_ATTEMPTS) {
    user.lockedUntil = null;
    return user;
  }

  const lockoutStep = user.failedLoginAttempts - MAX_FAILED_LOGIN_ATTEMPTS;
  const lockoutMs = Math.min(BASE_LOGIN_LOCKOUT_MS * (2 ** lockoutStep), MAX_LOGIN_LOCKOUT_MS);
  user.lockedUntil = new Date(at + lockoutMs).toISOString();
  return user;
}

function clearFailedLogins(user) {
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  return user;
}

function bumpTokenVersion(user) {
  user.tokenVersion = Math.max(0, Number(user.tokenVersion || 0)) + 1;
  return user.tokenVersion;
}

function assertTokenForUser(payload, user, { allowPasswordChange = false } = {}) {
  if (!user || !user.isActive) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
  }

  // Tokens issued before versioning are treated as version zero, preserving
  // existing sessions until a security-sensitive account change occurs.
  const tokenVersion = Number(payload?.ver ?? 0);
  const currentVersion = Math.max(0, Number(user.tokenVersion || 0));
  if (!Number.isFinite(tokenVersion) || tokenVersion !== currentVersion || payload?.role !== user.role) {
    throw Object.assign(new Error("Session is no longer valid. Please log in again."), { statusCode: 401 });
  }

  if (user.mustChangePassword && !allowPasswordChange) {
    throw Object.assign(new Error("Password change required."), { statusCode: 403 });
  }

  return user;
}

module.exports = {
  BASE_LOGIN_LOCKOUT_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  MAX_LOGIN_LOCKOUT_MS,
  TEMPORARY_PASSWORD_TTL_MS,
  assertTokenForUser,
  bumpTokenVersion,
  clearFailedLogins,
  generateTemporaryPassword,
  isLoginLocked,
  registerFailedLogin,
  temporaryPasswordExpiresAt,
};
