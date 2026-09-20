import { authorizeRequestSchema } from '@chancela/shared';
import { AuthorizeError, authorize } from '@/lib/authorize';
import { callerKey } from '@/lib/anchor-budget';
import { fail, ok, rateLimit } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/:id/authorize
 *
 * The endpoint that makes Chancela infrastructure rather than an app: any
 * agent runtime, anywhere, can call this before it acts. It returns a signed
 * capsule, not a boolean, so the answer cannot be forged downstream.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!rateLimit(`authorize:${params.id}`, 120)) {
    return fail(429, 'RATE_LIMITED', 'Too many authorization requests for this agent');
  }

  const body = await request.json().catch(() => null);
  const parsed = authorizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'INVALID_BODY', 'Request body failed validation', parsed.error.issues);
  }

  try {
    const result = await authorize({
      agentId: params.id,
      action: parsed.data.action,
      parameters: parsed.data.parameters,
      environment: parsed.data.context.environment,
      requestId: parsed.data.context.requestId,
      caller: callerKey(request),
    });
    return ok(result);
  } catch (err) {
    if (err instanceof AuthorizeError) return fail(err.status, 'AUTHORIZE_FAILED', err.message);
    if (err instanceof Error && err.message.includes('ATTESTATION_PRIVATE_KEY')) {
      return fail(503, 'ATTESTOR_UNCONFIGURED', err.message);
    }
    return fail(500, 'INTERNAL', 'Authorization failed');
  }
}
