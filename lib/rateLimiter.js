/**
 * Lightweight in-memory sliding-window rate limiter for Task Sheet token exchange,
 * public cookie-backed submission, and amendment endpoints.
 */

const buckets = new Map();

export function checkRateLimit(key, { limit = 20, windowMs = 60_000, nowMs = Date.now() } = {}) {
  const bucketKey = String(key || 'global');
  let timestamps = buckets.get(bucketKey);
  if (!timestamps) {
    timestamps = [];
    buckets.set(bucketKey, timestamps);
  }

  const cutoff = nowMs - windowMs;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= limit) {
    const oldest = timestamps[0] || nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  timestamps.push(nowMs);
  return { allowed: true, remaining: Math.max(0, limit - timestamps.length), retryAfterSeconds: 0 };
}

export function extractClientIpPrefix(request) {
  try {
    const fwd = request?.headers?.get?.('x-forwarded-for') || '';
    const ip = (fwd.split(',')[0] || request?.headers?.get?.('x-real-ip') || 'unknown').trim();
    if (!ip || ip === 'unknown') return 'unknown';
    if (ip.includes('.')) {
      return ip.split('.').slice(0, 3).join('.') + '.0';
    }
    return ip.split(':').slice(0, 4).join(':');
  } catch {
    return 'unknown';
  }
}

export function resetRateLimiter(keyPrefix = null) {
  if (!keyPrefix) {
    buckets.clear();
    return;
  }
  for (const k of buckets.keys()) {
    if (k.startsWith(keyPrefix)) buckets.delete(k);
  }
}
