import Link from 'next/link';
import { notFound } from 'next/navigation';
import { availableProviders } from '@chancela/ai';
import { getRepository } from '@/lib/store';
import { Console } from './console';

export const dynamic = 'force-dynamic';

export default async function ConsolePage({ params }: { params: { id: string } }) {
  const repo = await getRepository();
  const agent = await repo.getAgent(params.id);
  if (!agent) notFound();
  const policy = await repo.getActivePolicy(params.id);

  return (
    <div className="mx-auto flex h-screen max-w-4xl flex-col px-8 py-6">
      <Link href={`/agents/${agent.id}`} className="mb-4 text-xs text-muted hover:text-ink">
        &larr; {agent.name}
      </Link>
      <Console
        agentId={agent.id}
        agentName={agent.name}
        policyVersion={policy?.version ?? 0}
        providers={availableProviders()}
      />
    </div>
  );
}
