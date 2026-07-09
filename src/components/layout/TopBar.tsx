import { LogOut } from "lucide-react";
import type { AppUser } from "../../types/auth";
import { APP_VERSION } from "../../constants/appVersion";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface TopBarProps {
  user: AppUser;
  onLogout: () => void;
}

export function TopBar({ user, onLogout }: TopBarProps) {
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
        <Button icon={<LogOut className="h-4 w-4" />} onClick={onLogout}>
          Logout
        </Button>
      </div>
    </div>
  );
}
