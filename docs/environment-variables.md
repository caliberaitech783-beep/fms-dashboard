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
- `WNS_AZURE_CLIENT_ID`
- `WNS_AZURE_TENANT_ID`
- `WNS_AZURE_OBJECT_ID`
- `WNS_AZURE_CLIENT_SECRET`
- `WNS_PACKAGE_FAMILY_NAME`
- `WNS_CHANNEL_TABLE_NAME`
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
- `VOLVO_TOKEN_URL`
- `VOLVO_CLIENT_ID`
- `VOLVO_CLIENT_SECRET`
- `VOLVO_SCOPE`
- `VOLVO_TOKEN_AUTH_METHOD`
- `VOLVO_VEHICLES_URL`
- `VOLVO_POSITIONS_URL`
- `VOLVO_STATUSES_URL`
- `VOLVO_ACCEPT_VEHICLES`
- `VOLVO_ACCEPT_POSITIONS`
- `VOLVO_ACCEPT_STATUSES`
- `VOLVO_API_KEY` (optional)
- `VOLVO_API_KEY_HEADER` (required only when an API key is used)
- `VOLVO_DRIVER_API_BASE_URL` (defaults to `https://api.volvotrucks.com/driver`)
- `VOLVO_DRIVERS_URL` (defaults to the Group Driver API `/drivers` endpoint)
- `VOLVO_DRIVER_TIMES_URL` (defaults to the Group Driver API `/drivertimes` endpoint)
- `VOLVO_DRIVER_API_USERNAME` and `VOLVO_DRIVER_API_PASSWORD` (optional dedicated credentials; the backend falls back to the existing Volvo API credentials)
- `VOLVO_DRIVER_ID_TYPE` (defaults to `Tacho`)
- `VOLVO_ACCEPT_DRIVERS` (defaults to Volvo drivers v1.0)
- `VOLVO_ACCEPT_DRIVER_TIMES` (defaults to Volvo driver-times v1.1)
- `VOLVO_DRIVER_CACHE_MS` (optional, defaults to `300000`)
- `VOLVO_DRIVER_REQUEST_TIMEOUT_MS` (optional, defaults to `30000`)
- `VOLVO_DRIVER_REQUEST_RETRIES` (optional, defaults to `2`)
- `VOLVO_SCORES_URL` (defaults to `https://api.volvotrucks.com/score/scores`)
- `VOLVO_SCORES_API_USERNAME` and `VOLVO_SCORES_API_PASSWORD` (optional dedicated credentials; the backend falls back to the existing Volvo credentials)
- `VOLVO_SCORES_DRIVER_ID_TYPE` (defaults to `pin`)
- `VOLVO_ACCEPT_SCORES` (defaults to Volvo Scores v2.0)
- `VOLVO_SCORES_CACHE_MS` (optional, defaults to `300000`)
- `VOLVO_SCORES_REQUEST_TIMEOUT_MS` (optional, defaults to `30000`)
- `VOLVO_SCORES_REQUEST_RETRIES` (optional, defaults to `2`)
- `VOLVO_SCORES_MAX_PAGES` (optional, defaults to `100`)
- `VOLVO_SCORES_PERSIST` (optional, defaults to `true`)
- `VOLVO_SCORES_TABLE_NAME` (optional, defaults to `VolvoDriverScores`)
- `VOLVO_POSITION_POLL_MS`
- `VOLVO_STATUS_POLL_MS`
- `VOLVO_VEHICLE_POLL_MS`
- `VOLVO_ACCUMULATED_POLL_MS`
- `VOLVO_REQUEST_TIMEOUT_MS`
- `VOLVO_CACHE_SECONDS`
- `VOLVO_FRONTEND_REFRESH_SECONDS`
- `VOLVO_FRESH_AFTER_MINUTES`
- `VOLVO_STALE_AFTER_MINUTES`
- `VOLVO_STANDSTILL_SPEED_KPH`
- `VOLVO_SYNC_SECRET`
- `USE_MOCK_VOLVO_DATA`
- `VOLVO_EVENTS_TABLE_NAME`
- `VOLVO_STATE_TABLE_NAME`
- `VOLVO_CURSOR_TABLE_NAME`
- `VOLVO_BOOTSTRAP_HISTORY_MINUTES`
- `VOLVO_RFMS_DRIVER_REPORT_CONCURRENCY` (optional, defaults to `1`; limits concurrent per-vehicle historical requests for driver reports)
- `VOLVO_RFMS_DRIVER_REPORT_REQUEST_DELAY_MS` (optional, defaults to `750`; spaces historical requests to respect Volvo throttling)
- `SCANIA_CLIENT_ID` and `SCANIA_CLIENT_SECRET` (backend only; the secret is base64url-decoded for Scania challenge-response authentication)
- `SCANIA_ACCESS_TOKEN` (optional temporary bootstrap token; never expose it to the frontend)
- `SCANIA_AUTH_BASE_URL`, or explicit `SCANIA_CHALLENGE_URL` and `SCANIA_TOKEN_URL`
- `SCANIA_RFMS_VEHICLES_URL`
- `SCANIA_RFMS_VEHICLE_POSITIONS_URL`
- `SCANIA_RFMS_VEHICLE_STATUSES_URL`
- `SCANIA_LAST_REPORTED_POSITION_URL` (optional)
- `SCANIA_EXCEPTION_HISTORY_URL`
- `SCANIA_VEHICLE_EVALUATION_URL`
- `SCANIA_VEHICLE_EVALUATION_GAS_URL` (optional when the gas response uses a separate URL)
- `SCANIA_VEHICLE_EVALUATION_GAS_QUERY_PARAM` (optional; defaults to `includeGasConsumption`)
- `SCANIA_VEHICLE_EVALUATION_RESULT_URL` (required only when Vehicle Evaluation returns a `SessionId`)
- `SCANIA_DRIVER_EVALUATION_URL`
- `SCANIA_DRIVER_EVALUATION_V3_REQUEST_URL` and `SCANIA_DRIVER_EVALUATION_V3_RESPONSE_URL`
- `SCANIA_HTTP_TIMEOUT_MS`, `SCANIA_HTTP_RETRIES`, and `SCANIA_MAX_PAGES`
- `SCANIA_TOKEN_TTL_SECONDS`
- `SCANIA_REPORT_POLL_INTERVAL_MS` and `SCANIA_REPORT_POLL_TIMEOUT_MS`
- `SCANIA_REPORT_SESSIONS_TABLE_NAME` (optional; defaults to `ScaniaReportSessions`)

See `docs/volvo-live-vehicle-status.md` for synchronization and rotation procedures. Volvo credentials are Azure-only and must never use a `VITE_` prefix.
See `docs/scania-live-integration.md` for Scania setup, mappings, report behavior, and acceptance testing. Scania credentials are Azure-only and must never use a `VITE_` prefix.

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
- Microsoft Entra / Windows App SDK push setup: client ID, tenant ID, object ID, client secret, and PFN mapping when terminated-app push is enabled
