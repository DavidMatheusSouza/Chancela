import { activeChain, chainConfig } from '@/lib/chain';
import { isDurable } from '@/lib/store';
import { ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok({
    status: 'ok',
    chain: { id: activeChain().id, name: activeChain().name },
    anchoring: chainConfig() ? 'enabled' : 'disabled',
    attestor: process.env.ATTESTATION_PRIVATE_KEY ? 'configured' : 'missing',
    // Stated rather than implied: on the in-memory store the audit trail does
    // not survive a restart, and a health check that hides that is lying.
    storage: isDurable() ? 'postgres' : 'memory (not durable)',
  });
}
