import { Bell, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppUser } from "../../types/auth";
import { APP_VERSION } from "../../constants/appVersion";
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

  useEffect(() => {
    notificationService.getInbox(true)
      .then((items) => setUnreadCount(items.length))
      .catch(() => setUnreadCount(0));
  }, []);

  return (
    <div className="border-b border-coal-200 bg-white px-4 py-3 lg:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-coal-950">{user.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="info">{user.role}</Badge>
            <span className="text-xs text-coal-500">User ID: {user.userId}</span>
            <span className="text-xs text-coal-500">Version {APP_VERSION}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
