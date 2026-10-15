import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateBankDetails, getUserProfile } from '@/lib/profiles';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = await getUserProfile(session.user.id);
    return NextResponse.json({ bank_details: profile.bank_details });
  } catch (error) {
    console.error('[api/profile/bank] Error fetching bank details:', error.message);
    return NextResponse.json({ error: 'Failed to fetch bank details.' }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { account_holder_name, bank_name, account_number, ifsc_code } = body;

    const bankDetails = await updateBankDetails(session.user.id, {
      account_holder_name,
      bank_name,
      account_number,
      ifsc_code,
    });

    return NextResponse.json({
      success: true,
      bank_details: bankDetails,
      message: 'Bank details saved successfully.',
    });
  } catch (error) {
    console.error('[api/profile/bank] Error saving bank details:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to save bank details.' },
      { status: 400 }
    );
  }
}

