import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { demoSignIn, safeNext } from '@/lib/demo-signin';
import { SESSION_COOKIE, readSession, sessionCookieOptions } from '@/lib/session';
import { rateLimitCaller } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/demo?next=/demo
 *
 * The door judges walk through. Judging is asynchronous and nobody narrates, so
 * a link that lands on a sign-in form loses the visitor before the product has
 * said anything. The middleware sends a signed-out visitor to `/demo` here; this
 * starts the same demo-owner session the button on /login starts, and sends
 * them back.
 *
 * It grants nothing the button does not already grant to anyone who presses it.
 * Two things keep a GET that sets a cookie harmless: it never replaces a session
 * that already exists, so it cannot be used to log somebody out of their own
 * account, and `next` is only ever a path on this site.
 */
function baseUrl(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  return (
    process.env.PUBLIC_BASE_URL ??
    (forwardedHost
      ? `${request.headers.get('x-forwarded-proto') ?? 'https'}://${forwardedHost}`
      : new URL(request.url).origin)
  );
}

export async function GET(request: Request) {
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  const base = baseUrl(request);
  const loginUrl = new URL(`/login?next=${encodeURIComponent(next)}`, base);

  const existing = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (existing) return NextResponse.redirect(new URL(next, base));

  if (!rateLimitCaller(request, 'auth:demo', 60, 600)) return NextResponse.redirect(loginUrl);

  const result = await demoSignIn();
  // Not available, or not seeded: the ordinary sign-in page explains itself.
  if (!result.ok) return NextResponse.redirect(loginUrl);

  const response = NextResponse.redirect(new URL(next, base));
  response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(request));
  return response;
}
