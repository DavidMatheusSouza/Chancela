/**
 * Send one allowed order through ChancelaGate, end to end, from outside the
 * service: ask the public deployment, have the attestor sign the grant, send it
 * from the agent's wallet to the demo venue. Proves the ALLOW path on Monad.
 *
 *   set -a; . ./.env; set +a; pnpm tsx scripts/place-allowed-order.ts [amountCents]
 */
import { GRANT_TYPES, grantDomain, orderCallHash, type Hex } from '../packages/shared/src/index';
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const API = process.env.CHANCELA_API_URL ?? 'https://chancela.xyz';
const RPC = process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const gate = process.env.GATE_ADDRESS as Hex;
const venue = process.env.DEMO_VENUE_ADDRESS as Hex;
const attestor = privateKeyToAccount(process.env.ATTESTATION_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.LIVE_AGENT_PRIVATE_KEY as Hex);
const chain = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const order = { amount: Number(process.argv[2] ?? 20_000), currency: 'USD', market: 'MON/USDC', side: 'BUY', orderType: 'MARKET' };
async function main() {
  const res = await fetch(`${API}/api/agents/TA-LIVE/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'PLACE_ORDER', parameters: order }),
  });
  const d = await res.json();
  console.log('decision', d.decision, d.reasonCode, d.auditId);
  if (d.decision !== 'ALLOW') process.exit(1);

  const grant = {
    agentTokenId: 4n, target: venue,
    callHash: orderCallHash({ market: order.market, side: order.side, amount: order.amount }),
    decisionHash: d.decisionHash as Hex, policyHash: d.policyHash as Hex, expiresAt: BigInt(d.expiresAt),
  };
  const signature = await attestor.signTypedData({ domain: grantDomain(chain.id, gate), types: GRANT_TYPES, primaryType: 'Grant', message: grant });
  const abi = parseAbi([
    'function placeOrder(string market, string side, uint256 amount, (uint256 agentTokenId, address target, bytes32 callHash, bytes32 decisionHash, bytes32 policyHash, uint64 expiresAt) grant, bytes signature) returns (uint256)',
    'function orderCount() view returns (uint256)',
    'error Refused(uint8 reason)',
  ]);
  const client = createPublicClient({ chain, transport: http(RPC), pollingInterval: 500 });
  const wallet = createWalletClient({ account: agent, chain, transport: http(RPC) });
  const call = { address: venue, abi, functionName: 'placeOrder', args: [order.market, order.side, BigInt(order.amount), grant, signature], account: agent } as const;
  await client.simulateContract(call);
  const hash = await wallet.writeContract({ ...call, gas: 250_000n });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 30_000 });
  console.log('tx', hash, receipt.status, 'block', receipt.blockNumber, 'gasUsed', receipt.gasUsed);
  console.log('venue orderCount', await client.readContract({ address: venue, abi, functionName: 'orderCount' }));
}
main();
