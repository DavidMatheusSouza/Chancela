import { executeRequestSchema } from '@chancela/shared';
import { execute } from '@/lib/executor';
import { fail, ok, rateLimit } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/:id/actions
 *
 * Takes a capsule, never an intent. Refuses anything it cannot verify.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!rateLimit(`execute:${params.id}`, 60)) {
    return fail(429, 'RATE_LIMITED', 'Too many execution requests for this agent');
  }

  const body = await request.json().catch(() => null);
  const parsed = executeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'INVALID_BODY', 'Request body failed validation', parsed.error.issues);
  }

  const result = await execute({
    agentId: params.id,
    capsule: parsed.data.capsule,
    signature: parsed.data.signature,
    parameters: parsed.data.parameters,
  });

  if (!result.ok) return fail(403, result.code, result.detail ?? 'Execution refused');
  return ok(result);
}
