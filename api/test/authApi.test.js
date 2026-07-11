const assert = require("node:assert/strict");
const test = require("node:test");

const { app } = require("@azure/functions");
const store = require("../src/lib/authStore");

function loadAuthRoutes(overrides) {
  const routes = new Map();
  const originalHttp = app.http;
  const originals = new Map();

  app.http = (name, definition) => routes.set(name, definition);
  for (const [name, implementation] of Object.entries(overrides)) {
    originals.set(name, store[name]);
    store[name] = implementation;
  }

  const modulePath = require.resolve("../src/functions/authApi");
  delete require.cache[modulePath];
  require(modulePath);
  app.http = originalHttp;

  return {
    routes,
    restore() {
      for (const [name, implementation] of originals) store[name] = implementation;
      delete require.cache[modulePath];
    },
  };
}

function request(method, body, params = {}) {
  return {
    method,
    params,
    headers: new Headers({
      authorization: "Bearer test-token",
      "x-fms-credential-protocol": "one-time-v1",
    }),
    json: async () => body,
  };
}

const context = { error() {} };

test("create user returns a random temporary password once and stores only its hash", async () => {
  const actor = { userId: "admin", name: "Admin", role: "Super Admin", isActive: true, mustChangePassword: false, tokenVersion: 0 };
  let savedUser;
  const harness = loadAuthRoutes({
    verifyToken: () => ({ sub: actor.userId, role: actor.role, ver: 0 }),
    getUser: async (userId) => userId === actor.userId ? actor : null,
    saveUser: async (user) => { savedUser = { ...user }; return user; },
    savePasswordHistory: async () => {},
    addAuditLog: async () => {},
  });

  try {
    const result = await harness.routes.get("users").handler(
      request("POST", { name: "Test User", userId: "test-1001", role: "Viewer" }),
      context,
    );

    assert.equal(result.status, 201);
    assert.equal(result.jsonBody.user.mustChangePassword, true);
    assert.equal(result.jsonBody.user.isPending, true);
    assert.equal(result.jsonBody.user.passwordHash, "");
    assert.notEqual(result.jsonBody.temporaryPassword, "test-1001");
    assert.equal(store.verifyPassword(result.jsonBody.temporaryPassword, savedUser.passwordHash), true);
    assert.equal("temporaryPassword" in savedUser, false);
    assert.ok(Date.parse(result.jsonBody.expiresAt) > Date.now());
  } finally {
    harness.restore();
  }
});

test("reset password revokes sessions and replaces the credential with a one-time password", async () => {
  const actor = { userId: "admin", name: "Admin", role: "Super Admin", isActive: true, mustChangePassword: false, tokenVersion: 0 };
  const target = {
    userId: "operator-7",
    mobile: "operator-7",
    name: "Operator",
    role: "Viewer",
    isActive: true,
    isPending: false,
    mustChangePassword: false,
    tokenVersion: 3,
    passwordHash: store.hashPassword("Old-password-1"),
  };
  let savedUser;
  const harness = loadAuthRoutes({
    verifyToken: () => ({ sub: actor.userId, role: actor.role, ver: 0 }),
    getUser: async (userId) => userId === actor.userId ? actor : (userId === target.userId ? target : null),
    saveUser: async (user) => { savedUser = { ...user }; return user; },
    savePasswordHistory: async () => {},
    addAuditLog: async () => {},
  });

  try {
    const result = await harness.routes.get("resetPassword").handler(
      request("POST", {}, { userId: encodeURIComponent(target.userId) }),
      context,
    );

    assert.equal(result.status, 200);
    assert.equal(savedUser.mustChangePassword, true);
    assert.equal(savedUser.isPending, true);
    assert.equal(savedUser.tokenVersion, 4);
    assert.equal(store.verifyPassword(result.jsonBody.temporaryPassword, savedUser.passwordHash), true);
    assert.equal(store.verifyPassword(target.userId, savedUser.passwordHash), false);
    assert.equal("temporaryPassword" in savedUser, false);
  } finally {
    harness.restore();
  }
});

test("legacy clients cannot mutate credentials during a staged rollout", async () => {
  const actor = { userId: "admin", name: "Admin", role: "Super Admin", isActive: true, mustChangePassword: false, tokenVersion: 0 };
  let saved = false;
  const harness = loadAuthRoutes({
    verifyToken: () => ({ sub: actor.userId, role: actor.role, ver: 0 }),
    getUser: async (userId) => userId === actor.userId ? actor : null,
    saveUser: async () => { saved = true; },
    addAuditLog: async () => {},
  });

  try {
    const legacyRequest = request("POST", { name: "Legacy User", userId: "legacy-1001", role: "Viewer" });
    legacyRequest.headers.delete("x-fms-credential-protocol");
    const result = await harness.routes.get("users").handler(legacyRequest, context);
    assert.equal(result.status, 409);
    assert.equal(saved, false);
  } finally {
    harness.restore();
  }
});

test("a Super Admin cannot reset their own password through the admin flow", async () => {
  const actor = { userId: "admin", name: "Admin", role: "Super Admin", isActive: true, mustChangePassword: false, tokenVersion: 0 };
  let saved = false;
  const harness = loadAuthRoutes({
    verifyToken: () => ({ sub: actor.userId, role: actor.role, ver: 0 }),
    getUser: async () => actor,
    saveUser: async () => { saved = true; },
    addAuditLog: async () => {},
  });

  try {
    const result = await harness.routes.get("resetPassword").handler(
      request("POST", {}, { userId: encodeURIComponent(actor.userId) }),
      context,
    );
    assert.equal(result.status, 409);
    assert.equal(saved, false);
  } finally {
    harness.restore();
  }
});

test("login rejects clients that predate the security protocol", async () => {
  const harness = loadAuthRoutes({});
  try {
    const result = await harness.routes.get("login").handler(request("POST", { userId: "any", password: "any" }), context);
    assert.equal(result.status, 426);
  } finally {
    harness.restore();
  }
});
