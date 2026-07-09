import type { AuthSession } from "../types/auth";

const SESSION_STORAGE_KEY = "mining.auth.session.v1";
const REMEMBERED_USER_ID_KEY = "mining.auth.rememberedUserId.v1";
const UPDATE_MESSAGE_KEY = "mining.auth.updateMessage.v1";

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

export function getRememberedUserId(): string {
  return localStorage.getItem(REMEMBERED_USER_ID_KEY) ?? "";
}

export function setRememberedUserId(userId: string | null) {
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
