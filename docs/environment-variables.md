# Environment Variables

Use placeholders in source control only. Real values belong in local `.env`, Azure Function App settings, GitHub Secrets, Hostinger configuration, or provider dashboards as noted below.

## Frontend / Hostinger

- `VITE_PUBLIC_SITE_URL`: public web URL, currently `https://fms.cmll.in`
- `VITE_AUTH_API_BASE_URL`: Azure API base URL, currently `https://cmll-fms-api.azurewebsites.net/api`
- `VITE_VAPID_PUBLIC_KEY`: public Web Push key safe for browser delivery

Hostinger must not receive provider private keys, tracking passwords, WhatsApp tokens, Azure credentials, or signing keys.

## Azure Function App Settings

- `AUTH_TOKEN_SECRET`: backend JWT signing secret
- `ALLOWED_ORIGINS`: comma-separated allowed web origins
- `AzureWebJobsStorage`: Azure Storage connection for users, audit logs, and notifications
- `USERS_TABLE_NAME`
- `AUDIT_TABLE_NAME`
- `PASSWORD_HISTORY_TABLE_NAME`
- `TRACKING_API_BASE_URL`
- `TRACKING_API_USERNAME`
- `TRACKING_API_PASSWORD`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `NOTIFICATION_DEVICES_TABLE_NAME`
- `NOTIFICATION_PREFERENCES_TABLE_NAME`
- `NOTIFICATION_INBOX_TABLE_NAME`
- `NOTIFICATION_DELIVERIES_TABLE_NAME`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_GRAPH_API_VERSION`

## GitHub Secrets

Use GitHub Secrets for deployment automation and signed release builds:

- Azure publish profile or federated Azure credentials
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_APP_SECRET`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_SIGNING_IDENTITY`

Never print these values in workflow logs.

## External Dashboards

- Meta Developer Dashboard: WhatsApp app secret, webhook verify token, callback URL, phone number ID, business account ID, templates
- Apple Developer: signing identity, certificate, team ID, notarization credentials
- Windows signing provider or Microsoft Partner Center: code-signing certificate and identity

