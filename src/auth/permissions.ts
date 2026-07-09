import type { NavItemId } from "../constants/routes";
import type { AppUser, Permission, UserRole } from "../types/auth";

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  "Super Admin": [
    "dashboard:full",
    "dashboard:management",
    "fleet:read",
    "fuel:read",
    "production:read",
    "alerts:read",
    "reports:read",
    "reports:export",
    "integrations:manage",
    "whatsapp:manage",
    "master-data:manage",
    "settings:read",
    "users:manage",
    "audit:read",
  ],
  Management: [
    "dashboard:management",
    "fleet:read",
    "fuel:read",
    "production:read",
    "alerts:read",
    "reports:read",
    "reports:export",
  ],
  "Site Manager": [
    "dashboard:management",
    "fleet:read",
    "fuel:read",
    "production:read",
    "alerts:read",
    "reports:read",
  ],
  "Fleet Manager": ["fleet:read", "alerts:read", "reports:read"],
  "Fuel Manager": ["fuel:read", "alerts:read", "reports:read"],
  "MIS User": ["dashboard:management", "reports:read", "master-data:manage"],
  Viewer: ["dashboard:management", "reports:read"],
};

const NAV_PERMISSIONS: Record<NavItemId, Permission[]> = {
  management: ["dashboard:management", "dashboard:full"],
  fleet: ["fleet:read", "dashboard:full"],
  fuel: ["fuel:read", "dashboard:full"],
  production: ["production:read", "dashboard:full"],
  alerts: ["alerts:read", "dashboard:full"],
  reports: ["reports:read", "dashboard:full"],
  integrations: ["integrations:manage", "dashboard:full"],
  whatsapp: ["whatsapp:manage", "dashboard:full"],
  "master-data": ["master-data:manage", "dashboard:full"],
  settings: ["settings:read", "dashboard:full"],
  users: ["users:manage", "dashboard:full"],
};

export function hasPermission(user: AppUser | null, permission: Permission): boolean {
  if (!user || !user.isActive || user.mustChangePassword) {
    return false;
  }

  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

export function canAccessNav(user: AppUser | null, navId: NavItemId): boolean {
  if (!user || !user.isActive || user.mustChangePassword) {
    return false;
  }

  return NAV_PERMISSIONS[navId].some((permission) => hasPermission(user, permission));
}
