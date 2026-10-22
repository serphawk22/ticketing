import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getUserProfile, updatePersonalProfile } from '@/lib/profiles';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = await getUserProfile(session.user.id);
    if (!profile) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }
    return NextResponse.json({ profile });
  } catch (error) {
    console.error('[api/profile] Error loading profile:', error.message);
    return NextResponse.json({ error: 'Failed to load profile.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Security: Only allow personal fields to be modified
    // Rejects or ignores any attempt to change role, email, base_salary, etc.
    const { name, age, github_url, linkedin_url } = body;

    const updated = await updatePersonalProfile(session.user.id, {
      name,
      age,
      github_url,
      linkedin_url,
    });

    return NextResponse.json({ profile: updated });
  } catch (error) {
    console.error('[api/profile] Error updating profile:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to update profile.' },
      { status: 400 }
    );
  }
}

