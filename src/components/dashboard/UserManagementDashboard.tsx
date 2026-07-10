import { useMemo, useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
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
  const [message, setMessage] = useState<string | null>(null);
  const isSuperAdmin = currentUser?.role === "Super Admin";
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
    { header: "Login", render: (row) => <StatusBadge status={row.lockedUntil ? "locked" : "ready"} /> },
    { header: "Last Login", render: (row) => formatDateTime(row.lastLoginAt) },
    {
      header: "Role Edit",
      render: (row) => isSuperAdmin ? (
        <select
          value={row.role}
          onChange={(event) => updateUserRole(row.userId, event.target.value as UserRole)}
          className="h-9 rounded-md border border-coal-200 bg-white px-2 text-sm"
        >
          {roles.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
      ) : "-",
    },
    {
      header: "Actions",
      render: (row) => isSuperAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setResetTarget(row)}>Reset</Button>
          <Button size="sm" variant={row.isActive ? "danger" : "secondary"} onClick={() => updateUserActive(row.userId, !row.isActive)}>
            {row.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ) : "-",
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
    if (!resetTarget) return;
    await resetPassword(resetTarget.userId);
    setResetTarget(null);
    setMessage("Password reset successfully. User must login with mobile number / user ID and change password immediately.");
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
      await createUser(createForm);
      setMessage(`User ${createForm.name.trim()} added. Initial password is the mobile number / user ID, and password change is required on first login.`);
      setCreateForm(initialCreateForm);
      setShowCreateForm(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not add user.");
    } finally {
      setCreating(false);
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
                  Initial password will be the mobile number / user ID. The user must change it on first login.
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
              Reset password for {resetTarget.name}? The password will be set back to the mobile number and the user must change it at next login.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={confirmReset}>Reset Password</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
