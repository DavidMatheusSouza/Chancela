#!/usr/bin/env node
/**
 * `npx chancela-check` -- the sixty-second version of "do not trust us".
 *
 * Prints what each step asked and who answered it: the chain, this machine, or
 * the service under test. Exits non-zero if any check fails, so it can sit in
 * someone else's CI as a monitor of a deployment they depend on.
 */
import { check, DEFAULTS, type Step } from './check';
import type { Address } from 'viem';

const HELP = `chancela-check — check a Chancela deployment against the chain

  npx chancela-check [agentId] [options]

  agentId            Default: ${DEFAULTS.agentId}

  --url <url>        Deployment to check     (default ${DEFAULTS.url})
  --rpc <url>        Monad RPC               (default ${DEFAULTS.rpc})
  --registry <addr>  Policy registry         (default ${DEFAULTS.registry})
  --token-id <n>     ERC-8004 token id       (default: the number in the agent id)
  --no-sourcify      Skip the source-verification lookup
  --json             Machine-readable output
  -h, --help

Nothing here takes the service's word for anything: the signature is checked
against the attestor the agent's owner registered on Monad, and the decision
hash is looked up in the registry contract.`;

function parse(argv: string[]) {
  const args = { sourcify: true, json: false } as {
    agentId?: string;
    url?: string;
    rpc?: string;
    registry?: Address;
    tokenId?: bigint;
    sourcify: boolean;
    json: boolean;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '-h' || arg === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (arg === '--url') args.url = next();
    else if (arg === '--rpc') args.rpc = next();
    else if (arg === '--registry') args.registry = next() as Address;
    else if (arg === '--token-id') args.tokenId = BigInt(next());
    else if (arg === '--no-sourcify') args.sourcify = false;
    else if (arg === '--json') args.json = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
    else args.agentId = arg;
  }
  return args;
}

const WHO: Record<Step['source'], string> = {
  chain: 'monad ',
  local: 'here  ',
  service: 'server',
};

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const url = args.url ?? DEFAULTS.url;
  const agentId = args.agentId ?? DEFAULTS.agentId;

  if (!args.json) {
    console.log(`\nChancela — checking ${url} for ${agentId}\n`);
  }

  const steps = await check({ ...args, agentId });

  if (args.json) {
    console.log(JSON.stringify({ url, agentId, steps, ok: steps.every((s) => s.ok) }, null, 2));
  } else {
    for (const step of steps) {
      console.log(`  ${step.ok ? '✓' : '✗'} ${WHO[step.source]}  ${step.title}`);
      console.log(`            ${step.detail}`);
    }
    const failed = steps.filter((s) => !s.ok);
    console.log(
      failed.length === 0
        ? '\nEverything above was answered by Monad or by this machine. The service was trusted only to reply.\n'
        : `\n${failed.length} check(s) failed.\n`,
    );
  }

  process.exit(steps.every((s) => s.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(`chancela-check: ${(err as Error).message}`);
  process.exit(1);
});
