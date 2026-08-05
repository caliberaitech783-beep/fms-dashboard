const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
} = require("../src/lib/authSecurity");
const store = require("../src/lib/authStore");

test("login policy locks at the threshold and increases backoff after repeated failures", () => {
  const startedAt = Date.parse("2026-07-12T00:00:00.000Z");
  const user = { failedLoginAttempts: 0, lockedUntil: null };

  for (let attempt = 1; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
    registerFailedLogin(user, startedAt);
    assert.equal(user.failedLoginAttempts, attempt);
    assert.equal(user.lockedUntil, null);
  }

  registerFailedLogin(user, startedAt);
  assert.equal(user.failedLoginAttempts, MAX_FAILED_LOGIN_ATTEMPTS);
  assert.equal(Date.parse(user.lockedUntil), startedAt + BASE_LOGIN_LOCKOUT_MS);
  assert.equal(isLoginLocked(user, startedAt + BASE_LOGIN_LOCKOUT_MS - 1), true);
  assert.equal(isLoginLocked(user, startedAt + BASE_LOGIN_LOCKOUT_MS), false);

  registerFailedLogin(user, startedAt + BASE_LOGIN_LOCKOUT_MS);
  assert.equal(Date.parse(user.lockedUntil), startedAt + BASE_LOGIN_LOCKOUT_MS + (BASE_LOGIN_LOCKOUT_MS * 2));

  for (let attempt = 0; attempt < 20; attempt += 1) registerFailedLogin(user, startedAt);
  assert.ok(Date.parse(user.lockedUntil) <= startedAt + MAX_LOGIN_LOCKOUT_MS);
});

test("successful login clears failure and lockout state", () => {
  const user = { failedLoginAttempts: 9, lockedUntil: "2099-01-01T00:00:00.000Z" };
  clearFailedLogins(user);
  assert.deepEqual(user, { failedLoginAttempts: 0, lockedUntil: null });
});

test("temporary passwords are random, policy-compliant, and expire after 24 hours", () => {
  const first = generateTemporaryPassword();
  const second = generateTemporaryPassword();
  assert.notEqual(first, second);
  assert.match(first, /[A-Za-z]/);
  assert.match(first, /\d/);
  assert.ok(first.length >= 20);

  const issuedAt = Date.parse("2026-07-12T00:00:00.000Z");
  assert.equal(Date.parse(temporaryPasswordExpiresAt(issuedAt)), issuedAt + TEMPORARY_PASSWORD_TTL_MS);
});

test("token version checks preserve legacy version-zero sessions and revoke changed accounts", () => {
  const activeUser = { isActive: true, mustChangePassword: false, role: "Viewer", tokenVersion: 0 };
  assert.equal(assertTokenForUser({ role: "Viewer" }, activeUser), activeUser);

  bumpTokenVersion(activeUser);
  assert.equal(activeUser.tokenVersion, 1);
  assert.throws(
    () => assertTokenForUser({ role: "Viewer", ver: 0 }, activeUser),
    (error) => error.statusCode === 401,
  );
  assert.equal(assertTokenForUser({ role: "Viewer", ver: 1 }, activeUser), activeUser);
});

test("users with temporary passwords can authenticate only for password-change flows", () => {
  const user = { isActive: true, mustChangePassword: true, role: "MIS User", tokenVersion: 0 };
  const payload = { role: "MIS User", ver: 0 };

  assert.throws(
    () => assertTokenForUser(payload, user),
    (error) => error.statusCode === 403 && error.message === "Password change required.",
  );
  assert.equal(assertTokenForUser(payload, user, { allowPasswordChange: true }), user);
});

test("signed tokens carry version claims and reject stale versions", () => {
  const previousSecret = process.env.AUTH_TOKEN_SECRET;
  process.env.AUTH_TOKEN_SECRET = "test-only-auth-secret-at-least-24-characters";
  try {
    const user = { userId: "security-test", role: "Fuel Manager", tokenVersion: 4 };
    const token = store.signToken(user);
    const payload = store.verifyToken(token);
    assert.equal(payload.sub, user.userId);
    assert.equal(payload.role, user.role);
    assert.equal(payload.ver, 4);
    assert.ok(payload.iat > 0);
    assert.ok(payload.jti);
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_TOKEN_SECRET;
    else process.env.AUTH_TOKEN_SECRET = previousSecret;
  }
});
