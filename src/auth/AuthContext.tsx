import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { APP_VERSION, APP_VERSION_CHECK_INTERVAL_MS } from "../constants/appVersion";
import type { AppUser, AuditLog, UserRole } from "../types/auth";
import {
  authenticateUser,
  changeUserPassword,
  createUser as createUserRecord,
  type CreateUserInput,
  getUserById,
  getUsers,
  initializeUserStore,
  markUserLoggedOut,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from "../services/userService";
import { addAuditLog, getAuditLogs } from "../services/auditLogService";
import {
  clearAuthSession,
  consumeUpdateMessage,
  getAuthSession,
  getRememberedCredentials,
  getRememberedUserId,
  setAuthSession,
  setRememberedCredentials,
  setRememberedUserId,
  setUpdateMessage,
} from "./sessionService";

interface AuthContextValue {
  currentUser: AppUser | null;
  users: AppUser[];
  auditLogs: AuditLog[];
  loading: boolean;
  rememberedUserId: string;
  rememberedPassword: string;
  updateMessage: string | null;
  login: (userId: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) => Promise<void>;
  createUser: (input: CreateUserInput) => Promise<void>;
  resetPassword: (targetUserId: string) => Promise<void>;
  updateUserActive: (targetUserId: string, isActive: boolean) => Promise<void>;
  updateUserRole: (targetUserId: string, role: UserRole) => Promise<void>;
  refreshUsers: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [updateMessage, setUpdateMessageState] = useState<string | null>(null);

  const refreshUsers = async () => {
    const [latestUsers, latestAuditLogs] = await Promise.all([
      getUsers(),
      getAuditLogs(),
    ]);
    setUsers(latestUsers);
    setAuditLogs(latestAuditLogs);
  };

  useEffect(() => {
    let mounted = true;

    initializeUserStore().then(async () => {
      if (!mounted) {
        return;
      }

      const message = consumeUpdateMessage();
      if (message) {
        setUpdateMessageState(message);
      }

      const session = getAuthSession();
      if (session) {
        if (session.appVersion !== APP_VERSION) {
          const user = await getUserById(session.userId);
          if (user) {
            addAuditLog({
              actor: user,
              action: "AUTO_LOGOUT_APP_UPDATE",
              targetType: "Session",
              targetId: session.userId,
              metadata: { from: session.appVersion, to: APP_VERSION },
            });
          }
          clearAuthSession();
          setUpdateMessage("The application has been updated. Please log in again to load the latest version.");
          setUpdateMessageState("The application has been updated. Please log in again to load the latest version.");
        } else {
          setCurrentUser(await getUserById(session.userId));
        }
      }

      await refreshUsers();
      setLoading(false);
    }).catch(() => {
      if (mounted) {
        clearAuthSession();
        setCurrentUser(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const session = getAuthSession();
      if (session && session.appVersion !== APP_VERSION) {
        const user = await getUserById(session.userId);
        if (user) {
          addAuditLog({
            actor: user,
            action: "AUTO_LOGOUT_APP_UPDATE",
            targetType: "Session",
            targetId: session.userId,
            metadata: { from: session.appVersion, to: APP_VERSION },
          });
        }
        clearAuthSession();
        setCurrentUser(null);
        setUpdateMessageState("The application has been updated. Please log in again to load the latest version.");
      }
    }, APP_VERSION_CHECK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, []);

  const login = async (userId: string, password: string, remember: boolean) => {
    const { user, token } = await authenticateUser(userId, password);
    setAuthSession({
      userId: user.userId,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      appVersion: APP_VERSION,
      loginAt: new Date().toISOString(),
      token,
    });
    if (remember) {
      setRememberedCredentials(user.userId, password);
    } else {
      setRememberedCredentials(null, null);
      setRememberedUserId(null);
    }
    setCurrentUser(user);
    setUpdateMessageState(null);
    await refreshUsers();
  };

  const logout = async () => {
    if (currentUser) {
      await markUserLoggedOut(currentUser);
    }
    clearAuthSession();
    setCurrentUser(null);
    await refreshUsers();
  };

  const changePassword = async (currentPassword: string, newPassword: string, confirmPassword: string) => {
    if (!currentUser) {
      throw new Error("No active session.");
    }

    const updatedUser = await changeUserPassword(currentUser.userId, currentPassword, newPassword, confirmPassword);
    setAuthSession({
      userId: updatedUser.userId,
      role: updatedUser.role,
      mustChangePassword: updatedUser.mustChangePassword,
      appVersion: APP_VERSION,
      loginAt: new Date().toISOString(),
      token: getAuthSession()?.token ?? null,
    });
    if (getRememberedCredentials().userId === updatedUser.userId) {
      setRememberedCredentials(updatedUser.userId, newPassword);
    }
    setCurrentUser(updatedUser);
    await refreshUsers();
  };

  const createUser = async (input: CreateUserInput) => {
    if (!currentUser) {
      throw new Error("No active session.");
    }
    await createUserRecord(currentUser, input);
    refreshUsers();
  };

  const resetPassword = async (targetUserId: string) => {
    if (!currentUser) {
      throw new Error("No active session.");
    }
    const updated = await resetUserPassword(currentUser, targetUserId);
    if (updated.userId === currentUser.userId) {
      setCurrentUser(updated);
    }
    await refreshUsers();
  };

  const updateUserActive = async (targetUserId: string, isActive: boolean) => {
    if (!currentUser) {
      throw new Error("No active session.");
    }
    const updated = await setUserActive(currentUser, targetUserId, isActive);
    if (updated.userId === currentUser.userId && !updated.isActive) {
      clearAuthSession();
      setCurrentUser(null);
    }
    await refreshUsers();
  };

  const updateUserRole = async (targetUserId: string, role: UserRole) => {
    if (!currentUser) {
      throw new Error("No active session.");
    }
    const updated = await setUserRole(currentUser, targetUserId, role);
    if (updated.userId === currentUser.userId) {
      setCurrentUser(updated);
    }
    await refreshUsers();
  };

  const value = useMemo<AuthContextValue>(() => ({
    currentUser,
    users,
    auditLogs,
    loading,
    rememberedUserId: getRememberedUserId(),
    rememberedPassword: getRememberedCredentials().password,
    updateMessage,
    login,
    logout,
    changePassword,
    createUser,
    resetPassword,
    updateUserActive,
    updateUserRole,
    refreshUsers,
  }), [auditLogs, currentUser, loading, updateMessage, users]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
