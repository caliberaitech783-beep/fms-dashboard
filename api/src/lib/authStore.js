const crypto = require("node:crypto");
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const {
  assertTokenForUser,
  bumpTokenVersion,
  generateTemporaryPassword,
  registerFailedLogin,
  temporaryPasswordExpiresAt,
} = require("./authSecurity");

const USER_PARTITION = "USER";
const AUDIT_PARTITION = "AUDIT";
const DEFAULT_ITERATIONS = 210000;
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

const ROLE_PERMISSIONS = {
  "Super Admin": true,
  Management: true,
  "Site Manager": true,
  "Fleet Manager": true,
  "Fuel Manager": true,
  "MIS User": true,
  Viewer: true,
};

let setupPromise = null;
let seedUsersPromise = null;
let usersTable = null;
let auditTable = null;
let historyTable = null;
let securityBackupTable = null;

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function tableName(envName, fallback) {
  return process.env[envName] || fallback;
}

function getConnectionString() {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw Object.assign(new Error("AzureWebJobsStorage is not configured."), { statusCode: 500 });
  }
  return connectionString;
}

function getTableClient(name) {
  const connectionString = getConnectionString();

  if (connectionString === "UseDevelopmentStorage=true") {
    return TableClient.fromConnectionString(connectionString, name);
  }

  if (connectionString.startsWith("DefaultEndpointsProtocol=")) {
    return TableClient.fromConnectionString(connectionString, name);
  }

  const accountName = process.env.STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.STORAGE_ACCOUNT_KEY;
  if (!accountName || !accountKey) {
    throw Object.assign(new Error("Storage account credentials are not configured."), { statusCode: 500 });
  }

  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    name,
    new AzureNamedKeyCredential(accountName, accountKey),
  );
}

function rowKeyFor(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function userIdFromRowKey(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(password, salt, DEFAULT_ITERATIONS, 32, "sha256").toString("base64url");
  return `pbkdf2$${DEFAULT_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, iterationsText, salt, expected] = String(storedHash || "").split("$");
  if (scheme !== "pbkdf2" || !iterationsText || !salt || !expected) {
    return false;
  }

  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeRole(role) {
  if (!ROLE_PERMISSIONS[role]) {
    throw Object.assign(new Error("Invalid role."), { statusCode: 400 });
  }
  return role;
}

function userToEntity(user) {
  return {
    partitionKey: USER_PARTITION,
    rowKey: rowKeyFor(user.userId),
    id: user.id,
    name: user.name,
    mobile: user.mobile,
    userId: user.userId,
    passwordHash: user.passwordHash,
    role: user.role,
    sourceTransactionPower: user.sourceTransactionPower || "",
    sourceSoftwarePower: user.sourceSoftwarePower || "",
    siteAccessJson: JSON.stringify(user.siteAccess || []),
    department: user.department || "",
    isActive: Boolean(user.isActive),
    isPending: Boolean(user.isPending),
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordChangedAt: user.passwordChangedAt || "",
    lastLoginAt: user.lastLoginAt || "",
    lastLogoutAt: user.lastLogoutAt || "",
    failedLoginAttempts: Number(user.failedLoginAttempts || 0),
    lockedUntil: user.lockedUntil || "",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    createdBy: user.createdBy || "",
    updatedBy: user.updatedBy || "",
    lastPasswordResetAt: user.lastPasswordResetAt || "",
    lastPasswordResetBy: user.lastPasswordResetBy || "",
    appVersionAtLogin: user.appVersionAtLogin || "",
    tokenVersion: Math.max(0, Number(user.tokenVersion || 0)),
    temporaryPasswordExpiresAt: user.temporaryPasswordExpiresAt || "",
  };
}

function entityToUser(entity) {
  if (!entity) {
    return null;
  }

  return {
    id: entity.id || `user-${userIdFromRowKey(entity.rowKey)}`,
    name: entity.name,
    mobile: entity.mobile,
    userId: entity.userId || userIdFromRowKey(entity.rowKey),
    passwordHash: entity.passwordHash || "",
    role: entity.role,
    sourceTransactionPower: entity.sourceTransactionPower || null,
    sourceSoftwarePower: entity.sourceSoftwarePower || null,
    siteAccess: entity.siteAccessJson ? JSON.parse(entity.siteAccessJson) : [],
    department: entity.department || null,
    isActive: entity.isActive !== false,
    isPending: entity.isPending === true,
    mustChangePassword: entity.mustChangePassword !== false,
    passwordChangedAt: entity.passwordChangedAt || null,
    lastLoginAt: entity.lastLoginAt || null,
    lastLogoutAt: entity.lastLogoutAt || null,
    failedLoginAttempts: Number(entity.failedLoginAttempts || 0),
    lockedUntil: entity.lockedUntil || null,
    createdAt: entity.createdAt || now(),
    updatedAt: entity.updatedAt || now(),
    createdBy: entity.createdBy || null,
    updatedBy: entity.updatedBy || null,
    lastPasswordResetAt: entity.lastPasswordResetAt || null,
    lastPasswordResetBy: entity.lastPasswordResetBy || null,
    appVersionAtLogin: entity.appVersionAtLogin || null,
    tokenVersion: Math.max(0, Number(entity.tokenVersion || 0)),
    temporaryPasswordExpiresAt: entity.temporaryPasswordExpiresAt || null,
    _etag: entity.etag || null,
  };
}

function safeUser(user) {
  const { _etag, ...publicUser } = user;
  return {
    ...publicUser,
    passwordHash: "",
  };
}

async function setupTables() {
  if (!setupPromise) {
    setupPromise = (async () => {
      usersTable = getTableClient(tableName("USERS_TABLE_NAME", "FmsUsers"));
      auditTable = getTableClient(tableName("AUDIT_TABLE_NAME", "FmsAuditLogs"));
      historyTable = getTableClient(tableName("PASSWORD_HISTORY_TABLE_NAME", "FmsPasswordHistory"));
      securityBackupTable = getTableClient(tableName("SECURITY_MIGRATION_BACKUP_TABLE_NAME", "FmsSecurityMigrationBackup"));
      await Promise.all([
        usersTable.createTable().catch((error) => {
          if (error.statusCode !== 409) throw error;
        }),
        auditTable.createTable().catch((error) => {
          if (error.statusCode !== 409) throw error;
        }),
        historyTable.createTable().catch((error) => {
          if (error.statusCode !== 409) throw error;
        }),
        securityBackupTable.createTable().catch((error) => {
          if (error.statusCode !== 409) throw error;
        }),
      ]);
    })();
  }

  await setupPromise;
}

async function savePasswordHistory(userId, passwordHash, createdAt = now()) {
  await setupTables();
  await historyTable.createEntity({
    partitionKey: rowKeyFor(userId),
    rowKey: `${createdAt}-${crypto.randomUUID()}`,
    userId,
    passwordHash,
    createdAt,
  });
}

async function getPasswordHistory(userId) {
  await setupTables();
  const rows = [];
  const partitionKey = rowKeyFor(userId);
  for await (const entity of historyTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${partitionKey}'` } })) {
    rows.push({
      id: entity.rowKey,
      userId: entity.userId,
      passwordHash: entity.passwordHash,
      createdAt: entity.createdAt,
    });
  }
  return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function saveUser(user) {
  await setupTables();
  await usersTable.upsertEntity(userToEntity(user), "Replace");
  return user;
}

async function registerFailedLoginAtomic(userId) {
  await setupTables();

  for (let retry = 0; retry < 12; retry += 1) {
    const user = await getUser(userId);
    if (!user) return null;
    if (!user._etag) {
      throw Object.assign(new Error("Login protection state is unavailable."), { statusCode: 503 });
    }

    registerFailedLogin(user);
    user.updatedAt = now();

    try {
      await usersTable.updateEntity(userToEntity(user), "Replace", { etag: user._etag });
      return user;
    } catch (error) {
      if (error.statusCode !== 412) throw error;
    }
  }

  throw Object.assign(new Error("Login protection is busy. Please try again."), { statusCode: 503 });
}

async function getUser(userId) {
  await setupTables();
  try {
    return entityToUser(await usersTable.getEntity(USER_PARTITION, rowKeyFor(userId)));
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function listUsers() {
  await setupTables();
  const users = [];
  for await (const entity of usersTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${USER_PARTITION}'` } })) {
    users.push(safeUser(entityToUser(entity)));
  }
  return users.sort((left, right) => left.name.localeCompare(right.name));
}

async function addAuditLog({ actor, action, targetType, targetId, metadata = {} }) {
  await setupTables();
  const createdAt = now();
  const rowKey = `${String(Date.now()).padStart(13, "0")}-${crypto.randomUUID()}`;
  const log = {
    id: makeId("audit"),
    actorUserId: actor?.userId || null,
    actorName: actor?.name || null,
    action,
    targetType,
    targetId,
    metadata,
    ipAddress: null,
    userAgent: null,
    createdAt,
  };

  await auditTable.createEntity({
    partitionKey: AUDIT_PARTITION,
    rowKey,
    id: log.id,
    actorUserId: log.actorUserId || "",
    actorName: log.actorName || "",
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId || "",
    ipAddress: "",
    userAgent: "",
    createdAt: log.createdAt,
    metadataJson: JSON.stringify(metadata),
  });

  return log;
}

async function listAuditLogs() {
  await setupTables();
  const logs = [];
  for await (const entity of auditTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${AUDIT_PARTITION}'` } })) {
    logs.push({
      id: entity.id,
      actorUserId: entity.actorUserId || null,
      actorName: entity.actorName || null,
      action: entity.action,
      targetType: entity.targetType,
      targetId: entity.targetId || null,
      metadata: entity.metadataJson ? JSON.parse(entity.metadataJson) : {},
      ipAddress: entity.ipAddress || null,
      userAgent: entity.userAgent || null,
      createdAt: entity.createdAt,
    });
  }

  return logs.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100);
}

async function backupSecurityMigrationState(records) {
  await setupTables();
  const snapshot = "legacy-default-v1";
  const backedUpAt = now();

  for (const user of records) {
    const original = userToEntity(user);
    const { partitionKey, rowKey, ...properties } = original;
    await securityBackupTable.createEntity({
      partitionKey: `USERS-${snapshot}`,
      rowKey,
      originalPartitionKey: partitionKey,
      originalRowKey: rowKey,
      backedUpAt,
      ...properties,
    }).catch((error) => {
      if (error.statusCode !== 409) throw error;
    });
  }

  for await (const entity of historyTable.listEntities()) {
    const { partitionKey, rowKey, etag, timestamp, ...properties } = entity;
    await securityBackupTable.createEntity({
      partitionKey: `HISTORY-${snapshot}`,
      rowKey: rowKeyFor(`${partitionKey}:${rowKey}`),
      originalPartitionKey: partitionKey,
      originalRowKey: rowKey,
      backedUpAt,
      ...properties,
    }).catch((error) => {
      if (error.statusCode !== 409) throw error;
    });
  }
}

async function runSeedUserMigration() {
  await setupTables();

  const recoveryUserId = String(process.env.SECURITY_RECOVERY_ADMIN_USER_ID || "").trim();
  const recoveryTemporaryPassword = String(process.env.SECURITY_RECOVERY_TEMP_PASSWORD || "");
  const recoveryConfigured = recoveryUserId.length > 0 && recoveryTemporaryPassword.length >= 16;
  const records = [];
  for await (const entity of usersTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${USER_PARTITION}'` } })) {
    records.push(entityToUser(entity));
  }

  if (records.length === 0 && recoveryConfigured) {
    const createdAt = now();
    const passwordHash = hashPassword(recoveryTemporaryPassword);
    const recoveryAdmin = {
      id: `user-${recoveryUserId}`,
      name: String(process.env.SECURITY_RECOVERY_ADMIN_NAME || "Recovery Administrator").trim(),
      mobile: recoveryUserId,
      userId: recoveryUserId,
      passwordHash,
      role: "Super Admin",
      sourceTransactionPower: null,
      sourceSoftwarePower: null,
      siteAccess: [],
      department: "Administration",
      isActive: true,
      isPending: true,
      mustChangePassword: true,
      passwordChangedAt: null,
      lastLoginAt: null,
      lastLogoutAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt,
      updatedAt: createdAt,
      createdBy: "secure_bootstrap",
      updatedBy: "secure_bootstrap",
      lastPasswordResetAt: createdAt,
      lastPasswordResetBy: "secure_bootstrap",
      appVersionAtLogin: null,
      tokenVersion: 0,
      temporaryPasswordExpiresAt: temporaryPasswordExpiresAt(),
    };
    await saveUser(recoveryAdmin);
    await savePasswordHistory(recoveryAdmin.userId, passwordHash, createdAt);
    await addAuditLog({ actor: null, action: "RECOVERY_ADMIN_CREATED", targetType: "User", targetId: recoveryAdmin.userId, metadata: { source: "secure_environment_bootstrap" } });
    return;
  }

  const configuredRecoveryAdmin = records.find((existing) => (
    recoveryConfigured
    && existing.userId === recoveryUserId
    && existing.isActive
    && existing.role === "Super Admin"
  ));
  const isManagedPendingRecovery = configuredRecoveryAdmin
    && configuredRecoveryAdmin.mustChangePassword
    && ["secure_bootstrap", "security_migration"].includes(configuredRecoveryAdmin.updatedBy)
    && configuredRecoveryAdmin.temporaryPasswordExpiresAt
    && Date.parse(configuredRecoveryAdmin.temporaryPasswordExpiresAt) <= Date.now();

  if (isManagedPendingRecovery) {
    await backupSecurityMigrationState(records);
    const replacementHash = hashPassword(recoveryTemporaryPassword);
    configuredRecoveryAdmin.passwordHash = replacementHash;
    configuredRecoveryAdmin.temporaryPasswordExpiresAt = temporaryPasswordExpiresAt();
    configuredRecoveryAdmin.failedLoginAttempts = 0;
    configuredRecoveryAdmin.lockedUntil = null;
    configuredRecoveryAdmin.updatedAt = now();
    configuredRecoveryAdmin.updatedBy = "security_migration";
    bumpTokenVersion(configuredRecoveryAdmin);
    await saveUser(configuredRecoveryAdmin);
    await savePasswordHistory(configuredRecoveryAdmin.userId, replacementHash);
    await addAuditLog({ actor: null, action: "RECOVERY_CREDENTIAL_REISSUED", targetType: "User", targetId: configuredRecoveryAdmin.userId, metadata: { source: "secure_environment_migration" } });
    return;
  }

  const legacyDefaultUsers = records.filter((existing) => (
    !existing.passwordChangedAt && verifyPassword(existing.userId, existing.passwordHash)
  ));
  if (!legacyDefaultUsers.length) return;

  const recoveryAdmin = legacyDefaultUsers.find((existing) => (
    recoveryConfigured
    && existing.userId === recoveryUserId
    && existing.isActive
    && existing.role === "Super Admin"
  ));
  if (!recoveryAdmin) {
    throw Object.assign(new Error("Legacy credential migration requires a configured active Super Admin recovery account."), { statusCode: 503 });
  }

  await backupSecurityMigrationState(records);

  for (const existing of legacyDefaultUsers) {
      if (existing.userId === recoveryAdmin.userId) {
        const replacementHash = hashPassword(recoveryTemporaryPassword);
        existing.passwordHash = replacementHash;
        existing.mustChangePassword = true;
        existing.isPending = true;
        existing.temporaryPasswordExpiresAt = temporaryPasswordExpiresAt();
        existing.updatedAt = now();
        existing.updatedBy = "security_migration";
        bumpTokenVersion(existing);
        await saveUser(existing);
        await savePasswordHistory(existing.userId, replacementHash);
        await addAuditLog({ actor: null, action: "RECOVERY_CREDENTIAL_ISSUED", targetType: "User", targetId: existing.userId, metadata: { source: "secure_environment_migration" } });
      } else {
        const replacementHash = hashPassword(generateTemporaryPassword());
        existing.passwordHash = replacementHash;
        existing.mustChangePassword = true;
        existing.isPending = true;
        existing.temporaryPasswordExpiresAt = null;
        existing.updatedAt = now();
        existing.updatedBy = "security_migration";
        bumpTokenVersion(existing);
        await saveUser(existing);
        await savePasswordHistory(existing.userId, replacementHash);
        await addAuditLog({ actor: null, action: "DEFAULT_CREDENTIAL_REVOKED", targetType: "User", targetId: existing.userId, metadata: { source: "seed_migration" } });
      }
  }
}

async function ensureSeedUsers() {
  if (!seedUsersPromise) {
    seedUsersPromise = runSeedUserMigration().catch((error) => {
      seedUsersPromise = null;
      throw error;
    });
  }
  return seedUsersPromise;
}

function validateNewPassword(user, currentPassword, newPassword, confirmPassword, history) {
  const next = String(newPassword || "").trim();
  const errors = [];
  if (next.length < 8) errors.push("New password must be at least 8 characters.");
  if (!/[a-z]/i.test(next) || !/\d/.test(next)) errors.push("New password should include both letters and numbers.");
  if (next !== String(confirmPassword || "").trim()) errors.push("Confirm password must match the new password.");
  if (next === user.mobile || next === user.userId) errors.push("New password cannot be the mobile number or user ID.");
  if (next === currentPassword) errors.push("New password cannot be the current password.");
  if (history.some((entry) => verifyPassword(next, entry.passwordHash))) {
    errors.push("New password cannot match a previous password.");
  }
  return errors;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signToken(user) {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret || secret.length < 24) {
    throw Object.assign(new Error("AUTH_TOKEN_SECRET must be configured with at least 24 characters."), { statusCode: 500 });
  }

  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    sub: user.userId,
    role: user.role,
    ver: Math.max(0, Number(user.tokenVersion || 0)),
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  }));
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret) {
    throw Object.assign(new Error("AUTH_TOKEN_SECRET is not configured."), { statusCode: 500 });
  }

  const [header, payload, signature] = String(token || "").split(".");
  if (!header || !payload || !signature) {
    throw Object.assign(new Error("Invalid session token."), { statusCode: 401 });
  }

  const expected = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw Object.assign(new Error("Invalid session token."), { statusCode: 401 });
  }

  let decoded;
  try {
    const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    if (decodedHeader.alg !== "HS256" || decodedHeader.typ !== "JWT") {
      throw new Error("Unsupported token header.");
    }
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid session token."), { statusCode: 401 });
  }
  if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error("Session expired."), { statusCode: 401 });
  }

  return decoded;
}

module.exports = {
  addAuditLog,
  assertTokenForUser,
  bumpTokenVersion,
  ensureSeedUsers,
  getPasswordHistory,
  getUser,
  hashPassword,
  listAuditLogs,
  listUsers,
  normalizeRole,
  registerFailedLoginAtomic,
  safeUser,
  savePasswordHistory,
  saveUser,
  signToken,
  validateNewPassword,
  verifyPassword,
  verifyToken,
};
