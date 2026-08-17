# Architecture Audit

Date: 2026-07-10

## Repository State

- Branch at audit start: `feature/tracking-api-integration`
- Implementation branch created for this work: `feature/cross-platform-notifications`
- Production web URL used by the app: `https://fms.cmll.in`
- Production API URL used by the app: `https://cmll-fms-api-783-hgadd9fqfdb5a8hq.centralindia-01.azurewebsites.net/api`
- GitHub remote: `https://github.com/caliberaitech783-beep/fms-dashboard.git`

## Frontend Stack

- Vite React application in `src/`
- TypeScript with `tsc --noEmit` in the production build
- Tailwind CSS styling through `src/styles.css`
- UI is a dashboard shell driven by local section state, not route-based pages
- Role-based navigation is defined in `src/constants/routes.ts` and `src/auth/permissions.ts`
- Existing auth context is in `src/auth/AuthContext.tsx`
- Frontend talks to the Azure auth API through `src/services/userService.ts`
- Hostinger serves the static frontend build from `dist/`

## Backend Stack

- Azure Functions Node v4 model in `api/src/functions/`
- Existing auth/user routes are in `api/src/functions/authApi.js`
- Azure Table Storage is used directly through `@azure/data-tables`
- Existing user, audit, and password-history persistence is in `api/src/lib/authStore.js`
- Tracking sheet integration is on this branch under `api/src/lib/tracking/`

## Authentication And Authorization

- Login issues a signed bearer token from the Azure Function API
- Tokens are signed with `AUTH_TOKEN_SECRET`
- Super Admin checks are server-side in the API
- Frontend permissions are mirrored for navigation only and are not trusted for backend authorization

## Excel And Tracking Integration

- `Tracking sheet.xlsx` is parsed from `Sheet1`
- Columns A-D are preserved as:
  - A: firm name
  - B: status
  - C: revert
  - D: contact / phone number
- Sync results are written only after existing user columns
- Phone numbers are treated as text
- Tracking API credentials are expected only from:
  - `TRACKING_API_BASE_URL`
  - `TRACKING_API_USERNAME`
  - `TRACKING_API_PASSWORD`

## Shift Logic

- Frontend shift constants exist in `src/constants/shifts.ts`
- Backend tracking shift resolver exists in `api/src/lib/tracking/shiftResolver.js`
- Tests already cover the requested Sasti and Majri boundary cases on the tracking branch
- All notification scheduling must use `Asia/Kolkata`

## Deployment

- Hostinger responsibility: static web/PWA assets
- Azure responsibility: auth API, tracking sync route, notification APIs, workers/webhooks when enabled
- No GitHub Actions workflow existed at audit time
- No Docker deployment files were present
- No database migration framework exists; Azure Tables are created lazily by backend code

## Current Gaps

- No PWA manifest or service worker
- No offline fallback
- No notification center
- No device registration or notification preference model
- No Web Push subscription storage
- No WhatsApp Cloud API webhook verification or consent model
- No desktop app wrapper
- No CI/CD workflows
- Frontend `npm run lint` exists but `eslint` is not installed in the repo
- Production Azure package deployment for the prior tracking branch needs staging/logging before retrying because a feature package failed route serving and was restored

## Security Findings

- `.env.example` contains placeholders only
- API credentials are not committed in source
- Existing frontend session is stored in browser storage, which is acceptable for the web app but not sufficient for native desktop secure-token storage
- Desktop secure storage requires Tauri plugin configuration before production release
- Push and WhatsApp provider secrets must remain in Azure app settings or GitHub secrets, never in Hostinger static assets

