import { APP_VERSION } from "../constants/appVersion";
import { getAuthSession } from "../auth/sessionService";
import type {
  AdminNotificationSendResult,
  AdminNotificationTargetPreview,
  NotificationChannel,
  NotificationDelivery,
  NotificationInboxItem,
  NotificationPreferences,
  UserDevice,
  WhatsAppConsent,
} from "../types/notifications";

const DEFAULT_AUTH_API_BASE_URL = "https://cmll-fms-api-b3-783.azurewebsites.net/api";
const AUTH_API_BASE_URL = (import.meta.env.VITE_AUTH_API_BASE_URL ?? DEFAULT_AUTH_API_BASE_URL).replace(/\/$/, "");
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";
const DEVICE_ID_KEY = "mining.notifications.deviceId.v1";

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID?.() ?? `device-${Date.now()}`;
  localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function devicePlatform() {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/macintosh|mac os/i.test(ua)) return "macos";
  if (/windows/i.test(ua)) return "windows";
  return "web";
}

function detectAppType() {
  if ((window as TauriWindow).__TAURI_INTERNALS__) return "tauri-desktop";
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "pwa" : "browser";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthSession()?.token;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${AUTH_API_BASE_URL}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null) as { message?: string } | T | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload ? payload.message : null;
    throw new Error(message || "Request failed.");
  }
  return payload as T;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function createPushSubscription() {
  if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing.toJSON();

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  return subscription.toJSON();
}

async function getCurrentPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  return registration ? registration.pushManager.getSubscription() : null;
}

export const notificationService = {
  getInbox(unreadOnly = false) {
    return request<NotificationInboxItem[]>(`/notifications${unreadOnly ? "?unreadOnly=true" : ""}`);
  },
  markRead(notificationId: string) {
    return request<NotificationInboxItem>(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "POST" });
  },
  markAllRead() {
    return request<{ updated: number }>("/notifications/read-all", { method: "POST" });
  },
  getDevices() {
    return request<UserDevice[]>("/devices");
  },
  async registerCurrentDevice({ push = false }: { push?: boolean } = {}) {
    let pushSubscription = null;
    if (push) {
      if (!("Notification" in window)) {
        throw new Error("This browser does not support notifications.");
      }
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }
      pushSubscription = await createPushSubscription();
      if (!pushSubscription && !VAPID_PUBLIC_KEY) {
        throw new Error("VAPID public key is not configured for browser push yet.");
      }
    }

    return request<UserDevice>(push ? "/push/subscribe" : "/devices/register", {
      method: "POST",
      body: JSON.stringify({
        deviceId: getDeviceId(),
        label: `${devicePlatform()} ${detectAppType()}`,
        platform: devicePlatform(),
        appType: detectAppType(),
        appVersion: APP_VERSION,
        pushSubscription,
        subscription: pushSubscription,
      }),
    });
  },
  revokeDevice(deviceId: string) {
    return request<UserDevice>(`/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
  },
  async revokeCurrentDevice() {
    const deviceId = localStorage.getItem(DEVICE_ID_KEY);
    const subscription = await getCurrentPushSubscription().catch(() => null);
    const endpoint = subscription?.endpoint || "";

    if (!deviceId && !endpoint) {
      return { revoked: 0 };
    }

    try {
      return await request<{ revoked?: number } | UserDevice>("/push/unsubscribe", {
        method: "DELETE",
        body: JSON.stringify({ deviceId, endpoint }),
      });
    } finally {
      await subscription?.unsubscribe().catch(() => false);
      localStorage.removeItem(DEVICE_ID_KEY);
    }
  },
  getPreferences() {
    return request<NotificationPreferences>("/notification-preferences");
  },
  updatePreferences(input: Partial<NotificationPreferences>) {
    return request<NotificationPreferences>("/notification-preferences", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  sendTestNotification() {
    return request<AdminNotificationSendResult>("/notifications/test", { method: "POST" });
  },
  getWhatsAppContact() {
    return request<WhatsAppConsent>("/notifications/whatsapp/contact");
  },
  saveWhatsAppContact(phoneNumber: string) {
    return request<WhatsAppConsent>("/notifications/whatsapp/contact", {
      method: "POST",
      body: JSON.stringify({ phoneNumber }),
    });
  },
  optInWhatsApp() {
    return request<WhatsAppConsent>("/notifications/whatsapp/consent", { method: "POST" });
  },
  optOutWhatsApp() {
    return request<WhatsAppConsent>("/notifications/whatsapp/consent", { method: "DELETE" });
  },
  previewTargets(criteria: Record<string, unknown>) {
    return request<AdminNotificationTargetPreview>("/admin/notifications/preview-targets", {
      method: "POST",
      body: JSON.stringify({ criteria }),
    });
  },
  sendAdminNotification(input: {
    title: string;
    body: string;
    severity: string;
    channels: NotificationChannel[];
    criteria: Record<string, unknown>;
    confirmLargeSend?: boolean;
  }) {
    return request<AdminNotificationSendResult>("/admin/notifications/send", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  getAdminNotificationDeliveries() {
    return request<NotificationDelivery[]>("/admin/notification-deliveries");
  },
  retryAdminNotificationDelivery(deliveryId: string) {
    return request<{ idempotencyKey: string; status: string; retried: boolean }>(`/admin/notification-deliveries/${encodeURIComponent(deliveryId)}/retry`, { method: "POST" });
  },
};
