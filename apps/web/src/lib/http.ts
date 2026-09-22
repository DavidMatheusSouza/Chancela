import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

export function ok<T>(data: T, requestId = randomUUID()): NextResponse {
  return NextResponse.json(data, { headers: { 'x-request-id': requestId } });
}

export function fail(status: number, code: string, message: string, extra?: unknown): NextResponse {
  return NextResponse.json({ error: { code, message, ...(extra ? { detail: extra } : {}) } }, { status });
}

/**
 * Who is asking.
 *
 * Cloudflare sets `cf-connecting-ip` and the origin listens on loopback only,
 * so the header cannot be supplied by the client. Without a proxy in front
 * there is no trustworthy address, and everyone shares one identity.
 */
export function callerKey(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'direct'
  );
}

/** Minimal in-process rate limiter. Per key, per window. */
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Keys are partly caller-controlled (an address, an approval id, a client IP),
 * so the map is swept of dead windows before it is allowed to grow further.
 * Without this it only ever gets bigger, over a judging period measured in
 * weeks.
 */
const MAX_BUCKETS = 10_000;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export function rateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/**
 * Rate limit a public endpoint per caller, with a global ceiling behind it.
 *
 * A single shared bucket on an unauthenticated endpoint is not a rate limit,
 * it is a denial-of-service switch: whoever spends the allowance first locks
 * out everybody else. That matters most on exactly the endpoints that had one
 * -- sign-in and the demo door -- because the people it locks out are the
 * judges, and the failure is silent to them.
 *
 * So the caller's own allowance is checked first and the shared one second,
 * set high enough that it only ever catches a flood from many addresses at
 * once. Both are consumed on a request that passes, which is the point: the
 * ceiling has to see the traffic to be a ceiling.
 */
export function rateLimitCaller(
  request: Request,
  name: string,
  perCaller: number,
  ceiling: number,
  windowMs = 60_000,
): boolean {
  if (!rateLimit(`${name}@${callerKey(request)}`, perCaller, windowMs)) return false;
  return rateLimit(name, ceiling, windowMs);
}

/** Test seam: forget every window. */
export function clearRateLimits(): void {
  buckets.clear();
}
