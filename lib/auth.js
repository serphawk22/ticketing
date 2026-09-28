import { cookies } from 'next/headers';
import { db } from './db';

const SESSION_COOKIE = 'ticket_session';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export async function createSession(userId) {
  const token = crypto.randomUUID();

  await db
    .prepare(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
    )
    .run(token, userId, Date.now() + SESSION_TTL);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL / 1000,
  });
  return token;
}

export async function destroySession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .get(token);
  if (!session) return null;
  if (Date.now() > session.expires_at) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  const user = await db
    .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
    .get(session.user_id);
  if (!user) return null;

  const employee = await db
    .prepare('SELECT id FROM employees WHERE email = ?')
    .get(user.email);

  return { user: { ...user, employee_id: employee?.id ?? null } };
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) return null;
  return session;
}