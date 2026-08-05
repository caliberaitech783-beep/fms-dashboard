import type { AppUser } from "../types/auth";

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const BASE_LOGIN_LOCKOUT_MS = 60_000;
export const MAX_LOGIN_LOCKOUT_MS = 15 * 60_000;

export function isLoginLocked(user: Pick<AppUser, "lockedUntil">, at = Date.now()): boolean {
  if (!user.lockedUntil) return false;
  const lockedUntil = Date.parse(user.lockedUntil);
  return Number.isFinite(lockedUntil) && lockedUntil > at;
}

export function registerFailedLogin(
  user: Pick<AppUser, "failedLoginAttempts" | "lockedUntil">,
  at = Date.now(),
): void {
  user.failedLoginAttempts = Math.max(0, Number(user.failedLoginAttempts || 0)) + 1;

  if (user.failedLoginAttempts < MAX_FAILED_LOGIN_ATTEMPTS) {
    user.lockedUntil = null;
    return;
  }

  const lockoutStep = user.failedLoginAttempts - MAX_FAILED_LOGIN_ATTEMPTS;
  const lockoutMs = Math.min(BASE_LOGIN_LOCKOUT_MS * (2 ** lockoutStep), MAX_LOGIN_LOCKOUT_MS);
  user.lockedUntil = new Date(at + lockoutMs).toISOString();
}

export function clearFailedLogins(user: Pick<AppUser, "failedLoginAttempts" | "lockedUntil">): void {
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
}
