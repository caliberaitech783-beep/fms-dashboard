export type NotificationSeverity = "info" | "warning" | "critical" | "success";
export type NotificationChannel = "in-app" | "push" | "desktop" | "whatsapp";

export interface UserDevice {
  id: string;
  userId: string;
  deviceId: string;
  label: string;
  platform: string;
  appType: string;
  appVersion: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastSuccessfulDeliveryAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
}

export interface NotificationPreferences {
  userId: string;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  desktopEnabled: boolean;
  whatsappEnabled: boolean;
  assignmentNotifications: boolean;
  statusChangeNotifications: boolean;
  revertReminders: boolean;
  escalationNotifications: boolean;
  shiftNotifications: boolean;
  announcements: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  updatedAt: string | null;
}

export interface NotificationInboxItem {
  id: string;
  userId: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  deepLinkUrl: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, string | number | boolean | null>;
  readAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface WhatsAppConsent {
  userId: string;
  phoneNumber: string;
  maskedPhoneNumber: string;
  status: "not_configured" | "contact_registered" | "opted_in" | "opted_out";
  optedInAt: string | null;
  optedOutAt: string | null;
  updatedAt: string | null;
}

export interface AdminNotificationTargetPreview {
  targetCount: number;
  users: Array<{ userId: string; name: string; role: string }>;
}

export interface AdminNotificationSendResult {
  targetCount: number;
  results: Array<{ userId: string; notificationId: string; channel: string; status: string }>;
}

