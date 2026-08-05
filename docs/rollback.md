# Rollback

## PWA / Hostinger

Each production workflow retains the built `dist` artifact for 30 days and publishes a single immutable snapshot to `hostinger-deploy`. To roll back, rerun the deployment from a known-good `main` commit or restore its retained artifact, then verify `/`, `/manifest.webmanifest`, `/service-worker.js`, a deep link, and login.

Do not change DNS during an application rollback. `fms.cmll.in` remains on Hostinger; the Azure Static Web App is a secondary validation target.

## Azure Backend

Keep the previous API zip artifact before deploying new Functions code. If health checks fail, redeploy the previous zip and verify `/api/health`.

## Notification Tables

The initial implementation creates additive Azure Tables only. Rollback can leave these tables in place because they are not referenced by the previous API package.

## Desktop Release

If a desktop release is bad, mark the GitHub release as withdrawn, remove updater metadata for that version, and publish a signed rollback or hotfix release.

## WhatsApp

Disable WhatsApp sends by removing or disabling `WHATSAPP_ACCESS_TOKEN` in Azure and disabling templates/rules in admin configuration.

