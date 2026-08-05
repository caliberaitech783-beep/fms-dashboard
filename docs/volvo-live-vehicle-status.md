# Latest Volvo Vehicle Data

The Fleet page reads normalized Volvo data from the authenticated Azure backend route `GET /api/vehicles/live`. The browser never calls Volvo directly and never receives Volvo credentials or access tokens.

## Required Azure settings

Set the following as Azure Function App settings, not frontend or Hostinger variables:

- `VOLVO_TOKEN_URL`: the confirmed OAuth token endpoint, not a vehicle-data endpoint
- `VOLVO_CLIENT_ID`
- `VOLVO_CLIENT_SECRET`
- `VOLVO_SCOPE`: the confirmed OAuth scope/ROGID
- `VOLVO_TOKEN_AUTH_METHOD=basic` when the token request uses HTTP Basic client authentication
- `VOLVO_VEHICLES_URL=https://api.volvotrucks.com/vehicle/vehicles`
- `VOLVO_POSITIONS_URL=https://api.volvotrucks.com/vehicle/vehiclepositions`
- `VOLVO_STATUSES_URL=https://api.volvotrucks.com/vehicle/vehiclestatuses`
- `VOLVO_ACCEPT_VEHICLES=application/x.volvogroup.com.vehicles.v1.0+json; UTF-8`
- `VOLVO_ACCEPT_POSITIONS=application/x.volvogroup.com.vehiclepositions.v1.0+json; UTF-8`
- `VOLVO_ACCEPT_STATUSES=application/x.volvogroup.com.vehiclestatuses.v1.0+json; UTF-8`
- `VOLVO_API_KEY` and `VOLVO_API_KEY_HEADER` only when the successful portal request uses them
- `VOLVO_POSITION_POLL_MS=300000`
- `VOLVO_STATUS_POLL_MS=900000`
- `VOLVO_VEHICLE_POLL_MS=21600000`
- `VOLVO_ACCUMULATED_POLL_MS=3600000`
- `VOLVO_REQUEST_TIMEOUT_MS=20000`
- `VOLVO_CACHE_SECONDS=60`
- `VOLVO_FRONTEND_REFRESH_SECONDS=30`
- `VOLVO_FRESH_AFTER_MINUTES=20`
- `VOLVO_STALE_AFTER_MINUTES=120`
- `VOLVO_STANDSTILL_SPEED_KPH=3`
- `VOLVO_SYNC_SECRET`
- `USE_MOCK_VOLVO_DATA=false`
- `VOLVO_EVENTS_TABLE_NAME=VolvoVehicleEvents`
- `VOLVO_STATE_TABLE_NAME=VolvoVehicleState`
- `VOLVO_CURSOR_TABLE_NAME=VolvoSyncCursor`
- `VOLVO_BOOTSTRAP_HISTORY_MINUTES=180`

The legacy Basic RFMS settings remain supported as a fallback. If any OAuth Group API setting is added, the complete OAuth configuration is required; partial configuration fails with a sanitized server-side configuration error.

## Local development

1. Copy `api/local.settings.json.example` to `api/local.settings.json`.
2. Set local secrets outside source control.
3. Start Azurite when using `UseDevelopmentStorage=true`.
4. Run `npm.cmd start --prefix api`.
5. Run `npm.cmd run dev` in the repository root.

Sanitized fixtures are test-only. Production must keep `USE_MOCK_VOLVO_DATA=false`.

## Synchronization

- `volvoScheduledSync` runs every five minutes using the Azure Functions timer trigger.
- Vehicle pagination uses `lastVin`.
- Position pagination advances the newest `receivedDateTime` by one second and retains the first page's server timestamp as the stop boundary.
- Snapshot and accumulated status are fetched separately and paginated with `lastVin`.
- The OAuth access token is cached until shortly before expiry. One token refresh and one request retry occur after HTTP 401.
- `POST /api/internal/volvo-sync` accepts `VOLVO_SYNC_SECRET` as a bearer token or `x-volvo-sync-secret` header.
- Authorized Super Admin, Management, and Fleet Manager users can call `POST /api/integrations/volvo/refresh` through the Fleet page.
- The cursor is saved only after every page and state record has been processed.
- Duplicate events are rejected by a SHA-256 event key.

## Connectivity verification

1. Confirm `GET /api/health` returns `200`.
2. Sign in to the portal.
3. Open Fleet and select **Refresh now**.
4. Confirm `/api/vehicles/live` returns `meta.source = VOLVO_LIVE`, freshness metadata, and no secrets or driver identifiers.
5. Confirm each VIN appears once even when multiple Volvo events exist.
6. Confirm missing fields display as an em dash instead of zero.

## Reports

Open **Reports** and select **Driverwise Standstill Tracking**. The preview and CSV/PDF/Excel exports use the 13 Volvo columns from `Driverwise Tracking.xlsm`. Metrics not supplied by the enabled Volvo endpoint remain blank rather than being fabricated.

## Credential rotation

Update the OAuth settings in Azure Function App settings, restart the Function App, and use **Refresh now**. Do not place credentials in `.env.example`, GitHub, Hostinger, frontend environment variables, screenshots, or logs.

## Storage

Azure Tables are created automatically from `AzureWebJobsStorage`:

- `VolvoVehicleEvents`: immutable raw events keyed by the hashed idempotency key.
- `VolvoVehicleState`: one consolidated state per VIN, including separate last-known snapshot, accumulated, ignition, driver, and location events.
- `VolvoSyncCursor`: completed incremental synchronization cursor.

No manual SQL migration is required.
