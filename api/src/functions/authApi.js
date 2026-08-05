const { app } = require("@azure/functions");
const store = require("../lib/authStore");
const {
  clearFailedLogins,
  generateTemporaryPassword,
  isLoginLocked,
  temporaryPasswordExpiresAt,
} = require("../lib/authSecurity");

const CREDENTIAL_PROTOCOL_HEADER = "x-fms-credential-protocol";
const CREDENTIAL_PROTOCOL_VERSION = "one-time-v1";
const CLIENT_SECURITY_HEADER = "x-fms-client-security";
const CLIENT_SECURITY_VERSION = "auth-v2";

function allowedOrigin(request) {
  const configured = (process.env.ALLOWED_ORIGINS || "https://fms.cmll.in")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin");

  if (configured.includes("*")) {
    return "*";
  }

  if (origin && configured.includes(origin)) {
    return origin;
  }

  return configured[0] || "https://fms.cmll.in";
}

function response(request, status, body) {
  return {
    status,
    jsonBody: body,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(request),
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": `Content-Type,Authorization,${CREDENTIAL_PROTOCOL_HEADER},${CLIENT_SECURITY_HEADER}`,
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  };
}

function emptyResponse(request, status = 204) {
  return {
    status,
    body: "",
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(request),
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": `Content-Type,Authorization,${CREDENTIAL_PROTOCOL_HEADER},${CLIENT_SECURITY_HEADER}`,
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

async function handle(request, context, handler) {
  if (request.method === "OPTIONS") {
    return emptyResponse(request);
  }

  try {
    if (process.env.AUTO_SEED_USERS === "true") {
      await store.ensureSeedUsers();
    }
    return await handler(request, context);
  } catch (error) {
    context.error(error);
    const status = error.statusCode || error.status || 500;
    const message = status >= 500 ? "Server error." : error.message;
    return response(request, status, { message });
  }
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireActor(request, options) {
  const token = bearerToken(request);
  if (!token) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
  }

  const payload = store.verifyToken(token);
  const actor = await store.getUser(payload.sub);
  return store.assertTokenForUser(payload, actor, options);
}

function requireSuperAdmin(actor) {
  if (actor.role !== "Super Admin") {
    throw Object.assign(new Error("Only Super Admin users can perform this action."), { statusCode: 403 });
  }
}

function requireCredentialProtocol(request) {
  if (request.headers.get(CREDENTIAL_PROTOCOL_HEADER) !== CREDENTIAL_PROTOCOL_VERSION) {
    throw Object.assign(new Error("Update the portal before creating or resetting users."), { statusCode: 409 });
  }
}

function requireSecurityClient(request) {
  if (request.headers.get(CLIENT_SECURITY_HEADER) !== CLIENT_SECURITY_VERSION) {
    throw Object.assign(new Error("A security update is required. Refresh the portal and try again."), { statusCode: 426 });
  }
}

async function requireAdminContinuity(target, removesAdminAccess) {
  if (!removesAdminAccess || target.role !== "Super Admin" || !target.isActive) return;
  const users = await store.listUsers();
  const activeAdmins = users.filter((user) => user.role === "Super Admin" && user.isActive);
  if (activeAdmins.length <= 1) {
    throw Object.assign(new Error("At least one active Super Admin must remain."), { statusCode: 409 });
  }
}

function getRouteUserId(request) {
  return decodeURIComponent(request.params.userId || request.params.userid || "");
}

app.http("health", {
  route: "health",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => response(request, 200, { ok: true })),
});

app.http("login", {
  route: "auth/login",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    requireSecurityClient(request);
    const body = await readJson(request);
    const userId = String(body.userId || "").trim();
    const password = String(body.password || "");
    const user = await store.getUser(userId);
    const generic = Object.assign(new Error("Invalid mobile/user ID or password."), { statusCode: 401 });

    if (!user || !user.isActive) {
      await store.addAuditLog({ actor: user, action: "LOGIN_FAILED", targetType: "User", targetId: userId, metadata: { reason: user ? "inactive" : "invalid_credentials" } });
      throw generic;
    }

    if (isLoginLocked(user)) {
      await store.addAuditLog({ actor: user, action: "LOGIN_FAILED", targetType: "User", targetId: user.userId, metadata: { reason: "account_locked" } });
      throw generic;
    }

    if (!store.verifyPassword(password, user.passwordHash)) {
      await store.registerFailedLoginAtomic(user.userId);
      await store.addAuditLog({ actor: user, action: "LOGIN_FAILED", targetType: "User", targetId: user.userId, metadata: { reason: "invalid_credentials" } });
      throw generic;
    }

    if (user.mustChangePassword && user.temporaryPasswordExpiresAt
      && Date.parse(user.temporaryPasswordExpiresAt) <= Date.now()) {
      await store.addAuditLog({ actor: user, action: "LOGIN_FAILED", targetType: "User", targetId: user.userId, metadata: { reason: "temporary_password_expired" } });
      throw generic;
    }

    clearFailedLogins(user);
    user.lastLoginAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    user.appVersionAtLogin = body.appVersion || null;
    await store.saveUser(user);
    await store.addAuditLog({ actor: user, action: "LOGIN_SUCCESS", targetType: "User", targetId: user.userId, metadata: { appVersion: body.appVersion || null } });

    return response(request, 200, {
      user: store.safeUser(user),
      token: store.signToken(user),
    });
  }),
});

app.http("me", {
  route: "auth/me",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request, { allowPasswordChange: true });
    return response(request, 200, store.safeUser(actor));
  }),
});

app.http("changePassword", {
  route: "auth/change-password",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request, { allowPasswordChange: true });
    const body = await readJson(request);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const confirmPassword = String(body.confirmPassword || "");

    if (!store.verifyPassword(currentPassword, actor.passwordHash)) {
      throw Object.assign(new Error("Current password is incorrect."), { statusCode: 400 });
    }

    const history = await store.getPasswordHistory(actor.userId);
    const errors = store.validateNewPassword(actor, currentPassword, newPassword, confirmPassword, history);
    if (errors.length) {
      throw Object.assign(new Error(errors.join(" ")), { statusCode: 400 });
    }

    const passwordHash = store.hashPassword(newPassword.trim());
    actor.passwordHash = passwordHash;
    actor.mustChangePassword = false;
    actor.isPending = false;
    actor.temporaryPasswordExpiresAt = null;
    actor.passwordChangedAt = new Date().toISOString();
    actor.updatedAt = new Date().toISOString();
    actor.updatedBy = actor.userId;
    store.bumpTokenVersion(actor);
    await store.saveUser(actor);
    await store.savePasswordHistory(actor.userId, passwordHash);
    await store.addAuditLog({ actor, action: "PASSWORD_CHANGED", targetType: "User", targetId: actor.userId });
    const publicUser = store.safeUser(actor);
    return response(request, 200, {
      ...publicUser,
      user: publicUser,
      token: store.signToken(actor),
    });
  }),
});

app.http("logout", {
  route: "auth/logout",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    actor.lastLogoutAt = new Date().toISOString();
    actor.updatedAt = new Date().toISOString();
    store.bumpTokenVersion(actor);
    await store.saveUser(actor);
    await store.addAuditLog({ actor, action: "LOGOUT", targetType: "User", targetId: actor.userId });
    return response(request, 200, { ok: true });
  }),
});

app.http("users", {
  route: "users",
  authLevel: "anonymous",
  methods: ["GET", "POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);

    if (request.method === "GET") {
      return response(request, 200, await store.listUsers());
    }

    requireCredentialProtocol(request);

    const body = await readJson(request);
    const name = String(body.name || "").trim();
    const userId = String(body.userId || "").trim();
    const role = store.normalizeRole(body.role || "MIS User");
    const department = String(body.department || "").trim() || null;

    if (!name) {
      throw Object.assign(new Error("User name is required."), { statusCode: 400 });
    }
    if (userId.length < 4) {
      throw Object.assign(new Error("Mobile number / user ID must be at least 4 characters."), { statusCode: 400 });
    }
    if (await store.getUser(userId)) {
      throw Object.assign(new Error("A user with this mobile number / user ID already exists."), { statusCode: 409 });
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = store.hashPassword(temporaryPassword);
    const expiresAt = temporaryPasswordExpiresAt();
    const createdAt = new Date().toISOString();
    const user = {
      id: `user-${userId}`,
      name,
      mobile: userId,
      userId,
      passwordHash,
      role,
      sourceTransactionPower: null,
      sourceSoftwarePower: null,
      siteAccess: [],
      department,
      isActive: body.isActive !== false,
      isPending: true,
      mustChangePassword: true,
      passwordChangedAt: null,
      lastLoginAt: null,
      lastLogoutAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt,
      updatedAt: createdAt,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      lastPasswordResetAt: null,
      lastPasswordResetBy: null,
      appVersionAtLogin: null,
      tokenVersion: 0,
      temporaryPasswordExpiresAt: expiresAt,
    };

    await store.saveUser(user);
    await store.savePasswordHistory(user.userId, passwordHash, createdAt);
    await store.addAuditLog({ actor, action: "USER_CREATED", targetType: "User", targetId: user.userId, metadata: { source: "admin_ui", role } });
    return response(request, 201, {
      user: store.safeUser(user),
      temporaryPassword,
      expiresAt,
    });
  }),
});

app.http("resetPassword", {
  route: "users/{userId}/reset-password",
  authLevel: "anonymous",
  methods: ["POST", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    requireCredentialProtocol(request);
    const target = await store.getUser(getRouteUserId(request));
    if (!target) {
      throw Object.assign(new Error("User not found."), { statusCode: 404 });
    }
    if (target.userId === actor.userId) {
      throw Object.assign(new Error("Use Change Password for your own account."), { statusCode: 409 });
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = store.hashPassword(temporaryPassword);
    const expiresAt = temporaryPasswordExpiresAt();
    target.passwordHash = passwordHash;
    target.mustChangePassword = true;
    target.isPending = true;
    target.temporaryPasswordExpiresAt = expiresAt;
    target.failedLoginAttempts = 0;
    target.lockedUntil = null;
    target.lastPasswordResetAt = new Date().toISOString();
    target.lastPasswordResetBy = actor.userId;
    target.updatedAt = new Date().toISOString();
    target.updatedBy = actor.userId;
    store.bumpTokenVersion(target);
    await store.saveUser(target);
    await store.savePasswordHistory(target.userId, passwordHash);
    await store.addAuditLog({ actor, action: "PASSWORD_RESET_BY_ADMIN", targetType: "User", targetId: target.userId });
    return response(request, 200, {
      user: store.safeUser(target),
      temporaryPassword,
      expiresAt,
    });
  }),
});

app.http("setUserActive", {
  route: "users/{userId}/active",
  authLevel: "anonymous",
  methods: ["PATCH", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    const target = await store.getUser(getRouteUserId(request));
    if (!target) {
      throw Object.assign(new Error("User not found."), { statusCode: 404 });
    }
    const body = await readJson(request);
    if (target.userId === actor.userId && body.isActive !== true) {
      throw Object.assign(new Error("You cannot deactivate your own account."), { statusCode: 409 });
    }
    await requireAdminContinuity(target, body.isActive !== true);
    target.isActive = body.isActive === true;
    target.updatedAt = new Date().toISOString();
    target.updatedBy = actor.userId;
    store.bumpTokenVersion(target);
    await store.saveUser(target);
    await store.addAuditLog({
      actor,
      action: target.isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      targetType: "User",
      targetId: target.userId,
    });
    return response(request, 200, store.safeUser(target));
  }),
});

app.http("setUserRole", {
  route: "users/{userId}/role",
  authLevel: "anonymous",
  methods: ["PATCH", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    const target = await store.getUser(getRouteUserId(request));
    if (!target) {
      throw Object.assign(new Error("User not found."), { statusCode: 404 });
    }
    const body = await readJson(request);
    const role = store.normalizeRole(body.role);
    if (target.userId === actor.userId && role !== "Super Admin") {
      throw Object.assign(new Error("You cannot remove your own Super Admin access."), { statusCode: 409 });
    }
    await requireAdminContinuity(target, role !== "Super Admin");
    target.role = role;
    target.updatedAt = new Date().toISOString();
    target.updatedBy = actor.userId;
    store.bumpTokenVersion(target);
    await store.saveUser(target);
    await store.addAuditLog({ actor, action: "ROLE_CHANGED", targetType: "User", targetId: target.userId, metadata: { role } });
    return response(request, 200, store.safeUser(target));
  }),
});

app.http("auditLogs", {
  route: "audit-logs",
  authLevel: "anonymous",
  methods: ["GET", "OPTIONS"],
  handler: (request, context) => handle(request, context, async () => {
    const actor = await requireActor(request);
    requireSuperAdmin(actor);
    return response(request, 200, await store.listAuditLogs());
  }),
});
