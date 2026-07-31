# Deployment

## Web / PWA

1. Run `npm ci`.
2. Run `npm run build`.
3. Upload the contents of `dist/` to Hostinger `public_html`.
4. Confirm:
   - `https://fms.cmll.in/manifest.webmanifest` returns JSON.
   - `https://fms.cmll.in/service-worker.js` returns JavaScript and is not cached forever.
   - `https://fms.cmll.in/offline.html` returns the offline fallback.
   - SPA deep links still load `index.html`.
   - API calls go to Azure, not Hostinger.

## Azure Backend

1. Configure all required Azure Function App settings from `docs/environment-variables.md`.
2. Deploy the API package to `cmll-fms-api`.
3. Verify `https://cmll-fms-api.azurewebsites.net/api/health`.
4. Verify authenticated notification endpoints using a Super Admin token in staging first.
5. Confirm logs do not contain secrets.
6. Configure the Volvo settings documented in `docs/volvo-live-vehicle-status.md`.
7. Confirm the `volvoScheduledSync` timer is registered and the three Volvo Azure Tables are created.
8. Verify authenticated `GET /api/vehicles/live` and authorized `POST /api/integrations/volvo/refresh` responses.
9. Configure the backend-only Scania settings from `docs/scania-live-integration.md`.
10. Verify authenticated `GET /api/scania/status` and the DCH West / Shift A, B, and C
    `POST /api/scania/reports/vehicle-evaluation` acceptance request before
    enabling Scania exports in production.

The previous Azure production API package should be kept as the rollback artifact until the notification package is verified in staging.

## GitHub

Pull requests run web build and API tests. Release tags prepare PWA and desktop artifacts. Signed desktop releases require external signing secrets.
