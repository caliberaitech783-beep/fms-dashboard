# Desktop Releases

## Current Status

Tauri 2 scaffolding is present in `src-tauri/`. The shared Vite frontend is bundled into the desktop shell.

## Windows

Run `npm run desktop:build` on a Windows runner after Rust, WebView2 build tooling, and signing certificates are configured. Bundle targets are MSI and NSIS.

Required external setup:

- Windows code-signing certificate
- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_SIGNING_IDENTITY`

## macOS

Run `npm run desktop:build` on a macOS runner after Apple signing and notarization credentials are configured.

Required external setup:

- Apple Developer account
- Developer ID Application certificate
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`

## Update Signing

Signed updater artifacts are configured as a requirement, but production auto-update must not be enabled until Tauri updater signing keys are configured.

