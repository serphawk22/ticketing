import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokensMatch(actual, expected) {
  return timingSafeEqual(
    createHash('sha256').update(actual).digest(),
    createHash('sha256').update(expected).digest()
  );
}

// Meta calls GET when "Verify and save" is clicked in the app dashboard.
export async function GET(request) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) {
    return Response.json({ error: 'WhatsApp verification is not configured.' }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (
    params.get('hub.mode') !== 'subscribe' ||
    !token || !challenge || !tokensMatch(token, expected)
  ) {
    return Response.json({ error: 'Webhook verification failed.' }, { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// This initial receiver validates and acknowledges events only. It does not
// create tickets, store message content, or update delivery records yet.
export async function POST(request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return Response.json({ error: 'WhatsApp event validation is not configured.' }, { status: 503 });
  }

  const signature = request.headers.get('x-hub-signature-256') || '';
  if (!/^sha256=[a-fA-F0-9]{64}$/.test(signature)) {
    return Response.json({ error: 'Invalid webhook signature.' }, { status: 403 });
  }

  // Verify the original bytes, before parsing or reserializing the JSON.
  const rawBody = Buffer.from(await request.arrayBuffer());
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const supplied = Buffer.from(signature.slice(7), 'hex');
  if (!timingSafeEqual(supplied, expected)) {
    return Response.json({ error: 'Invalid webhook signature.' }, { status: 403 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return Response.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    return Response.json({ error: 'Invalid WhatsApp webhook payload.' }, { status: 400 });
  }

  // Keep message bodies, phone numbers, credentials, and signatures out of logs.
  console.info('[whatsapp:webhook] Validated event received; business processing is not configured.');
  return Response.json({ received: true });
}
