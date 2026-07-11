import type { NotificationInboxItem } from "../types/notifications";

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

export function isTauriRuntime() {
  return Boolean((window as TauriWindow).__TAURI_INTERNALS__);
}

export async function showNativeNotification(notification: Pick<NotificationInboxItem, "title" | "body">) {
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
    const allowed = await isPermissionGranted() || await requestPermission() === "granted";
    if (!allowed) {
      return false;
    }

    sendNotification({
      title: notification.title || "CMLL FMS",
      body: notification.body || "You have a new notification.",
    });
    return true;
  } catch {
    return false;
  }
}
