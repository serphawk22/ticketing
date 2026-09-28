import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOutbox, isSmtpConfigured } from '@/lib/mail';

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    smtpConfigured: isSmtpConfigured(),
    outbox: await getOutbox({ limit: 100 }),
  });
}
