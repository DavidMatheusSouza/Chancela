import { hashPolicyDocument, policyDocumentSchema } from '@trustagent/shared';
import { getRepository } from '@/lib/store';
import { fail, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const repo = await getRepository();
  const policies = await repo.listPolicies(params.id);
  return ok({ policies });
}

/**
 * Creating a policy version never edits the previous one.
 *
 * An immutable chain of versions is what makes "which policy was live when this
 * happened" answerable months later. The version number must increase, matching
 * the on-chain rule in TrustAgentPolicyRegistry.anchorPolicy().
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const repo = await getRepository();

  const agent = await repo.getAgent(params.id);
  if (!agent) return fail(404, 'NOT_FOUND', `Unknown agent ${params.id}`);

  const current = await repo.getActivePolicy(params.id);
  const nextVersion = (current?.version ?? 0) + 1;

  const candidate = {
    ...(body as Record<string, unknown>),
    agentId: params.id,
    version: nextVersion,
  };

  const parsed = policyDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    return fail(400, 'INVALID_POLICY', 'Policy failed validation', parsed.error.issues);
  }

  const document = parsed.data;
  const policy = await repo.createPolicy({
    id: `pol_${params.id}_v${nextVersion}`,
    agentId: params.id,
    name: document.name,
    version: nextVersion,
    policyHash: hashPolicyDocument({
      agentId: document.agentId,
      version: document.version,
      permissions: document.permissions,
      limits: document.limits as unknown as Record<string, number>,
      stepUpThreshold: document.stepUpThreshold,
      environment: document.environment as unknown as Record<string, unknown>,
    }),
    document,
    status: 'DRAFT',
  });

  const activated = await repo.activatePolicy(policy.id);
  return ok({ policy: activated });
}
