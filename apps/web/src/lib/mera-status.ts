import type { Repository } from './repository';

/**
 * What the mera integration has actually done, read from the store.
 *
 * It used to be `NEXT_PUBLIC_MERA_ENABLED === 'true'`: set a flag, get a green
 * dot, with nothing behind it -- precisely the decorative status this project
 * says it does not have. A bound key is the real evidence: it only exists if a
 * passkey-derived key signed a proof of possession the server verified.
 */
export async function meraStatus(repo: Repository): Promise<{
  status: 'CONNECTED' | 'NOT_CONFIGURED';
  detail: string;
}> {
  const agents = await repo.listAgents();
  const bound = agents.filter((a) => a.walletProvider === 'MERA' && a.walletAddress).length;
  return bound > 0
    ? {
        status: 'CONNECTED',
        detail: `${bound} agent key${bound === 1 ? '' : 's'} bound, each with a verified proof of possession`,
      }
    : { status: 'NOT_CONFIGURED', detail: 'Available — no passkey-derived key bound yet. Open Keys.' };
}
