import { useMemo, useState } from "react";
import type { AppUser, AuditLog, UserRole } from "../../types/auth";
import { useAuth } from "../../auth/AuthContext";
import { formatDateTime } from "../../utils/formatters";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

const roles: UserRole[] = ["Super Admin", "Management", "Site Manager", "Fleet Manager", "Fuel Manager", "MIS User", "Viewer"];

export function UserManagementDashboard() {
  const { currentUser, users, auditLogs, resetPassword, updateUserActive, updateUserRole } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isSuperAdmin = currentUser?.role === "Super Admin";

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      if (query && !`${user.name} ${user.mobile} ${user.userId}`.toLowerCase().includes(query)) return false;
      if (roleFilter !== "All" && user.role !== roleFilter) return false;
      if (statusFilter === "Active" && !user.isActive) return false;
      if (statusFilter === "Inactive" && user.isActive) return false;
      if (statusFilter === "Must Change Password" && !user.mustChangePassword) return false;
      return true;
    });
  }, [roleFilter, search, statusFilter, users]);

  const userColumns: DataTableColumn<AppUser>[] = [
    { header: "Name", render: (row) => <span className="font-semibold text-coal-900">{row.name}</span>, className: "min-w-56" },
    { header: "Mobile / User ID", render: (row) => row.userId },
    { header: "Role", render: (row) => <Badge tone={row.role === "Super Admin" ? "good" : "info"}>{row.role}</Badge> },
    { header: "Status", render: (row) => <StatusBadge status={row.isActive ? "active" : "inactive"} /> },
    { header: "Password", render: (row) => <StatusBadge status={row.mustChangePassword ? "pending" : "ready"} /> },
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
    setMessage("Password reset successfully. User must login with mobile number and change password immediately.");
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <Panel title="User Management" subtitle="Seeded mining portal users and role-based access.">
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
