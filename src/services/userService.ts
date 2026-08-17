import { APP_VERSION } from "../constants/appVersion";
import { getAuthSession } from "../auth/sessionService";
import { clearFailedLogins, isLoginLocked, registerFailedLogin } from "../auth/securityPolicy";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "../auth/passwordService";
import { addAuditLog } from "./auditLogService";
import type { AppUser, PasswordHistoryRecord, UserRole } from "../types/auth";
import { validateNewPassword } from "../utils/passwordValidation";

const USERS_STORAGE_KEY = "mining.auth.users.v1";
const PASSWORD_HISTORY_STORAGE_KEY = "mining.auth.passwordHistory.v1";
const DEFAULT_AUTH_API_BASE_URL = "https://cmll-fms-api-783-hgadd9fqfdb5a8hq.centralindia-01.azurewebsites.net/api";
const AUTH_API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_AUTH_API_BASE_URL).replace(/\/$/, "");
const TEMPORARY_PASSWORD_TTL_MS = 24 * 60 * 60_000;
const CLIENT_SECURITY_PROTOCOL = "auth-v2";
const CREDENTIAL_PROTOCOL = "one-time-v1";

export interface CreateUserInput {
  name: string;
  userId: string;
  role: UserRole;
  department?: string;
  isActive?: boolean;
}

export interface AuthenticatedUser {
  user: AppUser;
  token: string | null;
}

export interface TemporaryCredentialResult {
  user: AppUser;
  temporaryPassword: string;
  expiresAt: string;
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

function remoteAuthEnabled(): boolean {
  return Boolean(AUTH_API_BASE_URL);
}

async function remoteRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthSession()?.token;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-FMS-Client-Security", CLIENT_SECURITY_PROTOCOL);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${AUTH_API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const payload = await response.json().catch(() => null) as { message?: string } | T | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload ? payload.message : null;
    throw new Error(message || "Request failed.");
  }

  return payload as T;
}

export async function initializeUserStore(): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
  if (remoteAuthEnabled()) {
    return { created: 0, updated: 0, skipped: 0, errors: 0 };
  }

  const users = readUsers();
  let updated = 0;

  // Existing local installations are retained, but known user-ID default passwords
  // are forced through the password-change screen. No employee seed data is bundled.
  for (const user of users) {
    if (!user.mustChangePassword && !user.passwordChangedAt && await verifyPassword(user.userId, user.passwordHash)) {
      user.mustChangePassword = true;
      user.updatedAt = now();
      user.updatedBy = "system";
      updated += 1;
    }
  }

  writeUsers(users);
  return { created: 0, updated, skipped: users.length - updated, errors: 0 };
}

export async function getUsers(): Promise<AppUser[]> {
  if (remoteAuthEnabled()) {
    const session = getAuthSession();
    if (!session?.token || session.role !== "Super Admin") {
      return [];
    }
    return remoteRequest<AppUser[]>("/users");
  }

  return readUsers().sort((left, right) => left.name.localeCompare(right.name));
}

export function getPasswordHistory(userId: string): PasswordHistoryRecord[] {
  return readPasswordHistory().filter((entry) => entry.userId === userId);
}

export async function getUserById(userId: string): Promise<AppUser | null> {
  if (remoteAuthEnabled()) {
    if (!getAuthSession()?.token) {
      return null;
    }
    const user = await remoteRequest<AppUser>("/auth/me").catch(() => null);
    return user?.userId === userId ? user : null;
  }

  return readUsers().find((user) => user.userId === userId) ?? null;
}

export async function authenticateUser(userId: string, password: string): Promise<AuthenticatedUser> {
  if (remoteAuthEnabled()) {
    return remoteRequest<AuthenticatedUser>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId, password, appVersion: APP_VERSION }),
    });
  }

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

  if (isLoginLocked(user)) {
    addAuditLog({ actor: user, action: "LOGIN_FAILED", targetType: "User", targetId: user.userId, metadata: { reason: "account_locked" } });
    throw genericError;
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    registerFailedLogin(user);
    user.updatedAt = now();
    writeUsers(users);
    addAuditLog({ actor: user, action: "LOGIN_FAILED", targetType: "User", targetId: user.userId, metadata: { reason: "invalid_credentials" } });
    throw genericError;
  }

  if (user.mustChangePassword && user.temporaryPasswordExpiresAt
    && Date.parse(user.temporaryPasswordExpiresAt) <= Date.now()) {
    addAuditLog({ actor: user, action: "LOGIN_FAILED", targetType: "User", targetId: user.userId, metadata: { reason: "temporary_password_expired" } });
    throw genericError;
  }

  clearFailedLogins(user);
  user.lastLoginAt = now();
  user.appVersionAtLogin = APP_VERSION;
  user.updatedAt = now();
  writeUsers(users);
  addAuditLog({ actor: user, action: "LOGIN_SUCCESS", targetType: "User", targetId: user.userId, metadata: { appVersion: APP_VERSION } });
  return { user, token: null };
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string, confirmPassword: string): Promise<AuthenticatedUser> {
  if (remoteAuthEnabled()) {
    const result = await remoteRequest<AuthenticatedUser | AppUser>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    if ("user" in result) return result;
    return { user: result, token: getAuthSession()?.token ?? null };
  }

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
  user.isPending = false;
  user.temporaryPasswordExpiresAt = null;
  user.passwordChangedAt = now();
  user.updatedAt = now();
  user.updatedBy = user.userId;
  writeUsers(users);

  const passwordHistory = readPasswordHistory();
  passwordHistory.push({ id: makeId("history"), userId: user.userId, passwordHash, createdAt: now() });
  writePasswordHistory(passwordHistory);
  addAuditLog({ actor: user, action: "PASSWORD_CHANGED", targetType: "User", targetId: user.userId });
  return { user, token: null };
}

function assertSuperAdmin(actor: AppUser) {
  if (actor.role !== "Super Admin") {
    throw new Error("Only Super Admin users can perform this action.");
  }
}

export async function createUser(actor: AppUser, input: CreateUserInput): Promise<TemporaryCredentialResult> {
  if (remoteAuthEnabled()) {
    return remoteRequest<TemporaryCredentialResult>("/users", {
      method: "POST",
      headers: { "X-FMS-Credential-Protocol": CREDENTIAL_PROTOCOL },
      body: JSON.stringify(input),
    });
  }

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

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS).toISOString();
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
    temporaryPasswordExpiresAt: expiresAt,
  };

  users.push(user);
  writeUsers(users);

  const history = readPasswordHistory();
  history.push({ id: makeId("history"), userId: user.userId, passwordHash, createdAt });
  writePasswordHistory(history);
  addAuditLog({ actor, action: "USER_CREATED", targetType: "User", targetId: user.userId, metadata: { source: "admin_ui", role: user.role } });
  return { user, temporaryPassword, expiresAt };
}

export async function resetUserPassword(actor: AppUser, targetUserId: string): Promise<TemporaryCredentialResult> {
  if (remoteAuthEnabled()) {
    return remoteRequest<TemporaryCredentialResult>(`/users/${encodeURIComponent(targetUserId)}/reset-password`, {
      method: "POST",
      headers: { "X-FMS-Credential-Protocol": CREDENTIAL_PROTOCOL },
    });
  }

  assertSuperAdmin(actor);
  const users = readUsers();
  const target = users.find((user) => user.userId === targetUserId);
  if (!target) {
    throw new Error("User not found.");
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS).toISOString();
  target.passwordHash = passwordHash;
  target.mustChangePassword = true;
  target.isPending = true;
  target.temporaryPasswordExpiresAt = expiresAt;
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
  return { user: target, temporaryPassword, expiresAt };
}

export async function setUserActive(actor: AppUser, targetUserId: string, isActive: boolean): Promise<AppUser> {
  if (remoteAuthEnabled()) {
    return remoteRequest<AppUser>(`/users/${encodeURIComponent(targetUserId)}/active`, {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    });
  }

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

export async function setUserRole(actor: AppUser, targetUserId: string, role: UserRole): Promise<AppUser> {
  if (remoteAuthEnabled()) {
    return remoteRequest<AppUser>(`/users/${encodeURIComponent(targetUserId)}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  }

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

export async function markUserLoggedOut(user: AppUser): Promise<void> {
  if (remoteAuthEnabled()) {
    await remoteRequest<{ ok: boolean }>("/auth/logout", { method: "POST" }).catch(() => ({ ok: false }));
    return;
  }

  const users = readUsers();
  const target = users.find((item) => item.userId === user.userId);
  if (target) {
    target.lastLogoutAt = now();
    target.updatedAt = now();
    writeUsers(users);
  }
  addAuditLog({ actor: user, action: "LOGOUT", targetType: "User", targetId: user.userId });
}
