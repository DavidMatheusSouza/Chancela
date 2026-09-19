import { createAgentSchema, hashPolicyDocument } from '@trustagent/shared';
import { getRepository } from '@/lib/store';
import { fail, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const repo = await getRepository();
  const agents = await repo.listAgents();
  const withPolicy = await Promise.all(
    agents.map(async (a) => {
      const policy = await repo.getActivePolicy(a.id);
      return {
        ...a,
        policyVersion: policy?.version ?? 0,
        policyHash: policy?.policyHash ?? null,
        permissions: policy?.document.permissions ?? [],
      };
    }),
  );
  return ok({ agents: withPolicy });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'INVALID_BODY', 'Request body failed validation', parsed.error.issues);
  }

  const repo = await getRepository();
  const existing = await repo.listAgents();
  const id = `TA-${String(existing.length + 1).padStart(3, '0')}`;

  const agent = await repo.createAgent({
    id,
    name: parsed.data.name,
    description: parsed.data.description,
    ownerAddress: process.env.DEMO_OWNER_ADDRESS ?? '0x82f1aA0F3A1b2C3d4e5f60718293a4B5C6D7e891',
    status: 'ACTIVE',
    derivationIndex: existing.length,
    walletProvider: 'MERA',
  });

  // A new agent starts with exactly the permissions it was given and nothing
  // else -- deny by default applies at creation, not just at evaluation.
  const document = {
    agentId: id,
    name: parsed.data.name,
    version: 1,
    permissions: parsed.data.permissions,
    limits: { maxTransactionValue: 0, dailyTransactions: 0, dailyValueCap: 0 },
    stepUpThreshold: 'HIGH' as const,
    environment: {},
  };

  const policy = await repo.createPolicy({
    id: `pol_${id}_v1`,
    agentId: id,
    name: parsed.data.name,
    version: 1,
    policyHash: hashPolicyDocument({
      agentId: id,
      version: 1,
      permissions: document.permissions,
      limits: document.limits as unknown as Record<string, number>,
      stepUpThreshold: document.stepUpThreshold,
      environment: {},
    }),
    document,
    status: 'DRAFT',
  });
  await repo.activatePolicy(policy.id);

  return ok({ agent, policy });
}
