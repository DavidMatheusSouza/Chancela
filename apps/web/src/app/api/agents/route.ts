import { cookies } from 'next/headers';
import { createAgentSchema } from '@chancela/shared';
import { getRepository } from '@/lib/store';
import { createAgentFor } from '@/lib/create-agent';
import { SESSION_COOKIE, readSession } from '@/lib/session';
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

  // The middleware guarantees a session exists; this reads whose it is.
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'Sign in to use this endpoint');

  const repo = await getRepository();
  const { agent, policy } = await createAgentFor(repo, {
    ownerAddress: session.address,
    name: parsed.data.name,
    description: parsed.data.description,
    permissions: parsed.data.permissions,
  });

  return ok({ agent, policy });
}
