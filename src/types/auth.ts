export type UserRole =
  | "Super Admin"
  | "Management"
  | "Site Manager"
  | "Fleet Manager"
  | "Fuel Manager"
  | "MIS User"
  | "Viewer";

export type Permission =
  | "dashboard:full"
  | "dashboard:management"
  | "fleet:read"
  | "fuel:read"
  | "production:read"
  | "alerts:read"
  | "reports:read"
  | "reports:export"
  | "notifications:read"
  | "notifications:manage"
  | "integrations:manage"
  | "whatsapp:manage"
  | "master-data:manage"
  | "settings:read"
  | "users:manage"
  | "audit:read";

export interface AppUser {
  id: string;
  name: string;
  mobile: string;
  userId: string;
  passwordHash: string;
  role: UserRole;
  sourceTransactionPower: string | null;
  sourceSoftwarePower: string | null;
  siteAccess: string[];
  department: string | null;
  isActive: boolean;
  isPending: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  lastLogoutAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  lastPasswordResetAt: string | null;
  lastPasswordResetBy: string | null;
  appVersionAtLogin: string | null;
  temporaryPasswordExpiresAt?: string | null;
}

export interface PasswordHistoryRecord {
  id: string;
  userId: string;
  passwordHash: string;
  createdAt: string;
}

export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_BY_ADMIN"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_ACTIVATED"
  | "USER_DEACTIVATED"
  | "ROLE_CHANGED"
  | "AUTO_LOGOUT_APP_UPDATE";

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuthSession {
  userId: string;
  role: UserRole;
  mustChangePassword: boolean;
  appVersion: string;
  loginAt: string;
  token?: string | null;
}

export interface SeedUserDefinition {
  name: string;
  mobile: string;
  sourceTransactionPower: string | null;
  sourceSoftwarePower: string | null;
  mappedMiningRole: UserRole;
}
