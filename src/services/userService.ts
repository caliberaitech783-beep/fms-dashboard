import seedUsers from "../data/seed/users.json";
import { APP_VERSION } from "../constants/appVersion";
import { hashPassword, verifyPassword } from "../auth/passwordService";
import { addAuditLog } from "./auditLogService";
import type { AppUser, PasswordHistoryRecord, SeedUserDefinition, UserRole } from "../types/auth";
import { validateNewPassword } from "../utils/passwordValidation";

const USERS_STORAGE_KEY = "mining.auth.users.v1";
const PASSWORD_HISTORY_STORAGE_KEY = "mining.auth.passwordHistory.v1";

export interface CreateUserInput {
  name: string;
  userId: string;
  role: UserRole;
  department?: string;
  isActive?: boolean;
}

function now(): string {
  return new Date().toISOString();
}

function makeId(prefix: string, stableValue?: string): string {
  return stableValue ? `${prefix}-${stableValue}` : `${prefix}-${crypto.randomUUID?.() ?? Date.now()}`;
}

function readUsers(): AppUser[] {
  const raw = localStorage.getItem(USERS_STORAGE_KEY);
  return raw ? JSON.parse(raw) as AppUser[] : [];
}

function writeUsers(users: AppUser[]) {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function readPasswordHistory(): PasswordHistoryRecord[] {
  const raw = localStorage.getItem(PASSWORD_HISTORY_STORAGE_KEY);
  return raw ? JSON.parse(raw) as PasswordHistoryRecord[] : [];
}

function writePasswordHistory(history: PasswordHistoryRecord[]) {
  localStorage.setItem(PASSWORD_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function normalizeSeedUser(seed: SeedUserDefinition): SeedUserDefinition {
  return {
    ...seed,
    sourceTransactionPower: seed.sourceTransactionPower === "None" ? null : seed.sourceTransactionPower,
    sourceSoftwarePower: seed.sourceSoftwarePower === "None" ? null : seed.sourceSoftwarePower,
  };
}

export async function initializeUserStore(): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
  const seeds = (seedUsers as SeedUserDefinition[]).map(normalizeSeedUser);
  const users = readUsers();
  const history = readPasswordHistory();
  let created = 0;
  let updated = 0;

  for (const seed of seeds) {
    const existing = users.find((user) => user.userId === seed.mobile);
    if (!existing) {
      const passwordHash = await hashPassword(seed.mobile);
      const createdAt = now();
      const user: AppUser = {
        id: makeId("user", seed.mobile),
        name: seed.name,
        mobile: seed.mobile,
        userId: seed.mobile,
        passwordHash,
        role: seed.mappedMiningRole,
        sourceTransactionPower: seed.sourceTransactionPower,
        sourceSoftwarePower: seed.sourceSoftwarePower,
        siteAccess: [],
        department: null,
        isActive: true,
        isPending: false,
        mustChangePassword: true,
        passwordChangedAt: null,
        lastLoginAt: null,
        lastLogoutAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt,
        updatedAt: createdAt,
        createdBy: "seed",
        updatedBy: "seed",
        lastPasswordResetAt: null,
        lastPasswordResetBy: null,
        appVersionAtLogin: null,
      };
      users.push(user);
      history.push({ id: makeId("history"), userId: user.userId, passwordHash, createdAt });
      addAuditLog({ actor: null, action: "USER_CREATED", targetType: "User", targetId: user.userId, metadata: { source: "seed" } });
      created += 1;
    } else {
      existing.name = seed.name;
      existing.mobile = seed.mobile;
      existing.role = seed.mappedMiningRole;
      existing.sourceTransactionPower = seed.sourceTransactionPower;
      existing.sourceSoftwarePower = seed.sourceSoftwarePower;
      existing.updatedAt = now();
      existing.updatedBy = "seed";
      existing.failedLoginAttempts = 0;
      existing.lockedUntil = null;
      updated += 1;
    }
  }

  for (const user of users) {
    if (user.lockedUntil) {
      user.lockedUntil = null;
      user.failedLoginAttempts = 0;
      user.updatedAt = now();
      user.updatedBy = "system";
      updated += 1;
    }
  }

  writeUsers(users);
  writePasswordHistory(history);
  return { created, updated, skipped: 0, errors: 0 };
}

export function getUsers(): AppUser[] {
  return readUsers().sort((left, right) => left.name.localeCompare(right.name));
}

export function getPasswordHistory(userId: string): PasswordHistoryRecord[] {
  return readPasswordHistory().filter((entry) => entry.userId === userId);
}

export function getUserById(userId: string): AppUser | null {
  return readUsers().find((user) => user.userId === userId) ?? null;
}

export async function authenticateUser(userId: string, password: string): Promise<AppUser> {
  const users = readUsers();
  const user = users.find((item) => item.userId === userId.trim());
  const genericError = new Error("Invalid mobile/user ID or password.");

  if (!user) {
    addAuditLog({ actor: null, action: "LOGIN_FAILED", targetType: "User", targetId: userId, metadata: { reason: "invalid_credentials" } });
    throw genericError;
  }

  if (!user.isActive) {
    addAuditLog({ actor: user, action: "LOGIN_FAILED", targetType: "User", targetId: user.userId, metadata: { reason: "inactive" } });
    throw genericError;
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    user.failedLoginAttempts += 1;
    user.lockedUntil = null;
    user.updatedAt = now();
    writeUsers(users);
    addAuditLog({ actor: user, action: "LOGIN_FAILED", targetType: "User", targetId: user.userId, metadata: { reason: "invalid_credentials" } });
    throw genericError;
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = now();
  user.appVersionAtLogin = APP_VERSION;
  user.updatedAt = now();
  writeUsers(users);
  addAuditLog({ actor: user, action: "LOGIN_SUCCESS", targetType: "User", targetId: user.userId, metadata: { appVersion: APP_VERSION } });
  return user;
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string, confirmPassword: string): Promise<AppUser> {
  const users = readUsers();
  const user = users.find((item) => item.userId === userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const currentMatches = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentMatches) {
    throw new Error("Current password is incorrect.");
  }

  const history = getPasswordHistory(user.userId);
  const validationErrors = await validateNewPassword(user, currentPassword, newPassword, confirmPassword, history);
  if (validationErrors.length) {
    throw new Error(validationErrors.join(" "));
  }

  const passwordHash = await hashPassword(newPassword.trim());
  user.passwordHash = passwordHash;
  user.mustChangePassword = false;
  user.passwordChangedAt = now();
  user.updatedAt = now();
  user.updatedBy = user.userId;
  writeUsers(users);

  const passwordHistory = readPasswordHistory();
  passwordHistory.push({ id: makeId("history"), userId: user.userId, passwordHash, createdAt: now() });
  writePasswordHistory(passwordHistory);
  addAuditLog({ actor: user, action: "PASSWORD_CHANGED", targetType: "User", targetId: user.userId });
  return user;
}

function assertSuperAdmin(actor: AppUser) {
  if (actor.role !== "Super Admin") {
    throw new Error("Only Super Admin users can perform this action.");
  }
}

export async function createUser(actor: AppUser, input: CreateUserInput): Promise<AppUser> {
  assertSuperAdmin(actor);
  const name = input.name.trim();
  const userId = input.userId.trim();
  const department = input.department?.trim() || null;

  if (!name) {
    throw new Error("User name is required.");
  }

  if (!userId) {
    throw new Error("Mobile number / user ID is required.");
  }

  if (userId.length < 4) {
    throw new Error("Mobile number / user ID must be at least 4 characters.");
  }

  const users = readUsers();
  const duplicate = users.find((user) => user.userId.toLowerCase() === userId.toLowerCase() || user.mobile.toLowerCase() === userId.toLowerCase());
  if (duplicate) {
    throw new Error("A user with this mobile number / user ID already exists.");
  }

  const passwordHash = await hashPassword(userId);
  const createdAt = now();
  const user: AppUser = {
    id: makeId("user", userId),
    name,
    mobile: userId,
    userId,
    passwordHash,
    role: input.role,
    sourceTransactionPower: null,
    sourceSoftwarePower: null,
    siteAccess: [],
    department,
    isActive: input.isActive ?? true,
    isPending: false,
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
  };

  users.push(user);
  writeUsers(users);

  const history = readPasswordHistory();
  history.push({ id: makeId("history"), userId: user.userId, passwordHash, createdAt });
  writePasswordHistory(history);
  addAuditLog({ actor, action: "USER_CREATED", targetType: "User", targetId: user.userId, metadata: { source: "admin_ui", role: user.role } });
  return user;
}

export async function resetUserPassword(actor: AppUser, targetUserId: string): Promise<AppUser> {
  assertSuperAdmin(actor);
  const users = readUsers();
  const target = users.find((user) => user.userId === targetUserId);
  if (!target) {
    throw new Error("User not found.");
  }

  const passwordHash = await hashPassword(target.userId);
  target.passwordHash = passwordHash;
  target.mustChangePassword = true;
  target.failedLoginAttempts = 0;
  target.lockedUntil = null;
  target.lastPasswordResetAt = now();
  target.lastPasswordResetBy = actor.userId;
  target.updatedAt = now();
  target.updatedBy = actor.userId;
  writeUsers(users);

  const history = readPasswordHistory();
  history.push({ id: makeId("history"), userId: target.userId, passwordHash, createdAt: now() });
  writePasswordHistory(history);
  addAuditLog({ actor, action: "PASSWORD_RESET_BY_ADMIN", targetType: "User", targetId: target.userId });
  return target;
}

export function setUserActive(actor: AppUser, targetUserId: string, isActive: boolean): AppUser {
  assertSuperAdmin(actor);
  const users = readUsers();
  const target = users.find((user) => user.userId === targetUserId);
  if (!target) {
    throw new Error("User not found.");
  }
  target.isActive = isActive;
  target.updatedAt = now();
  target.updatedBy = actor.userId;
  writeUsers(users);
  addAuditLog({
    actor,
    action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    targetType: "User",
    targetId: target.userId,
  });
  return target;
}

export function setUserRole(actor: AppUser, targetUserId: string, role: UserRole): AppUser {
  assertSuperAdmin(actor);
  const users = readUsers();
  const target = users.find((user) => user.userId === targetUserId);
  if (!target) {
    throw new Error("User not found.");
  }
  target.role = role;
  target.updatedAt = now();
  target.updatedBy = actor.userId;
  writeUsers(users);
  addAuditLog({ actor, action: "ROLE_CHANGED", targetType: "User", targetId: target.userId, metadata: { role } });
  return target;
}

export function markUserLoggedOut(user: AppUser) {
  const users = readUsers();
  const target = users.find((item) => item.userId === user.userId);
  if (target) {
    target.lastLogoutAt = now();
    target.updatedAt = now();
    writeUsers(users);
  }
  addAuditLog({ actor: user, action: "LOGOUT", targetType: "User", targetId: user.userId });
}
