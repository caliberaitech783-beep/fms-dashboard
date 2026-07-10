# Notifications

## Implemented

- Authenticated device registration
- Device revocation
- Notification preferences
- In-app inbox
- Mark one/all as read
- Test notification to current user
- Super Admin target preview
- Super Admin notification send for in-app notifications
- Delivery records for blocked push/WhatsApp channels when provider secrets are missing

## Blocked By External Setup

- Real Web Push provider sends need VAPID keys in Azure and `VITE_VAPID_PUBLIC_KEY` in the frontend.
- High-volume retry workers should use Azure Storage Queue or Service Bus before production broadcasts.
- Desktop native notification transport needs Tauri plugins/signing and platform verification.

## Targeting

Targets are resolved server-side from authenticated users and criteria. Clients cannot directly choose final device IDs as authority.

