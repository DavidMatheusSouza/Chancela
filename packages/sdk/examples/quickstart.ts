/**
 * Five-minute integration, runnable as is:
 *
 *   pnpm tsx packages/sdk/examples/quickstart.ts
 *
 * It talks to the public deployment and to Monad testnet, needs no account and
 * no key, and trusts neither: the permission is checked against the attestor
 * the agent's owner registered on-chain.
 */
import { ChancelaError, attestorFromRegistry, createClient } from '../src/index';

const chancela = createClient({
  baseUrl: process.env.CHANCELA_API_URL ?? 'https://chancela.xyz',
  attestor: attestorFromRegistry({
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    registry: '0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e',
    tokenId: (agentId) => BigInt(Number(agentId.replace('TA-', ''))),
  }),
});

async function attempt(action: string, parameters: Record<string, unknown>) {
  try {
    // The callback is your code. It runs only if the policy allows the action
    // AND the signed permission verifies locally.
    const result = await chancela.guard('TA-001', action, parameters, (decision) => {
      return `did it -- audit ${decision.auditId}, policy v${decision.policyVersion}`;
    });
    console.log(`${action}: ${result}`);
  } catch (err) {
    if (!(err instanceof ChancelaError)) throw err;
    console.log(`${action}: stopped -- ${err.code}: ${err.message}`);
  }
}

await attempt('CREATE_CUSTOMER', { name: 'Maria Souza' });
await attempt('TRANSFER_FUNDS', { amount: 5000, recipientAddress: '0x000000000000000000000000000000000000dEaD' });
