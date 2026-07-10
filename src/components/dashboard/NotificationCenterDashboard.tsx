import { Bell, CheckCheck, Download, MessageCircle, MonitorSmartphone, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { activateWaitingServiceWorker } from "../../pwa/registerServiceWorker";
import { getInstallPrompt, isStandaloneDisplay, subscribeInstallPrompt } from "../../pwa/installPrompt";
import { notificationService } from "../../services/notificationService";
import type { NotificationInboxItem, NotificationPreferences, UserDevice, WhatsAppConsent } from "../../types/notifications";
import { formatDateTime } from "../../utils/formatters";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { StatusBadge } from "../ui/StatusBadge";

const defaultPreferences: NotificationPreferences = {
  userId: "",
  inAppEnabled: true,
  pushEnabled: false,
  desktopEnabled: false,
  whatsappEnabled: false,
  assignmentNotifications: true,
  statusChangeNotifications: true,
  revertReminders: true,
  escalationNotifications: true,
  shiftNotifications: true,
  announcements: true,
  quietHoursStart: "22:00",
  quietHoursEnd: "06:00",
  timezone: "Asia/Kolkata",
  updatedAt: null,
};

export function NotificationCenterDashboard() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inbox, setInbox] = useState<NotificationInboxItem[]>([]);
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences);
  const [whatsApp, setWhatsApp] = useState<WhatsAppConsent | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [installAvailable, setInstallAvailable] = useState(Boolean(getInstallPrompt()));
  const [updateReady, setUpdateReady] = useState(false);

  const unreadCount = useMemo(() => inbox.filter((item) => !item.readAt).length, [inbox]);

  const refresh = async () => {
    setError(null);
    const [nextInbox, nextDevices, nextPreferences, nextWhatsApp] = await Promise.all([
      notificationService.getInbox(),
      notificationService.getDevices(),
      notificationService.getPreferences(),
      notificationService.getWhatsAppContact(),
    ]);
    setInbox(nextInbox);
    setDevices(nextDevices);
    setPreferences(nextPreferences);
    setWhatsApp(nextWhatsApp);
    setPhoneNumber(nextWhatsApp.phoneNumber || "");
  };

  useEffect(() => {
    refresh()
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Unable to load notifications."))
      .finally(() => setLoading(false));

    const unsubscribe = subscribeInstallPrompt(() => setInstallAvailable(Boolean(getInstallPrompt())));
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener("cmll:fms-update-ready", onUpdate);
    return () => {
      unsubscribe();
      window.removeEventListener("cmll:fms-update-ready", onUpdate);
    };
  }, []);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setMessage(null);
    setError(null);
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Action failed.");
    }
  };

  const notificationColumns: DataTableColumn<NotificationInboxItem>[] = [
    {
      header: "State",
      render: (row) => <StatusBadge status={row.readAt ? "read" : "new"} />,
    },
    {
      header: "Notification",
      className: "min-w-80",
      render: (row) => (
        <div>
          <p className="font-semibold text-coal-900">{row.title}</p>
          <p className="mt-1 text-xs text-coal-500">{row.body}</p>
        </div>
      ),
    },
    { header: "Severity", render: (row) => <Badge tone={row.severity === "critical" ? "danger" : row.severity === "warning" ? "warning" : "info"}>{row.severity}</Badge> },
    { header: "Created", render: (row) => formatDateTime(row.createdAt), className: "min-w-44" },
    {
      header: "Action",
      render: (row) => (
        <Button size="sm" onClick={() => runAction(() => notificationService.markRead(row.id), "Notification marked as read.")}>
          Mark read
        </Button>
      ),
    },
  ];

  const deviceColumns: DataTableColumn<UserDevice>[] = [
    { header: "Device", render: (row) => row.label, className: "min-w-44" },
    { header: "Platform", render: (row) => row.platform },
    { header: "Type", render: (row) => row.appType },
    { header: "Last seen", render: (row) => row.lastSeenAt ? formatDateTime(row.lastSeenAt) : "-" },
    { header: "Status", render: (row) => <StatusBadge status={row.isActive ? "active" : "revoked"} /> },
    {
      header: "Revoke",
      render: (row) => (
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          disabled={!row.isActive}
          onClick={() => runAction(() => notificationService.revokeDevice(row.deviceId), "Device revoked.")}
        >
          Revoke
        </Button>
      ),
    },
  ];

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {(message || error) && (
        <div className={`rounded-md border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
          {error || message}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-4">
        <Panel title="Unread">
          <p className="text-3xl font-semibold text-coal-950">{unreadCount}</p>
          <p className="mt-1 text-xs text-coal-500">In-app notifications waiting</p>
        </Panel>
        <Panel title="Registered Devices">
          <p className="text-3xl font-semibold text-coal-950">{devices.filter((device) => device.isActive).length}</p>
          <p className="mt-1 text-xs text-coal-500">Active browser/PWA devices</p>
        </Panel>
        <Panel title="PWA Install">
          <p className="text-sm font-semibold text-coal-900">{isStandaloneDisplay() ? "Installed" : installAvailable ? "Available" : "Use browser menu"}</p>
          <p className="mt-1 text-xs text-coal-500">Android, iOS Home Screen, and desktop browser install support</p>
        </Panel>
        <Panel title="WhatsApp Consent">
          <p className="text-sm font-semibold text-coal-900">{whatsApp?.status.replace(/_/g, " ") || "not configured"}</p>
          <p className="mt-1 text-xs text-coal-500">{whatsApp?.maskedPhoneNumber || "No opted-in number"}</p>
        </Panel>
      </div>

      <Panel
        title="Notification Centre"
        subtitle="In-app notifications work even if browser or operating-system push permission is denied."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => runAction(refresh, "Notifications refreshed.")}>Refresh</Button>
            <Button icon={<CheckCheck className="h-4 w-4" />} onClick={() => runAction(() => notificationService.markAllRead(), "All notifications marked as read.")}>Mark all read</Button>
            <Button icon={<Bell className="h-4 w-4" />} variant="primary" onClick={() => runAction(() => notificationService.sendTestNotification(), "Test notification created.")}>Test</Button>
          </div>
        }
      >
        <DataTable columns={notificationColumns} rows={inbox} getRowKey={(row) => row.id} />
      </Panel>

      <Panel
        title="Devices And Push"
        subtitle="Device registration is tied to your authenticated user. Push permission is requested only after clicking Enable push."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<MonitorSmartphone className="h-4 w-4" />} onClick={() => runAction(() => notificationService.registerCurrentDevice(), "Current device registered.")}>Register device</Button>
            <Button icon={<Bell className="h-4 w-4" />} variant="primary" onClick={() => runAction(() => notificationService.registerCurrentDevice({ push: true }), "Push device registered.")}>Enable push</Button>
          </div>
        }
      >
        <DataTable columns={deviceColumns} rows={devices} getRowKey={(row) => row.deviceId} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Notification Preferences" subtitle={`Timezone: ${preferences.timezone}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["inAppEnabled", "In-app notifications"],
              ["pushEnabled", "Browser/PWA push"],
              ["desktopEnabled", "Desktop native notifications"],
              ["whatsappEnabled", "WhatsApp notifications"],
              ["assignmentNotifications", "Assignment notifications"],
              ["statusChangeNotifications", "Status changes"],
              ["revertReminders", "Revert reminders"],
              ["escalationNotifications", "Escalations"],
              ["shiftNotifications", "Shift reminders"],
              ["announcements", "Announcements"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-md border border-coal-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(preferences[key as keyof NotificationPreferences])}
                  onChange={(event) => setPreferences((current) => ({ ...current, [key]: event.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-coal-700">
              Quiet hours start
              <input className="mt-1 h-10 w-full rounded-md border border-coal-300 px-3" type="time" value={preferences.quietHoursStart} onChange={(event) => setPreferences((current) => ({ ...current, quietHoursStart: event.target.value }))} />
            </label>
            <label className="text-sm font-medium text-coal-700">
              Quiet hours end
              <input className="mt-1 h-10 w-full rounded-md border border-coal-300 px-3" type="time" value={preferences.quietHoursEnd} onChange={(event) => setPreferences((current) => ({ ...current, quietHoursEnd: event.target.value }))} />
            </label>
          </div>
          <div className="mt-4">
            <Button variant="primary" onClick={() => runAction(() => notificationService.updatePreferences(preferences), "Preferences saved.")}>Save preferences</Button>
          </div>
        </Panel>

        <Panel title="Install And WhatsApp" subtitle="WhatsApp is disabled until a number is mapped to your user and consent is recorded.">
          <div className="space-y-4">
            {installAvailable && !isStandaloneDisplay() && (
              <Button
                icon={<Download className="h-4 w-4" />}
                variant="primary"
                onClick={() => {
                  const prompt = getInstallPrompt();
                  prompt?.prompt();
                }}
              >
                Install app
              </Button>
            )}
            {updateReady && (
              <Button onClick={() => activateWaitingServiceWorker()}>Load new version</Button>
            )}
            <div className="rounded-md border border-coal-200 p-3 text-sm text-coal-600">
              Android and desktop browsers may show an install prompt. On iPhone/iPad, use Share then Add to Home Screen, then open the installed app before enabling push.
            </div>
            <label className="block text-sm font-medium text-coal-700">
              WhatsApp phone number
              <input className="mt-1 h-10 w-full rounded-md border border-coal-300 px-3" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+91..." />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button icon={<MessageCircle className="h-4 w-4" />} onClick={() => runAction(() => notificationService.saveWhatsAppContact(phoneNumber), "WhatsApp contact saved.")}>Save contact</Button>
              <Button variant="primary" onClick={() => runAction(() => notificationService.optInWhatsApp(), "WhatsApp consent recorded.")}>Opt in</Button>
              <Button variant="danger" onClick={() => runAction(() => notificationService.optOutWhatsApp(), "WhatsApp consent withdrawn.")}>Opt out</Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

