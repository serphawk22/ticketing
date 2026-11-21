# WhatsApp webhook setup

The route is `/api/whatsapp/webhook`. It uses Meta's GET verification handshake
and validates POST requests with HMAC-SHA256 over the original request bytes.
It does not require a browser session cookie.

## Configuration

1. Set `WHATSAPP_VERIFY_TOKEN` to a long random secret in your environment.
   Use that exact value in Meta's **Verify token** field.
2. Set `WHATSAPP_APP_SECRET` to your Meta application's **App settings > Basic >
   App secret**. This is different from the API access token and verify token.
3. Restart the development server, or set both variables on your host and redeploy.
4. Expose the app through public HTTPS. A local server needs an HTTPS tunnel;
   Meta cannot reach `localhost` directly.
5. On Meta's **Configure Webhooks** page, set **Callback URL** to
   `https://YOUR-PUBLIC-HOST/api/whatsapp/webhook`, enter the matching verify token,
   leave the optional client certificate off, then click **Verify and save**.
6. Subscribe to the `messages` webhook field to receive message and status events.
   Complete Meta's account subscriptions and publishing requirements as shown
   in your dashboard before expecting production events.

Keep these secrets on the server; do not use `NEXT_PUBLIC_` variables for them.

## Current scope

This is a setup receiver: correctly signed WhatsApp payloads are acknowledged
with HTTP 200 and a content-free server log. Events are **not persisted or
processed**, including repeated events. Do not rely on this route for message
history or delivery tracking yet: acknowledging an event tells Meta it was
received. Ticket creation, replies, outbound notifications, durable storage,
and event deduplication require the next integration step.

Unconfigured credentials return 503, invalid verification or signatures return
403, and signed invalid payloads return 400. No credentials or message content
are logged.

Run isolated checks with `node --test tests/whatsapp-webhook.test.mjs`.
