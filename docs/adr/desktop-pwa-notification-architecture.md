# ADR: Desktop, PWA, And Notification Architecture

## Status

Accepted for implementation scaffolding and staged rollout.

## Context

The application is an existing Vite React dashboard with an Azure Functions backend and Hostinger static frontend hosting. Authentication and users already live in Azure Functions backed by Azure Table Storage. The product now needs PWA support, installable desktop shells, user-targeted notifications, in-app notification center, and WhatsApp Business Platform integration without creating separate applications.

## Decision

Use the existing React frontend as the shared UI for web, PWA, and desktop shells.

Use Azure Functions as the shared backend for:

- Authenticated device registration
- Push subscription storage
- Notification preferences
- Notification inbox
- Admin notification sends
- WhatsApp consent
- WhatsApp webhook verification and status handling

Use Azure Table Storage for the first notification persistence layer because the project already uses it and no ORM/migration system exists. Add tables lazily from backend code with names configurable by environment variables.

Use Tauri 2 as the desktop wrapper because the current frontend is a static Vite app and does not require Node integration in the renderer. Tauri keeps the desktop shell smaller and has a tighter default security model than Electron.

Use Hostinger only for web/PWA static assets. Use Azure for backend APIs, provider secrets, webhook endpoints, queues/workers, and future Web Push/WhatsApp delivery workers.

## What Remains Unchanged

- Existing dashboard UI and navigation model
- Existing user/login/password APIs
- Existing Azure Table user storage
- Existing tracking Excel column contract
- Existing Hostinger static web deployment
- Existing Azure Function API base URL

## PWA Strategy

- Add manifest, icons, service worker, offline fallback, install prompt handling, and service-worker update flow
- Cache only static versioned assets and offline shell
- Do not cache auth responses or sensitive API responses
- Register Web Push subscriptions only after user action and authenticated session

## Desktop Strategy

- Add Tauri 2 project scaffolding that loads the same built frontend
- Configure least-privilege capabilities
- Configure product metadata and bundle targets
- Use native notification support only after Tauri plugins/signing are configured
- Do not claim full quit-time push delivery until WNS/APNs or a signed background mechanism exists

## Push Notification Strategy

- Store user devices and Web Push subscription data server-side
- Attach every device to one authenticated user
- Logout and explicit revoke disable devices
- Build in-app notification delivery immediately
- Web Push provider sends are blocked until VAPID keys are configured
- Push payloads must contain only non-sensitive summary data and deep links

## WhatsApp Strategy

- Use official WhatsApp Cloud API only
- Require authenticated user mapping and explicit consent before sends
- Add webhook verification and signature validation
- Store consent/status records
- Do not send real messages until Meta app, phone number, templates, app secret, and access token are configured

## Backend Queue Strategy

No queue service exists today. The first implementation records notification events and delivery rows in Azure Tables. A future Azure Storage Queue or Service Bus worker should be added before high-volume broadcasts or provider retry workers go live.

## Database Changes

Add Azure Table-backed entities equivalent to:

- user devices
- push subscriptions
- notification preferences
- notification inbox
- notification deliveries
- WhatsApp contacts and consents
- WhatsApp message statuses

No destructive migration is required.

## Security Model

- All notification endpoints require bearer token auth except verified WhatsApp webhooks
- Admin broadcast endpoints require Super Admin
- Server resolves target users; clients do not get to decide final recipients
- Provider secrets stay in Azure/GitHub secrets
- Desktop shell gets only public API URL/configuration
- No sensitive data is placed in service-worker caches
- Large broadcasts require explicit confirmation in UI before production enablement

## Known Platform Limitations

- iOS Web Push requires the app to be installed to the Home Screen on supported iOS versions
- Browser push permission must be requested only after user action
- Desktop notifications after complete app quit are not guaranteed with Tauri scaffolding alone
- Code signing, notarization, and signed auto-update require external certificates and account-owner setup
- WhatsApp template approval and webhook setup require Meta Business configuration

