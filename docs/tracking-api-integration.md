# Tracking Sheet API Integration

This integration imports the Excel workbook format used by `Tracking sheet.xlsx`, enriches rows with optional shift metadata, and syncs rows to a configured tracking API.

## Workbook Contract

The importer reads `Sheet1` and preserves the existing first four columns exactly:

- A: `firm name`
- B: `status`
- C: `revert`
- D: `contact / phone number`

Column D is treated as phone/contact by position even when the header cell is blank. Existing user-entered data in A-D is never modified or deleted. Sync metadata is written only after existing user columns, using:

- `API Sync Status`
- `Last Sync At`
- `API Response ID`
- `API Error`

Phone numbers are read as text to avoid scientific notation.

## Required Secrets

Set these as environment variables or platform secrets only:

- `TRACKING_API_USERNAME`
- `TRACKING_API_PASSWORD`
- `TRACKING_API_BASE_URL`

Do not add these values to GitHub, source files, screenshots, or logs. The static Hostinger frontend does not need these variables. Add them to the Azure Function App settings for `cmll-fms-api` before running a real sync.

## Local Dry Run

From the API folder:

```powershell
npm run tracking:sync -- --file "C:\Users\dhruv\OneDrive\Desktop\Tracking sheet.xlsx" --dry-run
```

Dry run validates the workbook and shows masked payload previews without calling the remote API.

## Real Smoke Test

Run this only after the three `TRACKING_API_*` values are configured in the current shell or Azure Function App:

```powershell
npm run tracking:sync -- --file "C:\Users\dhruv\OneDrive\Desktop\Tracking sheet.xlsx" --real --output ".\tracking-sync-output.xlsx"
```

For the deployed Azure route, call `POST /api/tracking/sync` as a Super Admin with:

```json
{
  "fileBase64": "<xlsx base64>",
  "dryRun": true,
  "defaultSite": "Sasti",
  "defaultTimestamp": "2026-07-10T05:00:00+05:30"
}
```

Set `dryRun` to `false` only after the Azure settings are present and a dry run is clean.

## Shift Rules

All shift calculations use `Asia/Kolkata`, trim site names, and match case-insensitively.

Sasti, Dhoptala, Dudhichua, Gauri:

- Shift A: 05:00 to 13:00
- Shift B: 13:00 to 21:00
- Shift C: 21:00 to next day 05:00

Majri, Jayant:

- Shift A: 04:00 to 12:00
- Shift B: 12:00 to 20:00
- Shift C: 21:00 to next day 04:00
- 20:00 to 20:59:59 is no active shift

Shift starts are inclusive and ends are exclusive. Shift C rows after midnight use the previous calendar day as the shift date.

