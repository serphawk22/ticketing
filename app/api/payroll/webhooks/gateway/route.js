import { NextResponse } from 'next/server';
import { processWebhookCallback } from '@/lib/paymentReconciliation';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const rawBody = await request.text();
    let body = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const gateway = request.headers.get('x-gateway') || body.gateway || 'mock_gateway';
    const eventId = request.headers.get('x-event-id') || body.event_id || `evt_${Date.now()}`;
    const eventType = body.event || body.event_type || 'payment.captured';
    const signature = request.headers.get('x-signature') || '';
    const referenceId = body.reference_id || body.payload?.payment?.entity?.notes?.reference_id;
    const headerWorkspaceId = request.headers.get('x-workspace-id');

    const result = await processWebhookCallback({
      gateway,
      eventId,
      eventType,
      payload: body,
      signature,
      referenceId,
      headerWorkspaceId,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /api/payroll/webhooks/gateway] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
