# Notifications

## Implemented

- Authenticated device registration
- Device revocation
- Canonical `/api/devices`, `/api/push`, `/api/notifications`, and `/api/notification-preferences` endpoints
- Notification preferences
- In-app inbox
- Mark one/all as read
- Test notification to current user
- Super Admin target preview
- Super Admin notification send for in-app, push, and WhatsApp channels
- Admin delivery history and manual retry requests
- Web Push provider send path with VAPID, TTL, idempotency, and invalid subscription cleanup
- Tauri Level 1 native notification polling while the desktop app is running or in tray

## Blocked By External Setup

- Real Web Push provider sends need VAPID keys in Azure and `VITE_VAPID_PUBLIC_KEY` in the frontend.
- High-volume retry workers should use Azure Storage Queue or Service Bus before production broadcasts.
- Windows terminated-app push needs Windows App SDK / WNS registration before it can be claimed as working.

## Targeting

Targets are resolved server-side from authenticated users and criteria. Clients cannot directly choose final device IDs as authority.

## Canonical Endpoints

- `POST /api/devices/register`
- `GET /api/devices`
- `DELETE /api/devices/:deviceId`
- `POST /api/push/subscribe`
- `DELETE /api/push/unsubscribe`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET /api/notification-preferences`
- `PUT /api/notification-preferences`
- `POST /api/admin/notifications/preview-targets`
- `POST /api/admin/notifications/send`
- `POST /api/admin/notifications/schedule`
- `DELETE /api/admin/notifications/:id/schedule`
- `GET /api/admin/notification-deliveries`
- `POST /api/admin/notification-deliveries/:id/retry`
