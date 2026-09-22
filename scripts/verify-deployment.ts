/**
 * Check that the addresses this deployment is configured with are real, are
 * the contracts the app thinks they are, and match what the docs claim.
 *
 * Written after the README was found advertising a policy registry the service
 * had stopped using: both were deployed, both held the same policy hashes, and
 * nothing in the repository noticed that decisions were being anchored
 * somewhere else. A judge following the README would have verified an idle
 * contract.
 *
 *   pnpm verify:deployment
 *
 * Reads only. Spends no gas, needs no key, and exits non-zero if anything it
 * checks does not hold -- so it can sit in CI.
 */
import { createPublicClient, defineChain, http, type Hex } from 'viem';
import { readFileSync } from 'node:fs';

/**
 * Read the addresses out of .env, the way the running service does.
 *
 * Without this the script is only correct for whoever remembers to export the
 * environment first: it reported "not configured" three times over against a
 * deployment that was live and healthy, which is worse than not checking, since
 * it teaches the reader to ignore it. Anything already in the environment wins,
 * so CI can point it at another deployment without editing a file.
 */
function loadEnvFile(): void {
  let text: string;
  try {
    text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    return; // No .env is normal in CI; the environment is expected to carry it.
  }
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadEnvFile();

const RPC = process.env.MONAD_RPC_URL ?? process.env.MONAD_TESTNET_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143);

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 143 ? 'Monad' : 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const POLICY_ABI = [
  {
    type: 'function',
    name: 'activePolicy',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [
      { name: 'policyHash', type: 'bytes32' },
      { name: 'version', type: 'uint32' },
      { name: 'anchoredAt', type: 'uint64' },
    ],
  },
] as const;

const APPROVALS_ABI = [
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

const problems: string[] = [];
const note = (line: string) => console.log(line);

function fail(line: string): void {
  problems.push(line);
  console.log(`  FAIL  ${line}`);
}

async function main(): Promise<void> {
  const client = createPublicClient({ chain, transport: http(RPC, { timeout: 20_000 }) });

  const policyRegistry = process.env.POLICY_REGISTRY_ADDRESS as Hex | undefined;
  const identityRegistry = process.env.ERC8004_IDENTITY_REGISTRY as Hex | undefined;
  const approvals = process.env.APPROVALS_ADDRESS as Hex | undefined;

  note(`chain     ${chain.name} (${CHAIN_ID})`);
  note(`rpc       ${RPC}`);
  note(`block     ${await client.getBlockNumber()}\n`);

  // 1. Every configured address holds code.
  for (const [name, address] of Object.entries({ policyRegistry, identityRegistry, approvals })) {
    if (!address) {
      fail(`${name} is not configured`);
      continue;
    }
    const code = await client.getBytecode({ address });
    if (!code || code === '0x') fail(`${name} ${address} holds no bytecode`);
    else note(`  ok    ${name.padEnd(16)} ${address}  ${(code.length - 2) / 2} bytes`);
  }

  // 2. The policy registry answers, and holds a policy for each demo agent.
  if (policyRegistry) {
    for (const tokenId of [1n, 2n, 3n]) {
      try {
        const [policyHash, version, anchoredAt] = await client.readContract({
          address: policyRegistry,
          abi: POLICY_ABI,
          functionName: 'activePolicy',
          args: [tokenId],
        });
        if (anchoredAt === 0n) fail(`token ${tokenId} has no anchored policy on ${policyRegistry}`);
        else note(`  ok    token ${tokenId}         v${version}  ${policyHash.slice(0, 18)}…  anchored ${anchoredAt}`);
      } catch (err) {
        fail(`activePolicy(${tokenId}) reverted: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  }

  // 3. The approvals contract answers the one call the service makes read-only.
  if (approvals) {
    try {
      const [x] = await client.readContract({
        address: approvals,
        abi: APPROVALS_ABI,
        functionName: 'approverOf',
        args: [1n],
      });
      const enrolled = !/^0x0{64}$/.test(x);
      note(`  ok    approverOf(1)    ${enrolled ? `${x.slice(0, 18)}…` : 'no approver registered yet'}`);
    } catch (err) {
      fail(`approverOf(1) reverted: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  // 4. The docs agree with the configuration.
  try {
    const recorded = JSON.parse(readFileSync(new URL('../packages/contracts/deployments/10143.json', import.meta.url), 'utf8'));
    const pairs: Array<[string, string | undefined, string | undefined]> = [
      ['policyRegistry', policyRegistry, recorded.policyRegistry],
      ['identityRegistry', identityRegistry, recorded.identityRegistry],
      ['approvals', approvals, recorded.approvals],
    ];
    for (const [name, configured, documented] of pairs) {
      if (configured && documented && configured.toLowerCase() !== documented.toLowerCase()) {
        fail(`${name}: .env has ${configured}, deployments/10143.json has ${documented}`);
      }
    }
    note('  ok    deployments/10143.json matches the environment');
  } catch (err) {
    fail(`could not read deployments/10143.json: ${(err as Error).message}`);
  }

  console.log();
  if (problems.length > 0) {
    console.error(`${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('Everything checked holds.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
