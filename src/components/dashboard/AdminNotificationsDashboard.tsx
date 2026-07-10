import { Megaphone, Search, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { notificationService } from "../../services/notificationService";
import type { NotificationChannel } from "../../types/notifications";
import type { UserRole } from "../../types/auth";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";

const roles: UserRole[] = ["Super Admin", "Management", "Site Manager", "Fleet Manager", "Fuel Manager", "MIS User", "Viewer"];
const channels: NotificationChannel[] = ["in-app", "push", "whatsapp"];

export function AdminNotificationsDashboard() {
  const { users, currentUser } = useAuth();
  const [title, setTitle] = useState("System announcement");
  const [body, setBody] = useState("Please check the FMS portal for the latest update.");
  const [selectedRole, setSelectedRole] = useState<UserRole | "">("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<NotificationChannel[]>(["in-app"]);
  const [confirmLargeSend, setConfirmLargeSend] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetCount, setTargetCount] = useState<number | null>(null);

  const activeUsers = useMemo(() => users.filter((user) => user.isActive), [users]);
  const criteria = useMemo(() => ({
    ...(selectedUserId ? { userIds: [selectedUserId] } : {}),
    ...(selectedRole ? { roles: [selectedRole] } : {}),
    ...(!selectedUserId && !selectedRole ? { allUsers: true } : {}),
  }), [selectedRole, selectedUserId]);

  if (currentUser?.role !== "Super Admin") {
    return (
      <Panel title="Admin Notifications">
        <p className="text-sm text-coal-600">Only Super Admin users can manage admin notifications.</p>
      </Panel>
    );
  }

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(success);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Action failed.");
    }
  };

  return (
    <div className="space-y-4">
      {(message || error) && (
        <div className={`rounded-md border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
          {error || message}
        </div>
      )}
      <Panel
        title="Admin Notification Console"
        subtitle="Target users server-side by user, role, or all active users. Large broadcasts require explicit confirmation."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Search className="h-4 w-4" />}
              onClick={() => runAction(async () => {
                const preview = await notificationService.previewTargets(criteria);
                setTargetCount(preview.targetCount);
              }, "Target preview calculated.")}
            >
              Preview
            </Button>
            <Button
              icon={<Send className="h-4 w-4" />}
              variant="primary"
              onClick={() => runAction(async () => {
                const result = await notificationService.sendAdminNotification({
                  title,
                  body,
                  severity: "info",
                  channels: selectedChannels,
                  criteria,
                  confirmLargeSend,
                });
                setTargetCount(result.targetCount);
              }, "Notification queued.")}
            >
              Send
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-coal-700">
              Title
              <input className="mt-1 h-10 w-full rounded-md border border-coal-300 px-3" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="block text-sm font-medium text-coal-700">
              Body
              <textarea className="mt-1 min-h-28 w-full rounded-md border border-coal-300 px-3 py-2" value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm font-medium text-coal-700">
                Target user
                <select className="mt-1 h-10 w-full rounded-md border border-coal-300 px-3" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                  <option value="">All matching users</option>
                  {activeUsers.map((user) => (
                    <option key={user.userId} value={user.userId}>{user.name} ({user.userId})</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-coal-700">
                Target role
                <select className="mt-1 h-10 w-full rounded-md border border-coal-300 px-3" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as UserRole | "")}>
                  <option value="">Any role</option>
                  {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="space-y-4 rounded-md border border-coal-200 p-4">
            <div>
              <p className="text-sm font-semibold text-coal-900">Channels</p>
              <div className="mt-2 space-y-2">
                {channels.map((channel) => (
                  <label key={channel} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedChannels.includes(channel)}
                      onChange={(event) => setSelectedChannels((current) => event.target.checked ? [...current, channel] : current.filter((item) => item !== channel))}
                    />
                    {channel}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmLargeSend} onChange={(event) => setConfirmLargeSend(event.target.checked)} />
              <span>Confirm large broadcast if target is all active users</span>
            </label>
            <div className="rounded-md bg-coal-50 p-3 text-sm text-coal-600">
              <Megaphone className="mb-2 h-4 w-4 text-ore-600" />
              Estimated targets: <span className="font-semibold text-coal-900">{targetCount ?? "not previewed"}</span>
            </div>
            <p className="text-xs text-coal-500">Push and WhatsApp channels are recorded as blocked until VAPID and WhatsApp secrets are configured in Azure.</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

