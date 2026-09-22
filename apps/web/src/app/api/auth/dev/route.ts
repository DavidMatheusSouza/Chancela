import { cookies } from 'next/headers';
import { demoSignIn } from '@/lib/demo-signin';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import { fail, ok, rateLimitCaller } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Demo sign-in as the seeded owner, from the button on /login. See lib/demo-signin. */
export async function POST(request: Request) {
  if (!rateLimitCaller(request, 'auth:dev', 20, 200)) return fail(429, 'RATE_LIMITED', 'Too many attempts');

  const result = await demoSignIn();
  if (!result.ok) return fail(result.status, result.code, result.message);

  cookies().set(SESSION_COOKIE, result.token, sessionCookieOptions(request));
  return ok({ address: result.address });
}
