import { NextResponse } from 'next/server';
import { getWorkCategories } from '@/lib/workLedger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const categories = await getWorkCategories({ activeOnly: true });
  return NextResponse.json({ categories });
}
