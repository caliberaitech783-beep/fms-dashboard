import { Bell, LogOut, UserCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppUser } from "../../types/auth";
import { activateWaitingServiceWorker } from "../../pwa/registerServiceWorker";
import { showNativeNotification } from "../../services/nativeNotificationService";
import { notificationService } from "../../services/notificationService";
import { Button } from "../ui/Button";

interface TopBarProps {
  user: AppUser;
  compact?: boolean;
  onLogout: () => void;
  onOpenNotifications?: () => void;
}

export function TopBar({ user, onLogout, onOpenNotifications, compact = false }: TopBarProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const userButtonRef = useRef<HTMLButtonElement | null>(null);
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

  useEffect(() => {
    if (!detailsOpen) return;
    const outside = (event: PointerEvent) => { if (!detailsRef.current?.contains(event.target as Node)) setDetailsOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setDetailsOpen(false); userButtonRef.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [detailsOpen]);

  return (
    <div className={compact ? "ml-auto shrink-0" : "relative z-40 border-b border-coal-200 bg-white px-4 py-3"}>
      <div className="flex items-center justify-end gap-2">
        <div ref={detailsRef} className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDetailsOpen(false); }}>
          <button ref={userButtonRef} type="button" aria-label="User details" aria-expanded={detailsOpen} aria-controls="user-details-panel" onClick={() => setDetailsOpen(!detailsOpen)} className="flex items-center gap-2 rounded-lg px-2 py-2 text-right hover:bg-coal-50">
            <span className="min-w-0"><span className="block max-w-32 truncate text-xs font-semibold text-coal-950 xl:max-w-44">{user.name}</span><span className="block text-[11px] text-coal-500">{user.role}</span></span>
            <UserCircle aria-hidden="true" className="h-7 w-7 text-ore-600" />
          </button>
          {detailsOpen && (
            <div id="user-details-panel" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-coal-200 bg-white p-5 text-left shadow-xl">
              <p className="mb-4 text-sm font-semibold text-coal-950">User details</p>
              <dl className="space-y-3 text-sm">
                <div><dt className="text-xs text-coal-500">Name</dt><dd className="mt-1 break-words text-coal-900">{user.name}</dd></div>
                <div><dt className="text-xs text-coal-500">Role</dt><dd className="mt-1 text-coal-900">{user.role}</dd></div>
                <div><dt className="text-xs text-coal-500">User ID</dt><dd className="mt-1 break-words text-coal-900">{user.userId}</dd></div>
              </dl>
              <button type="button" onClick={() => { setDetailsOpen(false); userButtonRef.current?.focus(); }} className="mt-4 text-xs font-semibold text-ore-700">Close</button>
            </div>
          )}
        </div>
        {updateReady && <Button variant="primary" onClick={() => activateWaitingServiceWorker()}>Update now</Button>}
        {onOpenNotifications && <button type="button" aria-label={"Notifications" + (unreadCount ? " (" + unreadCount + ")" : "")} title="Notifications" onClick={onOpenNotifications} className="relative rounded-lg p-2 text-coal-600 hover:bg-coal-50"><Bell className="h-5 w-5" />{unreadCount > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-ore-600 px-1 text-[10px] text-white">{unreadCount}</span>}</button>}
        <button type="button" aria-label="Logout" title="Logout" onClick={onLogout} className="rounded-lg p-2 text-coal-600 hover:bg-coal-50"><LogOut className="h-5 w-5" /></button>
      </div>
    </div>
  );
}
