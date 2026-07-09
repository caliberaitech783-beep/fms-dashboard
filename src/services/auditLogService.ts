import type { AppUser, AuditAction, AuditLog } from "../types/auth";

const AUDIT_STORAGE_KEY = "mining.auth.auditLogs.v1";

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

export function getAuditLogs(): AuditLog[] {
  return readAuditLogs();
}
