import { NextResponse } from 'next/server';
import {
  TASK_SHEET_CSRF_COOKIE,
  TASK_SHEET_SESSION_COOKIE,
  exchangeTaskSheetToken,
} from '@/lib/taskSheetTokens';
import { checkRateLimit, extractClientIpPrefix } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';

function applySessionCookies(res, result) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookies.set(TASK_SHEET_SESSION_COOKIE, result.sessionSecret, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: result.maxAgeSeconds,
  });
  res.cookies.set(TASK_SHEET_CSRF_COOKIE, result.csrfSecret, {
    httpOnly: false,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: result.maxAgeSeconds,
  });
}

export async function GET(request) {
  const ipPrefix = extractClientIpPrefix(request);
  const rl = checkRateLimit(`ts-exchange:${ipPrefix}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many token verification attempts. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const url = new URL(request.url);
  const rawToken = url.searchParams.get('token') || '';
  const result = await exchangeTaskSheetToken({ rawToken, ipPrefix });

  if (!result) {
    const failUrl = new URL('/task-sheet?token_error=invalid', url.origin);
    return NextResponse.redirect(failUrl, 302);
  }

  const cleanUrl = new URL('/task-sheet', url.origin);
  const res = NextResponse.redirect(cleanUrl, 302);
  applySessionCookies(res, result);
  return res;
}

export async function POST(request) {
  const ipPrefix = extractClientIpPrefix(request);
  const rl = checkRateLimit(`ts-exchange:${ipPrefix}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many token verification attempts. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const result = await exchangeTaskSheetToken({ rawToken: body.token || '', ipPrefix });
  if (!result) {
    return NextResponse.json({ error: 'Invalid, expired, or revoked Task Sheet link.' }, { status: 401 });
  }

  const res = NextResponse.json({
    ok: true,
    employee: result.employee,
    csrfToken: result.csrfSecret,
    expiresAt: result.expiresAt,
  });
  applySessionCookies(res, result);
  return res;
}
