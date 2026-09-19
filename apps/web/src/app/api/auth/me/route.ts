import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession } from '@/lib/session';
import { fail, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'Not signed in');
  return ok({ address: session.address, method: session.method, expiresAt: session.expiresAt });
}
