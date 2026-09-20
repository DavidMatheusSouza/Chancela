import { cookies } from 'next/headers';
import { getAddress } from 'viem';
import { SESSION_COOKIE, readSession } from '@/lib/session';
import { getRepository } from '@/lib/store';
import { Badge, Empty } from '@/components/primitives';
import { KeyRing } from './key-ring';

export const dynamic = 'force-dynamic';

/**
 * Keys.
 *
 * Lists the agents the signed-in owner holds, and nothing else: a derivation
 * index only means something under the passkey of the person it belongs to.
 */
export default async function KeysPage() {
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  const repo = await getRepository();
  const all = await repo.listAgents();
  const mine = session
    ? all.filter((a) => getAddress(a.ownerAddress) === getAddress(session.address))
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">One passkey, many keys</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-muted">
            A single passkey derives your owner key and a separate key for each agent. No seed
            phrase exists to be written down, leaked or lost.
          </p>
        </div>
        <Badge tone="chain">mera · WebAuthn PRF · BIP-32</Badge>
      </header>

      {mine.length === 0 ? (
        <Empty title="No agents under this identity" hint="Keys are derived per agent you own." />
      ) : (
        <KeyRing
          ownerAddress={session!.address}
          agents={mine.map((a) => ({
            id: a.id,
            name: a.name,
            derivationIndex: a.derivationIndex,
            walletAddress: a.walletAddress,
            walletProvider: a.walletProvider,
          }))}
        />
      )}
    </div>
  );
}
