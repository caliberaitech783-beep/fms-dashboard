import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Copy, KeyRound, UserPlus } from "lucide-react";
import type { AppUser, AuditLog, UserRole } from "../../types/auth";
import { useAuth } from "../../auth/AuthContext";
import { formatDateTime } from "../../utils/formatters";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

const roles: UserRole[] = ["Super Admin", "Management", "Site Manager", "Fleet Manager", "Fuel Manager", "MIS User", "Viewer"];
type UserSummaryFilter = "all" | "active" | "inactive" | "pending-password" | "today-login" | "never-logged" | "locked" | "online-now";

const initialCreateForm = {
  name: "",
  userId: "",
  role: "MIS User" as UserRole,
  department: "",
  isActive: true,
};

interface TemporaryCredentialView {
  name: string;
  userId: string;
  temporaryPassword: string;
  expiresAt: string;
}

export function UserManagementDashboard() {
  const { currentUser, users, auditLogs, createUser, resetPassword, updateUserActive, updateUserRole } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [summaryFilter, setSummaryFilter] = useState<UserSummaryFilter>("all");
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [temporaryCredential, setTemporaryCredential] = useState<TemporaryCredentialView | null>(null);
  const credentialDialogRef = useRef<HTMLDivElement>(null);
  const copyCredentialButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isSuperAdmin = currentUser?.role === "Super Admin";
  const activeSuperAdminCount = users.filter((user) => user.role === "Super Admin" && user.isActive).length;
  const todayKey = new Date().toDateString();

  const isLocked = (user: AppUser) => Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
  const hasLoggedInToday = (user: AppUser) => Boolean(user.lastLoginAt && new Date(user.lastLoginAt).toDateString() === todayKey);
  const isOnlineNow = (user: AppUser) => {
    if (!user.lastLoginAt || !user.isActive || isLocked(user)) {
      return false;
    }

    return !user.lastLogoutAt || new Date(user.lastLoginAt).getTime() > new Date(user.lastLogoutAt).getTime();
  };

  const summaryCards = useMemo(
    () => [
      { key: "all" as const, label: "Total Users", value: users.length },
      { key: "active" as const, label: "Active Users", value: users.filter((user) => user.isActive).length },
      { key: "inactive" as const, label: "Inactive Users", value: users.filter((user) => !user.isActive).length },
      { key: "pending-password" as const, label: "Pending Password", value: users.filter((user) => user.mustChangePassword).length },
      { key: "today-login" as const, label: "Today Login", value: users.filter(hasLoggedInToday).length },
      { key: "never-logged" as const, label: "Never Logged", value: users.filter((user) => !user.lastLoginAt).length },
      { key: "locked" as const, label: "Locked Users", value: users.filter(isLocked).length },
      { key: "online-now" as const, label: "Online Now", value: users.filter(isOnlineNow).length },
    ],
    [todayKey, users],
  );

  const summaryFilteredUsers = useMemo(() => {
    switch (summaryFilter) {
      case "active":
        return users.filter((user) => user.isActive);
      case "inactive":
        return users.filter((user) => !user.isActive);
      case "pending-password":
        return users.filter((user) => user.mustChangePassword);
      case "today-login":
        return users.filter(hasLoggedInToday);
      case "never-logged":
        return users.filter((user) => !user.lastLoginAt);
      case "locked":
        return users.filter(isLocked);
      case "online-now":
        return users.filter(isOnlineNow);
      case "all":
      default:
        return users;
    }
  }, [summaryFilter, todayKey, users]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return summaryFilteredUsers.filter((user) => {
      if (query && !`${user.name} ${user.mobile} ${user.userId}`.toLowerCase().includes(query)) return false;
      if (roleFilter !== "All" && user.role !== roleFilter) return false;
      if (statusFilter === "Active" && !user.isActive) return false;
      if (statusFilter === "Inactive" && user.isActive) return false;
      if (statusFilter === "Must Change Password" && !user.mustChangePassword) return false;
      return true;
    });
  }, [roleFilter, search, statusFilter, summaryFilteredUsers]);

  const selectSummaryFilter = (filter: UserSummaryFilter) => {
    setSummaryFilter(filter);
    setSearch("");
    setRoleFilter("All");
    setStatusFilter("All");
  };

  const userColumns: DataTableColumn<AppUser>[] = [
    { header: "Name", render: (row) => <span className="font-semibold text-coal-900">{row.name}</span>, className: "min-w-56" },
    { header: "Mobile / User ID", render: (row) => row.userId },
    { header: "Role", render: (row) => <Badge tone={row.role === "Super Admin" ? "good" : "info"}>{row.role}</Badge> },
    { header: "Status", render: (row) => <StatusBadge status={row.isActive ? "active" : "inactive"} /> },
    { header: "Password", render: (row) => <StatusBadge status={row.mustChangePassword ? "pending" : "ready"} /> },
    { header: "Login", render: (row) => <StatusBadge status={isLocked(row) ? "locked" : "ready"} /> },
    { header: "Last Login", render: (row) => formatDateTime(row.lastLoginAt) },
    {
      header: "Role Edit",
      render: (row) => {
        if (!isSuperAdmin) return "-";
        const isSelf = row.userId === currentUser?.userId;
        const isLastActiveAdmin = row.role === "Super Admin" && row.isActive && activeSuperAdminCount <= 1;
        return (
          <select
            value={row.role}
            disabled={isSelf || isLastActiveAdmin}
            aria-label={`Role for ${row.name}`}
            title={isSelf ? "You cannot change your own role." : isLastActiveAdmin ? "Add another active Super Admin first." : undefined}
            onChange={async (event) => {
              try {
                await updateUserRole(row.userId, event.target.value as UserRole);
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Could not update the role.");
              }
            }}
            className="h-9 rounded-md border border-coal-200 bg-white px-2 text-sm disabled:bg-coal-100"
          >
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        );
      },
    },
    {
      header: "Actions",
      render: (row) => {
        if (!isSuperAdmin) return "-";
        const isSelf = row.userId === currentUser?.userId;
        const isLastActiveAdmin = row.role === "Super Admin" && row.isActive && activeSuperAdminCount <= 1;
        return (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={isSelf} title={isSelf ? "Use Change Password for your own account." : undefined} onClick={() => setResetTarget(row)}>Reset</Button>
            <Button
              size="sm"
              disabled={isSelf || (row.isActive && isLastActiveAdmin)}
              title={isSelf ? "You cannot deactivate your own account." : isLastActiveAdmin ? "Add another active Super Admin first." : undefined}
              variant={row.isActive ? "danger" : "secondary"}
              onClick={async () => {
                try {
                  await updateUserActive(row.userId, !row.isActive);
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Could not update the account.");
                }
              }}
            >
              {row.isActive ? "Deactivate" : "Activate"}
            </Button>
          </div>
        );
      },
      className: "min-w-48",
    },
  ];

  const auditColumns: DataTableColumn<AuditLog>[] = [
    { header: "Time", render: (row) => formatDateTime(row.createdAt) },
    { header: "Actor", render: (row) => row.actorName ?? row.actorUserId ?? "System" },
    { header: "Action", render: (row) => row.action },
    { header: "Target", render: (row) => row.targetId ?? "-" },
  ];

  const confirmReset = async () => {
    if (!resetTarget || resetting || resetTarget.userId === currentUser?.userId) return;
    setResetting(true);
    try {
      const result = await resetPassword(resetTarget.userId);
      setTemporaryCredential({
        name: resetTarget.name,
        userId: resetTarget.userId,
        temporaryPassword: result.temporaryPassword,
        expiresAt: result.expiresAt,
      });
      setResetTarget(null);
      setMessage("Password reset. Copy the one-time password now; it is not stored or shown again.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reset the password.");
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    if (!temporaryCredential) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => copyCredentialButtonRef.current?.focus(), 0);
    return () => previousFocusRef.current?.focus();
  }, [temporaryCredential]);

  const trapCredentialDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !credentialDialogRef.current) return;
    const focusable = Array.from(credentialDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const openCreateForm = () => {
    setCreateForm(initialCreateForm);
    setCreateError(null);
    setShowCreateForm(true);
  };

  const submitCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      const result = await createUser(createForm);
      setTemporaryCredential({
        name: result.user.name,
        userId: result.user.userId,
        temporaryPassword: result.temporaryPassword,
        expiresAt: result.expiresAt,
      });
      setMessage(`User ${createForm.name.trim()} added. Copy the one-time password now; it is not stored or shown again.`);
      setCreateForm(initialCreateForm);
      setShowCreateForm(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not add user.");
    } finally {
      setCreating(false);
    }
  };

  const copyTemporaryPassword = async () => {
    if (!temporaryCredential) return;
    try {
      await navigator.clipboard.writeText(temporaryCredential.temporaryPassword);
      setMessage("One-time password copied. Share it through an approved private channel.");
    } catch {
      setMessage("Copy was blocked by the browser. Select the one-time password and copy it manually.");
    }
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const isSelected = summaryFilter === card.key;

          return (
            <button
              key={card.key}
              type="button"
              onClick={() => selectSummaryFilter(card.key)}
              className={`rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition hover:border-ore-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ore-100 ${
                isSelected ? "border-ore-600 ring-2 ring-ore-100" : "border-coal-200"
              }`}
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-coal-500">{card.label}</span>
              <span className="mt-2 block text-3xl font-semibold text-coal-950">{card.value}</span>
            </button>
          );
        })}
      </div>

      <Panel
        title="User Management"
        subtitle="Create users, assign roles, reset passwords, and control account access."
        actions={isSuperAdmin ? (
          <Button type="button" variant="primary" icon={<UserPlus size={16} />} onClick={openCreateForm}>
            Add User
          </Button>
        ) : null}
      >
        <div className="mb-4 grid gap-2 md:grid-cols-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or mobile"
            className="h-10 rounded-md border border-coal-200 px-3 text-sm outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
          />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="h-10 rounded-md border border-coal-200 px-3 text-sm">
            <option value="All">All Roles</option>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-coal-200 px-3 text-sm">
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Must Change Password">Must Change Password</option>
          </select>
        </div>
        <DataTable columns={userColumns} rows={filteredUsers} getRowKey={(row) => row.userId} maxHeight="max-h-[560px]" />
      </Panel>

      <Panel title="Audit Logs" subtitle="Local audit trail for login, logout, password, and user actions.">
        <DataTable columns={auditColumns} rows={auditLogs.slice(0, 80)} getRowKey={(row) => row.id} maxHeight="max-h-[420px]" />
      </Panel>

      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-coal-950/50 p-4">
          <form onSubmit={submitCreateUser} className="w-full max-w-xl rounded-lg bg-white p-5 shadow-command">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-coal-950">Add user</h3>
                <p className="mt-1 text-sm text-coal-600">
                  A random one-time password will be generated. It expires after 24 hours and must be changed at first login.
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setShowCreateForm(false)}>Close</Button>
            </div>

            {createError && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {createError}
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold text-coal-500">Name</span>
                <input
                  value={createForm.name}
                  onChange={(event) => setCreateForm((form) => ({ ...form, name: event.target.value }))}
                  className="h-10 w-full rounded-md border border-coal-200 px-3 text-sm outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
                  autoFocus
                  required
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold text-coal-500">Mobile Number / User ID</span>
                <input
                  value={createForm.userId}
                  onChange={(event) => setCreateForm((form) => ({ ...form, userId: event.target.value }))}
                  className="h-10 w-full rounded-md border border-coal-200 px-3 text-sm outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
                  inputMode="text"
                  required
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold text-coal-500">Role</span>
                <select
                  value={createForm.role}
                  onChange={(event) => setCreateForm((form) => ({ ...form, role: event.target.value as UserRole }))}
                  className="h-10 w-full rounded-md border border-coal-200 px-3 text-sm outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
                >
                  {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold text-coal-500">Department</span>
                <input
                  value={createForm.department}
                  onChange={(event) => setCreateForm((form) => ({ ...form, department: event.target.value }))}
                  className="h-10 w-full rounded-md border border-coal-200 px-3 text-sm outline-none focus:border-ore-600 focus:ring-2 focus:ring-ore-100"
                  placeholder="Optional"
                />
              </label>
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-coal-700">
              <input
                checked={createForm.isActive}
                onChange={(event) => setCreateForm((form) => ({ ...form, isActive: event.target.checked }))}
                type="checkbox"
                className="h-4 w-4 rounded border-coal-300 text-ore-600"
              />
              Active user
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={creating}>
                {creating ? "Adding..." : "Add User"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-coal-950/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-command">
            <h3 className="text-lg font-semibold text-coal-950">Reset password</h3>
            <p className="mt-2 text-sm text-coal-600">
              Reset password for {resetTarget.name}? A new random one-time password will be generated and the existing sessions will be revoked.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button variant="danger" disabled={resetting} onClick={confirmReset}>{resetting ? "Resetting..." : "Reset Password"}</Button>
            </div>
          </div>
        </div>
      )}

      {temporaryCredential && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-coal-950/60 p-4">
          <div ref={credentialDialogRef} onKeyDown={trapCredentialDialogFocus} className="w-full max-w-lg rounded-lg bg-white p-5 shadow-command" role="dialog" aria-modal="true" aria-labelledby="temporary-password-title" aria-describedby="temporary-password-description">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ore-100 text-ore-700">
                <KeyRound size={20} />
              </div>
              <div>
                <h3 id="temporary-password-title" className="text-lg font-semibold text-coal-950">One-time login password</h3>
                <p id="temporary-password-description" className="mt-1 text-sm text-coal-600">
                  This password is displayed once for {temporaryCredential.name}. Close this window after copying it.
                </p>
              </div>
            </div>

            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="font-semibold text-coal-500">User ID</dt>
              <dd className="font-mono text-coal-950">{temporaryCredential.userId}</dd>
              <dt className="font-semibold text-coal-500">Expires</dt>
              <dd className="text-coal-950">{formatDateTime(temporaryCredential.expiresAt)}</dd>
            </dl>

            <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Temporary password</p>
              <code className="mt-2 block select-all break-all text-base font-semibold text-coal-950">
                {temporaryCredential.temporaryPassword}
              </code>
            </div>

            <p className="mt-3 text-xs text-coal-500">
              The user must change this password before any dashboard or operational API can be used.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setTemporaryCredential(null)}>Close</Button>
              <Button ref={copyCredentialButtonRef} type="button" variant="primary" icon={<Copy size={16} />} onClick={copyTemporaryPassword}>Copy password</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
