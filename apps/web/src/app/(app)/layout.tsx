import { Sidebar } from '@/components/sidebar';
import { activeChain } from '@/lib/chain';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const chain = activeChain();
  return (
    <div className="flex min-h-screen">
      <Sidebar chainName={chain.name} chainId={chain.id} />
      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
