# Manual Acceptance Tests

## Web/PWA

1. Open `https://fms.cmll.in`.
2. Log in as a test user.
3. Open Notifications.
4. Register current device.
5. Send test notification.
6. Confirm only the current user inbox receives it.
7. Mark it read.
8. Install PWA on Android or desktop browser.
9. Go offline and confirm offline fallback appears on navigation.
10. Confirm the top bar shows Online/Offline and pending sync count.
11. When a new deployment is available, confirm the visible button says `New version available — Update now`.

## Admin Notifications

1. Log in as Super Admin.
2. Open Admin Notifications.
3. Preview one selected user.
4. Send in-app notification.
5. Confirm target user receives it.
6. Confirm another user does not receive it.
7. Try all-users broadcast without confirmation and confirm it is rejected.
8. Open delivery history and confirm blocked/failed rows can be retried only when not permanent failures.

## Windows Desktop

1. Install the NSIS setup.exe on a Windows test machine.
2. Log in as a test user.
3. Register the Windows desktop device.
4. Enable desktop notifications in preferences.
5. Send a targeted notification to that user.
6. Confirm the native Windows notification appears while the app is open or in tray.
7. Close the main window and confirm the app remains in tray.
8. Click the tray icon and confirm the existing window is restored.
9. Use Quit completely and confirm the process exits.
10. Log out and confirm only the current device registration is revoked.

## WhatsApp

1. Register a test user's WhatsApp phone number.
2. Record opt-in.
3. Configure Meta webhook challenge.
4. Send one approved template to the opted-in test recipient only after Meta setup.
5. Confirm webhook status events are accepted only with a valid signature.
