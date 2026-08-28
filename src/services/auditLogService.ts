import type { AppUser, AuditAction, AuditLog } from "../types/auth";
import { getAuthSession } from "../auth/sessionService";

const AUDIT_STORAGE_KEY = "mining.auth.auditLogs.v1";
const DEFAULT_AUTH_API_BASE_URL = "https://cmll-fms-api-b3-783.azurewebsites.net/api";
const AUTH_API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_AUTH_API_BASE_URL).replace(/\/$/, "");

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function readAuditLogs(): AuditLog[] {
  const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
  return raw ? JSON.parse(raw) as AuditLog[] : [];
}

function writeAuditLogs(logs: AuditLog[]) {
  localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(logs.slice(0, 500)));
}

function remoteAuthEnabled(): boolean {
  return Boolean(AUTH_API_BASE_URL);
}

async function remoteRequest<T>(path: string): Promise<T> {
  const token = getAuthSession()?.token;
  const response = await fetch(`${AUTH_API_BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    return [] as T;
  }

  return response.json() as Promise<T>;
}

export function addAuditLog({
  actor,
  action,
  targetType,
  targetId,
  metadata = {},
}: {
  actor: Pick<AppUser, "userId" | "name"> | null;
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}): AuditLog {
  const log: AuditLog = {
    id: makeId("audit"),
    actorUserId: actor?.userId ?? null,
    actorName: actor?.name ?? null,
    action,
    targetType,
    targetId,
    metadata,
    ipAddress: null,
    userAgent: navigator.userAgent,
    createdAt: new Date().toISOString(),
  };

  writeAuditLogs([log, ...readAuditLogs()]);
  return log;
}

export async function getAuditLogs(): Promise<AuditLog[]> {
  if (remoteAuthEnabled()) {
    const session = getAuthSession();
    if (!session?.token || session.role !== "Super Admin") {
      return [];
    }
    return remoteRequest<AuditLog[]>("/audit-logs");
  }

  return readAuditLogs();
}
