/**
 * A trading agent's order path, with Chancela in front of it. Runnable as is,
 * against the public deployment and Monad testnet -- no account, no key:
 *
 *   pnpm tsx examples/trading-agent/guard-order.ts
 *
 * In your own project: `npm install chancela-sdk viem` and import from
 * 'chancela-sdk' instead of the relative path below.
 */
import { ChancelaError, attestorFromRegistry, createClient } from '../../packages/sdk/src/index';

const chancela = createClient({
  baseUrl: process.env.CHANCELA_API_URL ?? 'https://chancela.xyz',
  // Whose signature counts is read from Monad, not from the server being checked.
  attestor: attestorFromRegistry({
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    registry: '0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e',
    tokenId: (agentId) => ({ 'TA-LIVE': 4n })[agentId] ?? 0n,
  }),
});

/** Public demo agent: PLACE_ORDER up to $500 per order, nothing that moves funds out. */
const AGENT = process.env.CHANCELA_AGENT_ID ?? 'TA-LIVE';

interface Order {
  amount: number; // notional in cents -- what the limits count
  market: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  price?: string; // decimal string, never a float
}

/** Your exchange / router call. It only ever runs inside guard(). */
async function sendToExchange(order: Order): Promise<string> {
  return `sent ${order.side} ${order.market} $${(order.amount / 100).toFixed(2)}`;
}

/** The one change to an existing agent: wrap the call that places the order. */
async function placeOrder(order: Order): Promise<string> {
  return chancela.guard(AGENT, 'PLACE_ORDER', { ...order }, () => sendToExchange(order));
}

async function attempt(label: string, order: Order) {
  try {
    console.log(`${label}: ${await placeOrder(order)}`);
  } catch (err) {
    if (!(err instanceof ChancelaError)) throw err;
    // DENIED, APPROVAL_REQUIRED, UNREACHABLE, UNVERIFIED_* -- all mean "not sent".
    console.log(`${label}: NOT SENT -- ${err.code}: ${err.message}`);
  }
}

async function main() {
  await attempt('$200 order  ', { amount: 20_000, market: 'MON/USDC', side: 'BUY', orderType: 'MARKET' });
  await attempt('$2,000 order', { amount: 200_000, market: 'MON/USDC', side: 'BUY', orderType: 'MARKET' });

  // The permission is bound to the order's hash: change the order after the check
  // and it no longer verifies.
  const asked = { amount: 20_000, market: 'MON/USDC', side: 'SELL', orderType: 'MARKET' };
  const decision = await chancela.authorize(AGENT, 'PLACE_ORDER', asked);
  const verdict = await chancela.verify(decision, {
    agentId: AGENT,
    action: 'PLACE_ORDER',
    parameters: { ...asked, amount: 2_000_000 },
  });
  console.log(`swapped order: ${decision.decision} for $200, then ${verdict.code} for $20,000`);
  console.log(`proof: https://chancela.xyz/proof/${decision.auditId}`);
}

main();
