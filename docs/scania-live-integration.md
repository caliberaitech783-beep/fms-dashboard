# Scania Live Integration

The Scania integration is server-to-server. The browser calls the FMS Azure
Functions API and never receives a Scania Client Secret or access token.

## Configuration

1. Copy `api/.env.example` to `api/.env` for local development.
2. Fill in the URLs and credentials supplied by Scania. `api/.env` is ignored by
   Git and must not be committed.
3. In Azure, add the same values as Function App settings. Do not add any Scania
   credential under a `VITE_` name or in Hostinger.
4. Import the Scania vehicle master records with VIN/chassis number,
   registration number, and an explicit Sasti OCM, DCH West, or DCH East site
   assignment. DCH East and DCH West must have different FMS site IDs even when
   Scania groups both under `Dudhichua Singrauli`.
5. If Vehicle Evaluation returns a `SessionId`, configure
   `SCANIA_VEHICLE_EVALUATION_RESULT_URL`.

The integration maps and filters these sites independently using the FMS
vehicle-master assignment:

- `Sasti OCM` (`site-wcl-sasti-ocm`).
- `DCH West` (`site-ncl-dch-west`) under Scania `Dudhichua Singrauli`.
- `DCH East` (`site-ncl-dch-east`) under Scania `Dudhichua Singrauli`.
- Shift `A` to 05:00–13:00 in `Asia/Kolkata`.
- Shift `B` to 13:00–21:00 in `Asia/Kolkata`.
- Shift `C` to 21:00–05:00 on the following day in `Asia/Kolkata`.

Scania reports use only the normal Shift A, B, and C labels. A1 and A2 are not
used. The backend derives the canonical window from the selected shift, so an
old full-day request cannot produce a Shift A/B/C report with 00:00–23:59 data.

## Authentication and requests

The backend obtains a Scania challenge, base64url-decodes the challenge and
Client Secret, computes the HMAC-SHA256 response, exchanges it for a token,
caches that token, and renews it before expiry or once after an HTTP 401.

The backend exposes:

- `GET /api/scania/vehicles`
- `GET /api/scania/positions`
- `GET /api/scania/status`
- `GET /api/scania/exceptions`
- `POST /api/scania/reports/vehicle-evaluation`

All endpoints require an FMS bearer token and an authorized live-data role.
Temporary Scania logs contain endpoint paths, HTTP statuses, record counts,
masked SessionIds, polling status, filter counts, and final vehicle counts.
Credentials and bearer tokens are masked.

## Vehicle Evaluation report

The gas-consumption response is the primary report source.
`AverageFuelConsumption` is treated as litres per 100 km and is converted by
`averageFuelConsumptionLitresPer100KmToKmPerLitre` using `100 / value`.
Rows are joined to the FMS vehicle master by VIN first and registration second.
Vehicles outside the selected site, missing vehicle-master mappings, duplicate vehicles,
and engine-running times below 30 minutes are counted and removed.

The UI exports CSV, PDF, and Excel only when the Scania backend returned a
successful live report containing at least one row. Authentication, permission,
timeout, mapping, request, network, and genuine empty-data states are displayed
separately.

## Local verification

From the repository root:

```powershell
cd api
npm ci
npm test
cd ..
npm run build
```

Start the API and web app in separate terminals:

```powershell
cd api
npm start
```

```powershell
npm run dev
```

In the portal select:

- OEM: Scania
- Site: DCH West
- Shift: A
- From/To: 31 July 2026
- Report: Driverwise Standstill Tracking

The browser request body must be:

```json
{
  "site": "DCH West",
  "shift": "A",
  "startTime": "2026-07-31T05:00:00+05:30",
  "stopTime": "2026-07-31T13:00:00+05:30"
}
```

The historical acceptance target is 20 live, filtered vehicles. Do not replace
an authentication, permission, endpoint, site-mapping, or vehicle-master error
with an empty report, and do not add hard-coded rows to meet that target.
