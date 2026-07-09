import type { AuthSession } from "../types/auth";

const SESSION_STORAGE_KEY = "mining.auth.session.v1";
const REMEMBERED_USER_ID_KEY = "mining.auth.rememberedUserId.v1";
const REMEMBERED_CREDENTIALS_KEY = "mining.auth.rememberedCredentials.v1";
const UPDATE_MESSAGE_KEY = "mining.auth.updateMessage.v1";

interface RememberedCredentials {
  userId: string;
  password: string;
}

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
  return getRememberedCredentials().userId;
}

export function getRememberedCredentials(): RememberedCredentials {
  const raw = localStorage.getItem(REMEMBERED_CREDENTIALS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<RememberedCredentials>;
      return {
        userId: String(parsed.userId ?? ""),
        password: String(parsed.password ?? ""),
      };
    } catch {
      localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
    }
  }

  return {
    userId: localStorage.getItem(REMEMBERED_USER_ID_KEY) ?? "",
    password: "",
  };
}

export function setRememberedUserId(userId: string | null) {
  if (userId) {
    localStorage.setItem(REMEMBERED_USER_ID_KEY, userId);
  } else {
    localStorage.removeItem(REMEMBERED_USER_ID_KEY);
  }
}

export function setRememberedCredentials(userId: string | null, password: string | null) {
  if (userId && password) {
    localStorage.setItem(REMEMBERED_CREDENTIALS_KEY, JSON.stringify({ userId, password }));
    localStorage.setItem(REMEMBERED_USER_ID_KEY, userId);
  } else {
    localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
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
