# Deployment

## Web / PWA

Production source of truth is the GitHub `main` branch. A push to `main` runs CI, builds the same frontend for both hosting targets, publishes the immutable `dist/` output to the `hostinger-deploy` branch, and deploys the validation copy to Azure Static Web Apps. Hostinger remains the public host for `fms.cmll.in`; Azure Static Web Apps is the secondary deployment target.

Before merging to `main`:

1. Run `npm ci`.
2. Run `npm run lint`, `npm run validate:pwa`, `npm run test:reports`, and `npm run build`.
3. Confirm the pull-request CI jobs are green.
4. Merge to `main` and confirm both `Deploy Hostinger Web App` and `Deploy web app to Azure Static Web Apps` finish successfully.
5. Confirm:
   - `https://fms.cmll.in/manifest.webmanifest` returns JSON.
   - `https://fms.cmll.in/service-worker.js` returns JavaScript and is not cached forever.
   - `https://fms.cmll.in/offline.html` returns the offline fallback.
   - SPA deep links still load `index.html`.
   - API calls go to Azure, not Hostinger.

## Azure Backend

1. Configure all required Azure Function App settings from `docs/environment-variables.md`.
2. Deploy the API package to `cmll-fms-api-783`.
3. Verify `https://cmll-fms-api-783-hgadd9fqfdb5a8hq.centralindia-01.azurewebsites.net/api/health`.
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

Pull requests run the web build, report tests, dependency audit, and API tests. Pushes to `main` are the only production frontend deployment source. Release tags prepare PWA and desktop artifacts. Signed desktop releases require external signing secrets.

Because this repository is private and GitHub Code Security is not included in the current account plan, the CodeQL workflow runs analysis without uploading to the paid code-scanning dashboard. Its SARIF report is retained as a downloadable Actions artifact for 14 days. If GitHub Code Security is purchased later, restore `security-events: write` and remove `upload: never` to publish findings in the repository Security tab.
