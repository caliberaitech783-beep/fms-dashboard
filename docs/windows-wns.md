# Windows Terminated-App Push (WNS)

Level 2 Windows push is separate from the implemented Level 1 tray/background path.

## Current Status

Blocked by external Microsoft/Azure registration. Repository code can store placeholders and document the backend shape, but terminated-app delivery must not be marked working until a real Windows App SDK push channel is registered and tested.

## Microsoft Setup Required

Microsoft's Windows App SDK push quickstart requires:

- Microsoft Entra app registration.
- Application client ID.
- Directory tenant ID.
- Object ID from the service principal / managed application entry.
- Client secret stored outside the app.
- Package Family Name mapping for packaged Win32 apps where required.

Microsoft's WNS overview also documents Package SID / secret flows for Store-associated WNS scenarios. Use one consistent identity path; do not mix a manually created app registration with a Store/Partner Center identity.

References:

- https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/push-quickstart
- https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview

## Backend-Only Settings

- `WNS_AZURE_CLIENT_ID`
- `WNS_AZURE_TENANT_ID`
- `WNS_AZURE_OBJECT_ID`
- `WNS_AZURE_CLIENT_SECRET`
- `WNS_PACKAGE_FAMILY_NAME`
- `WNS_CHANNEL_TABLE_NAME`

`WNS_AZURE_CLIENT_SECRET` must be stored only in Azure App Settings or a secret store. It must not be shipped in Hostinger static files, Tauri frontend code, service worker, installer, screenshots, logs, or Git commits.

## Acceptance Before Enabling

1. Register a real Windows App SDK push channel from an installed packaged app.
2. Store the channel URI against the authenticated user's device.
3. Send one server-side WNS test to that exact device.
4. Confirm app activation/deep link behavior when closed.
5. Confirm logs mask channel URIs and never print secrets.
