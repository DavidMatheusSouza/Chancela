/**
 * Register each agent's approver passkey on-chain.
 *
 * An owner enrols a passkey on /approvals; its P-256 public key is published on
 * the agent's passport. ChancelaApprovals only accepts approvals signed by the
 * key its on-chain owner registered, and that owner key is never loaded by the
 * running service, so -- like sync-agent-wallets.ts -- the last step is by hand:
 *
 *   pnpm tsx scripts/set-approver.ts            # show what would change
 *   pnpm tsx scripts/set-approver.ts --send     # change it
 */
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = process.env.MONAD_TESTNET_RPC_URL ?? process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const APPROVALS = process.env.APPROVALS_ADDRESS as Hex;
const DEPLOYER = process.env.DEPLOYER_PRIVATE_KEY as Hex;
const API = process.env.SYNC_API_URL ?? 'http://127.0.0.1:3080';

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  testnet: true,
});

const ABI = [
  {
    type: 'function',
    name: 'setApprover',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentTokenId', type: 'uint256' },
      { name: 'x', type: 'bytes32' },
      { name: 'y', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'approverOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [
      { name: 'x', type: 'bytes32' },
      { name: 'y', type: 'bytes32' },
    ],
  },
] as const;

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const ids = args.filter((a) => !a.startsWith('--'));
  if (ids.length === 0) ids.push('TA-001', 'TA-002', 'TA-003');
  for (const [name, value] of Object.entries({ APPROVALS_ADDRESS: APPROVALS, DEPLOYER_PRIVATE_KEY: DEPLOYER })) {
    if (!value) throw new Error(`Missing env: ${name}`);
  }

  const owner = privateKeyToAccount(DEPLOYER);
  const client = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ account: owner, chain: monadTestnet, transport: http(RPC) });
  console.log(`approvals ${APPROVALS}\nowner     ${owner.address}\nsource    ${API}\n${send ? '' : 'dry run -- pass --send to write\n'}`);

  for (const id of ids) {
    const res = await fetch(`${API}/api/agents/${id}`);
    if (!res.ok) throw new Error(`${id}: ${API} answered ${res.status}`);
    const { agent, approver } = (await res.json()) as {
      agent: { id: string; name: string; erc8004TokenId?: string | null };
      approver: { x: Hex; y: Hex } | null;
    };
    console.log(`${agent.id}  ${agent.name}`);
    if (!agent.erc8004TokenId) { console.log('  skipped     not registered on-chain\n'); continue; }
    if (!approver) { console.log('  skipped     its owner has not enrolled an approver passkey\n'); continue; }

    const tokenId = BigInt(agent.erc8004TokenId);
    const [x, y] = await client.readContract({ address: APPROVALS, abi: ABI, functionName: 'approverOf', args: [tokenId] });
    if (x.toLowerCase() === approver.x.toLowerCase() && y.toLowerCase() === approver.y.toLowerCase()) {
      console.log('  in sync\n');
      continue;
    }
    const { request } = await client.simulateContract({
      account: owner, address: APPROVALS, abi: ABI, functionName: 'setApprover', args: [tokenId, approver.x, approver.y],
    });
    if (!send) { console.log(`  would set   ${approver.x.slice(0, 18)}…  simulation passed\n`); continue; }
    const tx = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash: tx });
    console.log(`  set         ${receipt.status}\n  tx          https://testnet.monadexplorer.com/tx/${tx}\n`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
