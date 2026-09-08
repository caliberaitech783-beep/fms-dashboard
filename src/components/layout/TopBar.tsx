import { Bell, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppUser } from "../../types/auth";
import { APP_VERSION } from "../../constants/appVersion";
import { activateWaitingServiceWorker } from "../../pwa/registerServiceWorker";
import { showNativeNotification } from "../../services/nativeNotificationService";
import { notificationService } from "../../services/notificationService";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface TopBarProps {
  user: AppUser;
  onLogout: () => void;
  onOpenNotifications?: () => void;
}

export function TopBar({ user, onLogout, onOpenNotifications }: TopBarProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    let active = true;
    let initialized = false;
    const seenKey = `mining.notifications.native.seen.${user.userId}`;

    const readSeen = () => {
      try {
        return new Set<string>(JSON.parse(sessionStorage.getItem(seenKey) || "[]") as string[]);
      } catch {
        return new Set<string>();
      }
    };

    const writeSeen = (seen: Set<string>) => {
      sessionStorage.setItem(seenKey, JSON.stringify([...seen].slice(-250)));
    };

    const pollNotifications = async () => {
      try {
        const [items, preferences] = await Promise.all([
          notificationService.getInbox(true),
          notificationService.getPreferences().catch(() => null),
        ]);
        if (!active) return;
        setUnreadCount(items.length);

        const seen = readSeen();
        const unseen = items.filter((item) => !seen.has(item.id));
        if (initialized && preferences?.desktopEnabled) {
          for (const item of unseen.slice(0, 3)) {
            await showNativeNotification(item);
          }
        }
        items.forEach((item) => seen.add(item.id));
        writeSeen(seen);
        initialized = true;
      } catch {
        if (active) setUnreadCount(0);
      }
    };

    pollNotifications();
    const intervalId = window.setInterval(pollNotifications, 60_000);
    window.addEventListener("online", pollNotifications);
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener("cmll:fms-update-ready", onUpdate);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("online", pollNotifications);
      window.removeEventListener("cmll:fms-update-ready", onUpdate);
    };
  }, [user.userId]);

  return (
    <div className="border-b border-coal-200 bg-white px-4 py-3 lg:px-6">
      <div className="flex flex-col items-end gap-3 md:flex-row md:items-center md:justify-end">
        <div className="text-right">
          <p className="text-sm font-semibold text-coal-950">{user.name}</p>
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
            <Badge tone="info">{user.role}</Badge>
            <span className="text-xs text-coal-500">User ID: {user.userId}</span>
            <span className="text-xs text-coal-500">Version {APP_VERSION}</span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {updateReady && (
            <Button variant="primary" onClick={() => activateWaitingServiceWorker()}>
              New version available — Update now
            </Button>
          )}
          {onOpenNotifications && (
            <Button icon={<Bell className="h-4 w-4" />} onClick={onOpenNotifications}>
              Notifications{unreadCount > 0 ? ` (${unreadCount})` : ""}
            </Button>
          )}
          <Button icon={<LogOut className="h-4 w-4" />} onClick={onLogout}>
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}
