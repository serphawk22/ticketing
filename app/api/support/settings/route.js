import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const SUPPORT_KEYS = [
  'support_team_name',
  'support_email',
  'support_phone',
  'support_website',
  'support_hours',
  'support_location',
  'support_notes',
];

export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const placeholders = SUPPORT_KEYS.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`
    )
    .all(...SUPPORT_KEYS);

  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  let email = settings.support_email?.trim() || '';
  let teamName = settings.support_team_name?.trim() || '';
  let phone = settings.support_phone?.trim() || '';
  let website = settings.support_website?.trim() || '';
  let hours = settings.support_hours?.trim() || '';
  let location = settings.support_location?.trim() || '';
  let notes = settings.support_notes?.trim() || '';

  // Authentic defaults from SerpHawk
  if (!email) {
    const admin = await db
      .prepare(
        `SELECT name, email FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`
      )
      .get();

    if (admin && admin.email) {
      email = admin.email;
    } else {
      email = 'crm@serphawk.in';
    }
  }

  if (!teamName) teamName = 'SerpHawk Support & Help Desk';
  if (!phone) phone = '+91 63602 70684';
  if (!website) website = 'https://serphawk.com';
  if (!hours) hours = 'Monday – Saturday, 9:30 AM – 6:30 PM IST';
  if (!location) location = 'BTM Layout 1st Stage, Bengaluru, Karnataka 560029';
  if (!notes) {
    notes = 'Typical response within 2–4 hours during business hours. For software issues, submit via Report a Bug.';
  }

  return NextResponse.json({
    team_name: teamName,
    email,
    phone,
    website,
    hours,
    location,
    notes,
    isAdmin: session.user.role === 'admin',
  });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Only administrators can update support contact settings.' },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const teamName = String(body.team_name ?? '').trim();
  const email = String(body.email ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  const website = String(body.website ?? '').trim();
  const hours = String(body.hours ?? '').trim();
  const location = String(body.location ?? '').trim();
  const notes = String(body.notes ?? '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid support email address is required.' }, { status: 400 });
  }

  if (!teamName) {
    return NextResponse.json({ error: 'Support team name is required.' }, { status: 400 });
  }

  const entries = [
    ['support_team_name', teamName, 'Support team or contact person name'],
    ['support_email', email, 'Public internal support email'],
    ['support_phone', phone, 'Official contact phone or helpline'],
    ['support_website', website, 'Official company or support website'],
    ['support_hours', hours, 'Working hours for support availability'],
    ['support_location', location, 'Office address or city location'],
    ['support_notes', notes, 'Additional support guidelines or internal chat links'],
  ];

  const upsertStmt = db.prepare(`
    INSERT INTO app_settings (key, value, description, updated_at, updated_by)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      description = excluded.description,
      updated_at = datetime('now'),
      updated_by = excluded.updated_by
  `);

  for (const [key, value, description] of entries) {
    await upsertStmt.run(key, value, description, session.user.id);
  }

  return NextResponse.json({
    ok: true,
    settings: {
      team_name: teamName,
      email,
      phone,
      website,
      hours,
      location,
      notes,
    },
  });
}
