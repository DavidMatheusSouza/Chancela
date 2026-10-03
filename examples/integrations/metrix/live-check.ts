/**
 * Runs the gate from the Metrix patch against the public deployment, with the
 * shape of order Metrix produces. No key, no account:
 *
 *   pnpm tsx --tsconfig examples/integrations/metrix/tsconfig.json examples/integrations/metrix/live-check.ts
 */
process.env.CHANCELA_AGENT_ID = 'TA-LIVE';
process.env.CHANCELA_TOKEN_ID = '4';

async function main() {
  const { withChancela, toPlaceOrder } = await import('./chancela-gate');
  const base = {
    clientOrderId: `metrix-${Date.now()}`,
    venue: 'kuru',
    market: 'MON/USDC',
    side: 'buy',
    type: 'market',
    strategy: 'grid',
    reason: 'live check',
  } as const;

  for (const [label, size] of [['$200 ', '200'], ['$2,000', '2000']] as const) {
    const intent = { ...base, price: '1', size };
    try {
      const r = await withChancela(intent, async () => 'SENT to the venue');
      console.log(`${label} order (${toPlaceOrder(intent).amount} cents): ${r}`);
    } catch (err) {
      console.log(`${label} order: ${(err as Error).message}`);
    }
  }
  const sim = await withChancela({ ...base, venue: 'sim', price: '1', size: '999999' }, async () => 'sim untouched');
  console.log(`sim order: ${sim}`);
}

main();
