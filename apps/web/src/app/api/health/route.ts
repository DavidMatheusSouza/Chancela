import { activeChain, chainConfig } from '@/lib/chain';
import { ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok({
    status: 'ok',
    chain: { id: activeChain().id, name: activeChain().name },
    anchoring: chainConfig() ? 'enabled' : 'disabled',
    attestor: process.env.ATTESTATION_PRIVATE_KEY ? 'configured' : 'missing',
  });
}
