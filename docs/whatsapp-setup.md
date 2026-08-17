# WhatsApp Setup

## Implemented

- User WhatsApp contact registration
- Explicit opt-in and opt-out consent endpoints
- Webhook verification challenge
- `x-hub-signature-256` verification with `WHATSAPP_APP_SECRET`
- Webhook event recording

## Manual Meta Setup

1. Create/configure a Meta app in Meta Developer Dashboard.
2. Add WhatsApp product.
3. Configure the business phone number.
4. Set callback URL to the Azure endpoint:
   - `https://cmll-fms-api-783-hgadd9fqfdb5a8hq.centralindia-01.azurewebsites.net/api/webhooks/whatsapp`
5. Set the same verify token in Meta and Azure:
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
6. Add in Azure:
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `WHATSAPP_APP_SECRET`
   - `WHATSAPP_GRAPH_API_VERSION`
7. Create and submit templates for Meta approval:
   - Assignment notification
   - Status update
   - Revert reminder
   - Overdue escalation
   - Shift handover reminder
   - System announcement
   - Test notification

Do not broadcast until templates are approved and a test number has verified opt-in.

