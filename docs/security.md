# Security Notes

## Secrets

- No credentials are hard-coded in source.
- `.env.example` and `api/local.settings.json.example` contain placeholders only.
- Tracking API, WhatsApp, VAPID private key, Azure credentials, and signing certificates must stay outside Git.
- Desktop bundles must never include backend provider secrets.

## Authentication And Authorization

- Notification APIs use the existing bearer token auth model.
- Super Admin endpoints enforce server-side role checks.
- Notification targets are resolved on the server from authenticated users and criteria.
- Clients cannot supply final target device IDs as authority.

## Notifications

- In-app notifications contain brief, non-sensitive summaries.
- Push payloads should contain IDs, severity, brief body, and deep links only.
- WhatsApp sends require an authenticated user mapping plus explicit opt-in consent.
- Large admin broadcasts require explicit confirmation.

## PWA Cache Rules

- The service worker does not cache `/api/*`, auth responses, requests with `Authorization`, or non-GET requests.
- Versioned static assets and the offline page may be cached.
- Logout should continue to clear local auth/session artifacts.
- Logout revokes the current registered push device before clearing the bearer token so a shared browser cannot keep another user's subscription.

## Desktop Shell

- Tauri is selected over Electron for a smaller, least-privilege shell.
- Current Tauri capabilities grant only `core:default`.
- Current Tauri capabilities additionally grant notification and autostart commands required by the desktop app.
- Filesystem and shell permissions are not enabled.
- Signed updates are configured as a release requirement but blocked until signing keys exist.

## Webhooks

- WhatsApp webhook GET uses `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
- WhatsApp webhook POST validates `x-hub-signature-256` with `WHATSAPP_APP_SECRET`.
- Invalid signatures are rejected.
