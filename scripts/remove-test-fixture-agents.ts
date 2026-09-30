/**
 * Remove the agents the test suite wrote into the production database.
 *
 * On 22 September 2026 the suite was run once with the production `.env`
 * exported (see apps/web/test/setup.ts, which now prevents it). passkey.test.ts
 * created five agents -- "Mine", "Mine too", "Theirs", "Starter", "Unbound" --
 * under throwaway test addresses, and they have been listed as if they were
 * real users' agents ever since.
 *
 * Only those five go, and only if each one still looks exactly like the
 * fixture: same id, same name, created that afternoon. Anything else is left
 * alone and reported. Their policies, decisions, actions and audit events
 * cascade; usage counters and nonces are removed by agent id; a test owner
 * left with no agents is removed too. Nothing on-chain is touched -- these
 * agents never had an on-chain identity.
 *
 *   set -a; . ./.env; set +a; pnpm tsx scripts/remove-test-fixture-agents.ts           # show
 *   set -a; . ./.env; set +a; pnpm tsx scripts/remove-test-fixture-agents.ts --delete  # remove
 */
import { PrismaClient } from '@prisma/client';

const FIXTURES: Record<string, string> = {
  'TA-004': 'Mine',
  'TA-005': 'Mine too',
  'TA-006': 'Theirs',
  'TA-007': 'Starter',
  'TA-008': 'Unbound',
};
const FROM = new Date('2026-09-22T16:00:00Z');
const TO = new Date('2026-09-22T19:00:00Z');

async function main() {
  const apply = process.argv.includes('--delete');
  const db = new PrismaClient();
  try {
    const rows = await db.agent.findMany({
      where: { id: { in: Object.keys(FIXTURES) } },
      include: { user: true, _count: { select: { decisions: true, policies: true } } },
    });
    const doomed = rows.filter((r) => {
      const ok = r.name === FIXTURES[r.id] && r.createdAt >= FROM && r.createdAt <= TO && !r.erc8004TokenId;
      console.log(
        `${ok ? 'remove' : 'KEEP  '} ${r.id} "${r.name}" owner ${r.user.ownerAddress} created ${r.createdAt.toISOString()} ` +
          `(${r._count.policies} policies, ${r._count.decisions} decisions)`,
      );
      return ok;
    });
    if (!apply) {
      console.log(`\n${doomed.length} to remove. Nothing changed; run again with --delete.`);
      return;
    }
    const ids = doomed.map((r) => r.id);
    const userIds = [...new Set(doomed.map((r) => r.userId))];
    await db.$transaction(async (tx) => {
      await tx.agentUsage.deleteMany({ where: { agentId: { in: ids } } });
      await tx.usedNonce.deleteMany({ where: { agentId: { in: ids } } });
      await tx.agent.deleteMany({ where: { id: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: userIds }, agents: { none: {} } } });
    });
    console.log(`\nRemoved ${ids.length}: ${ids.join(', ')}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
