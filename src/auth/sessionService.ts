import type { AuthSession } from "../types/auth";

const SESSION_STORAGE_KEY = "mining.auth.session.v1";
const REMEMBERED_USER_ID_KEY = "mining.auth.rememberedUserId.v1";
// Kept only so older installations can be migrated away from plaintext credentials.
const REMEMBERED_CREDENTIALS_KEY = "mining.auth.rememberedCredentials.v1";
const UPDATE_MESSAGE_KEY = "mining.auth.updateMessage.v1";
const CLEAN_SLATE_PURGE_KEY = "mining.auth.cleanSlatePurge.v1";
const CLEAN_SLATE_PURGE_VERSION = "2026-07-09-users-wiped-v1";
const LOCAL_AUTH_KEYS = [
  "mining.auth.auditLogs.v1",
  "mining.auth.passwordHistory.v1",
  "mining.auth.users.v1",
  REMEMBERED_CREDENTIALS_KEY,
  REMEMBERED_USER_ID_KEY,
];

export function getAuthSession(): AuthSession | null {
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? JSON.parse(raw) as AuthSession : null;
}

export function setAuthSession(session: AuthSession) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

export function purgeLocalAuthArtifactsForCleanSlate() {
  if (localStorage.getItem(CLEAN_SLATE_PURGE_KEY) === CLEAN_SLATE_PURGE_VERSION) {
    return;
  }

  for (const key of LOCAL_AUTH_KEYS) {
    localStorage.removeItem(key);
  }

  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  sessionStorage.removeItem(UPDATE_MESSAGE_KEY);
  localStorage.setItem(CLEAN_SLATE_PURGE_KEY, CLEAN_SLATE_PURGE_VERSION);
}

export function getRememberedUserId(): string {
  const rememberedUserId = localStorage.getItem(REMEMBERED_USER_ID_KEY) ?? "";
  const raw = localStorage.getItem(REMEMBERED_CREDENTIALS_KEY);
  if (!raw) {
    return rememberedUserId;
  }

  // Migrate only the identifier. The legacy password is deliberately discarded.
  try {
    const parsed = JSON.parse(raw) as { userId?: unknown };
    const legacyUserId = String(parsed.userId ?? "").trim();
    if (!rememberedUserId && legacyUserId) {
      localStorage.setItem(REMEMBERED_USER_ID_KEY, legacyUserId);
    }
    return rememberedUserId || legacyUserId;
  } catch {
    return rememberedUserId;
  } finally {
    localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
  }
}

export function setRememberedUserId(userId: string | null) {
  localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
  if (userId) {
    localStorage.setItem(REMEMBERED_USER_ID_KEY, userId);
  } else {
    localStorage.removeItem(REMEMBERED_USER_ID_KEY);
  }
}

export function setUpdateMessage(message: string) {
  sessionStorage.setItem(UPDATE_MESSAGE_KEY, message);
}

export function consumeUpdateMessage(): string | null {
  const message = sessionStorage.getItem(UPDATE_MESSAGE_KEY);
  sessionStorage.removeItem(UPDATE_MESSAGE_KEY);
  return message;
}
