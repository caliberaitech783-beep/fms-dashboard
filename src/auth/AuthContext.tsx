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
  getRememberedUserId,
  setAuthSession,
  setRememberedUserId,
  setUpdateMessage,
} from "./sessionService";

interface AuthContextValue {
  currentUser: AppUser | null;
  users: AppUser[];
  auditLogs: AuditLog[];
  loading: boolean;
  rememberedUserId: string;
  updateMessage: string | null;
  login: (userId: string, password: string, remember: boolean) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) => Promise<void>;
  createUser: (input: CreateUserInput) => Promise<void>;
  resetPassword: (targetUserId: string) => Promise<void>;
  updateUserActive: (targetUserId: string, isActive: boolean) => void;
  updateUserRole: (targetUserId: string, role: UserRole) => void;
  refreshUsers: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [updateMessage, setUpdateMessageState] = useState<string | null>(null);

  const refreshUsers = () => {
    setUsers(getUsers());
    setAuditLogs(getAuditLogs());
  };

  useEffect(() => {
    let mounted = true;

    initializeUserStore().then(() => {
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
          const user = getUserById(session.userId);
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
          setCurrentUser(getUserById(session.userId));
        }
      }

      refreshUsers();
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const session = getAuthSession();
      if (session && session.appVersion !== APP_VERSION) {
        const user = getUserById(session.userId);
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
    const user = await authenticateUser(userId, password);
    setAuthSession({
      userId: user.userId,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      appVersion: APP_VERSION,
      loginAt: new Date().toISOString(),
    });
    setRememberedUserId(remember ? user.userId : null);
    setCurrentUser(user);
    setUpdateMessageState(null);
    refreshUsers();
  };

  const logout = () => {
    if (currentUser) {
      markUserLoggedOut(currentUser);
    }
    clearAuthSession();
    setCurrentUser(null);
    refreshUsers();
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
    });
    setCurrentUser(updatedUser);
    refreshUsers();
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
    refreshUsers();
  };

  const updateUserActive = (targetUserId: string, isActive: boolean) => {
    if (!currentUser) {
      throw new Error("No active session.");
    }
    const updated = setUserActive(currentUser, targetUserId, isActive);
    if (updated.userId === currentUser.userId && !updated.isActive) {
      clearAuthSession();
      setCurrentUser(null);
    }
    refreshUsers();
  };

  const updateUserRole = (targetUserId: string, role: UserRole) => {
    if (!currentUser) {
      throw new Error("No active session.");
    }
    const updated = setUserRole(currentUser, targetUserId, role);
    if (updated.userId === currentUser.userId) {
      setCurrentUser(updated);
    }
    refreshUsers();
  };

  const value = useMemo<AuthContextValue>(() => ({
    currentUser,
    users,
    auditLogs,
    loading,
    rememberedUserId: getRememberedUserId(),
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
