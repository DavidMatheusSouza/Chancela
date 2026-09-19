import { z } from 'zod';
import { issueChallenge } from '@/lib/siwe';
import { fail, ok, rateLimit } from '@/lib/http';

export const dynamic = 'force-dynamic';

const schema = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).strict();

export async function POST(request: Request) {
  if (!rateLimit('auth:nonce', 30)) {
    return fail(429, 'RATE_LIMITED', 'Too many sign-in attempts');
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, 'INVALID_BODY', 'address is required');

  const { nonce, message } = issueChallenge(parsed.data.address);
  return ok({ nonce, message });
}
