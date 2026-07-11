# Rollback

## PWA / Hostinger

Keep the previous `dist` zip before upload. To roll back, delete current `public_html` frontend files and extract the previous known-good zip. Verify `/`, `/manifest.webmanifest`, and login.

## Azure Backend

Keep the previous API zip artifact before deploying new Functions code. If health checks fail, redeploy the previous zip and verify `/api/health`.

## Notification Tables

The initial implementation creates additive Azure Tables only. Rollback can leave these tables in place because they are not referenced by the previous API package.

## Desktop Release

If a desktop release is bad, mark the GitHub release as withdrawn, remove updater metadata for that version, and publish a signed rollback or hotfix release.

## WhatsApp

Disable WhatsApp sends by removing or disabling `WHATSAPP_ACCESS_TOKEN` in Azure and disabling templates/rules in admin configuration.

