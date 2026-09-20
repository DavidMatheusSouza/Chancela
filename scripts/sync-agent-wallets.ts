/**
 * Write each agent's bound wallet to the policy registry.
 *
 * Binding a passkey-derived key on `/keys` proves possession to the service and
 * stores the address -- off-chain. The registry keeps its own `agentWalletOf`,
 * which is what `setAttestor` is checked against and what anyone outside this
 * service can read, and only the token owner may change it. That owner key is
 * never loaded by the running service (docs/SECURITY.md), so the last step is
 * this script, run by hand:
 *
 *   pnpm tsx scripts/sync-agent-wallets.ts                  # show what would change
 *   pnpm tsx scripts/sync-agent-wallets.ts --send           # change it
 *   pnpm tsx scripts/sync-agent-wallets.ts --send TA-001    # one agent only
 *
 * It reads agents from the deployment's own public API rather than the
 * database, so what goes on-chain is exactly what the passport shows.
 */
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = process.env.MONAD_TESTNET_RPC_URL ?? process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const POLICY = process.env.POLICY_REGISTRY_ADDRESS as Hex;
const DEPLOYER = process.env.DEPLOYER_PRIVATE_KEY as Hex;
const API = process.env.SYNC_API_URL ?? 'http://127.0.0.1:3080';

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});

const POLICY_ABI = [
  {
    type: 'function',
    name: 'setAgentWallet',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentTokenId', type: 'uint256' },
      { name: 'wallet', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'agentWalletOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const;

interface ApiAgent {
  id: string;
  name: string;
  erc8004TokenId?: string | null;
  walletAddress?: string | null;
  walletProvider?: string | null;
}

async function fetchAgent(id: string): Promise<ApiAgent> {
  const res = await fetch(`${API}/api/agents/${id}`);
  if (!res.ok) throw new Error(`${id}: ${API} answered ${res.status}`);
  const { agent } = (await res.json()) as { agent?: ApiAgent };
  if (!agent) throw new Error(`${id}: no agent in the response`);
  return agent;
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const ids = args.filter((a) => !a.startsWith('--'));
  if (ids.length === 0) ids.push('TA-001', 'TA-002', 'TA-003');

  for (const [name, value] of Object.entries({ POLICY, DEPLOYER })) {
    if (!value) throw new Error(`Missing env: ${name}`);
  }

  const owner = privateKeyToAccount(DEPLOYER);
  const client = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ account: owner, chain: monadTestnet, transport: http(RPC) });

  console.log(`registry  ${POLICY}`);
  console.log(`owner     ${owner.address}`);
  console.log(`source    ${API}`);
  console.log(send ? '' : 'dry run -- pass --send to write\n');

  let pending = 0;
  for (const id of ids) {
    const agent = await fetchAgent(id);
    console.log(`${agent.id}  ${agent.name}`);

    if (!agent.erc8004TokenId) {
      console.log('  skipped     not registered on-chain\n');
      continue;
    }
    // Only a key that proved possession is worth publishing. Seeded and
    // hand-typed addresses carry no such proof, and the registry entry is the
    // one place an outsider will take the address at its word.
    if (agent.walletProvider !== 'MERA' || !agent.walletAddress || !isAddress(agent.walletAddress)) {
      console.log('  skipped     no passkey-derived key bound\n');
      continue;
    }

    const tokenId = BigInt(agent.erc8004TokenId);
    const bound = getAddress(agent.walletAddress);
    const onchain = await client.readContract({
      address: POLICY,
      abi: POLICY_ABI,
      functionName: 'agentWalletOf',
      args: [tokenId],
    });

    console.log(`  tokenId     #${tokenId}`);
    console.log(`  bound       ${bound}`);
    console.log(`  on-chain    ${onchain}`);

    if (getAddress(onchain) === bound) {
      console.log('  in sync\n');
      continue;
    }

    // Simulate even on a dry run: a revert here (not the owner, or the address
    // is the attestor) is worth knowing before anyone reaches for --send.
    const { request } = await client.simulateContract({
      account: owner,
      address: POLICY,
      abi: POLICY_ABI,
      functionName: 'setAgentWallet',
      args: [tokenId, bound],
    });

    if (!send) {
      pending++;
      console.log('  would set   simulation passed\n');
      continue;
    }

    const tx = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash: tx });
    const after = await client.readContract({
      address: POLICY,
      abi: POLICY_ABI,
      functionName: 'agentWalletOf',
      args: [tokenId],
    });
    const match = receipt.status === 'success' && getAddress(after) === bound;
    console.log(`  set         ${match ? 'verified on-chain' : 'MISMATCH'}`);
    console.log(`  tx          https://testnet.monadexplorer.com/tx/${tx}\n`);
    if (!match) throw new Error(`On-chain wallet does not match for ${agent.id}`);
  }

  if (!send && pending > 0) console.log(`${pending} agent(s) would change. Re-run with --send.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
