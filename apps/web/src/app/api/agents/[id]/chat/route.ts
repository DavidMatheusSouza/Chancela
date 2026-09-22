import { TOOL_REGISTRY } from '@chancela/shared';
import { resolveProvider } from '@chancela/ai';
import { z } from 'zod';
import { AuthorizeError, authorize } from '@/lib/authorize';
import { getRepository } from '@/lib/store';
import { callerKey, fail, ok, rateLimitCaller } from '@/lib/http';

export const dynamic = 'force-dynamic';

const chatSchema = z
  .object({
    message: z.string().min(1).max(2000),
    provider: z.string().max(20).optional(),
  })
  .strict();

/**
 * POST /api/agents/:id/chat
 *
 * The AI console path: prose in, decision out.
 *
 * The model runs first and its output is treated as a *proposal*. Note that the
 * decision below is produced by exactly the same authorize() call the public API
 * uses -- there is no console-specific shortcut, which is why swapping the model
 * cannot change an outcome.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!rateLimitCaller(request, `chat:${params.id}`, 30, 150)) {
    return fail(429, 'RATE_LIMITED', 'Too many messages for this agent');
  }

  const body = await request.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'INVALID_BODY', 'Request body failed validation', parsed.error.issues);
  }

  const repo = await getRepository();
  const agent = await repo.getAgent(params.id);
  if (!agent) return fail(404, 'NOT_FOUND', `Unknown agent ${params.id}`);

  const provider = resolveProvider(parsed.data.provider);

  let intent;
  try {
    intent = await provider.extractIntent({
      utterance: parsed.data.message,
      toolCatalog: TOOL_REGISTRY,
      agentName: agent.name,
    });
  } catch (err) {
    return fail(
      502,
      'INTENT_EXTRACTION_FAILED',
      err instanceof Error ? err.message : 'provider failed',
    );
  }

  try {
    const decision = await authorize({
      agentId: params.id,
      action: intent.intent.action,
      parameters: intent.intent.parameters,
      ai: {
        provider: intent.provider,
        model: intent.model,
        rawIntent: intent.intent,
      },
      caller: callerKey(request),
    });

    return ok({
      intent: {
        action: intent.intent.action,
        parameters: intent.intent.parameters,
        confidence: intent.intent.confidence,
        rationale: intent.intent.rationale,
        // Surfaced as advisory only. The authoritative value is decision.risk,
        // recomputed by the policy engine from the tool registry.
        suggestedRisk: intent.intent.suggestedRisk ?? null,
      },
      provider: { id: intent.provider, model: intent.model, latencyMs: intent.latencyMs },
      decision,
    });
  } catch (err) {
    if (err instanceof AuthorizeError) return fail(err.status, 'AUTHORIZE_FAILED', err.message);
    if (err instanceof Error && err.message.includes('ATTESTATION_PRIVATE_KEY')) {
      return fail(503, 'ATTESTOR_UNCONFIGURED', err.message);
    }
    return fail(500, 'INTERNAL', 'Authorization failed');
  }
}
