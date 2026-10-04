#!/usr/bin/env node
/**
 * `npx chancela-check` -- the sixty-second version of "do not trust us".
 *
 * Prints what each step asked and who answered it: the chain, this machine, or
 * the service under test. Exits non-zero if any check fails, so it can sit in
 * someone else's CI as a monitor of a deployment they depend on.
 */
import { check, DEFAULTS, type Step } from './check';
import { replayDecision } from './replay';
import type { Address } from 'viem';

const HELP = `chancela-check — check a Chancela deployment against the chain

  npx chancela-check [agentId] [options]
  npx chancela-check replay <auditId | decisionHash> [options]

  agentId            Default: ${DEFAULTS.agentId}
  replay             Run one recorded decision's policy engine on this machine
                     and compare the result with what Monad recorded. Ids are
                     on ${DEFAULTS.url}/live.

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
    replay?: string;
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
    else if (arg === 'replay' && i === 0) args.replay = next();
    else args.agentId = arg;
  }
  return args;
}

const WHO: Record<Step['source'], string> = {
  chain: 'monad ',
  local: 'here  ',
  service: 'server',
};

function print(steps: Step[]): void {
  for (const step of steps) {
    console.log(`  ${step.ok ? '✓' : '✗'} ${WHO[step.source]}  ${step.title}`);
    console.log(`            ${step.detail}`);
  }
}

async function replayCommand(id: string, args: ReturnType<typeof parse>): Promise<void> {
  const url = args.url ?? DEFAULTS.url;
  if (!args.json) console.log(`\nChancela — running ${id} again on this machine\n`);

  const report = await replayDecision({
    id,
    url,
    rpc: args.rpc ?? DEFAULTS.rpc,
    registry: args.registry ?? DEFAULTS.registry,
  });
  const ok = report.steps.length > 0 && report.steps.every((s) => s.ok);

  if (args.json) {
    console.log(JSON.stringify({ url, id, ...report, ok }, null, 2));
  } else {
    print(report.steps);
    if (report.trace.length > 0) {
      console.log('\n  The engine, step by step:');
      for (const t of report.trace) {
        console.log(`    ${t.passed ? '✓' : '✗'} ${String(t.step).padStart(2)}. ${t.name}${t.detail ? ` — ${t.detail}` : ''}`);
      }
    }
    console.log(
      ok
        ? `\nThe policy engine, run here on the inputs of ${id}, gives the decision Monad recorded.\n`
        : `\n${report.steps.filter((s) => !s.ok).length} check(s) failed.\n`,
    );
  }
  process.exit(ok ? 0 : 1);
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  if (args.replay) return replayCommand(args.replay, args);
  const url = args.url ?? DEFAULTS.url;
  const agentId = args.agentId ?? DEFAULTS.agentId;

  if (!args.json) {
    console.log(`\nChancela — checking ${url} for ${agentId}\n`);
  }

  const steps = await check({ ...args, agentId });

  if (args.json) {
    console.log(JSON.stringify({ url, agentId, steps, ok: steps.every((s) => s.ok) }, null, 2));
  } else {
    print(steps);
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
