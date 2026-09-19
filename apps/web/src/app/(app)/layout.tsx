import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { CommandPalette } from '@/components/command-palette';
import { cookies } from 'next/headers';
import { activeChain } from '@/lib/chain';
import { getRepository } from '@/lib/store';
import { SESSION_COOKIE, readSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const chain = activeChain();
  const repo = await getRepository();
  const agents = (await repo.listAgents()).map((a) => ({ id: a.id, name: a.name }));
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);

  return (
    <div className="flex min-h-screen">
      <Sidebar chainName={chain.name} chainId={chain.id} owner={session?.address} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
      </div>
      <CommandPalette agents={agents} explorerUrl={chain.blockExplorers.default.url} />
    </div>
  );
}
