import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

export function ok<T>(data: T, requestId = randomUUID()): NextResponse {
  return NextResponse.json(data, { headers: { 'x-request-id': requestId } });
}

export function fail(status: number, code: string, message: string, extra?: unknown): NextResponse {
  return NextResponse.json({ error: { code, message, ...(extra ? { detail: extra } : {}) } }, { status });
}

/** Minimal in-process rate limiter. Per agent, per window. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
