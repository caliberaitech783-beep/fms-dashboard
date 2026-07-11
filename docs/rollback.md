# Rollback

## PWA / Hostinger

Each production workflow stores `dist` as a 30-day GitHub Actions artifact. Roll back only to a post-security artifact, purge Hostinger CDN/cache, and verify `/`, `/manifest.webmanifest`, the service-worker version, login, and that retired hashed assets return 404.

## Azure Backend

Never redeploy an API package containing `src/functions/frontend.js`, `public/`, employee seed files, or user-ID-derived passwords. If a release fails, redeploy the most recent sanitized API package, keep the credential migration in place, and verify `/api/health`, `/api/app` is retired, login lockout, and one-time-password flows.

## Notification Tables

The credential migration creates a private `FmsSecurityMigrationBackup` snapshot before changing user/password-history rows. Keep the snapshot access-restricted. Do not restore known default-password hashes; use the recovery account and normal one-time reset flow instead. Notification tables are additive and may remain in place.

## Desktop Release

If a desktop release is bad, mark the GitHub release as withdrawn, remove updater metadata for that version, and publish a signed rollback or hotfix release.

## WhatsApp

Disable WhatsApp sends by removing or disabling `WHATSAPP_ACCESS_TOKEN` in Azure and disabling templates/rules in admin configuration.
