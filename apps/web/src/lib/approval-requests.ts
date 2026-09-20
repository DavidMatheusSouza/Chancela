import { randomUUID } from 'node:crypto';
import type { ApprovalRow, DecisionRow, Repository } from './repository';

/** How long an owner has to answer. Long enough to reach a phone, short enough to stay relevant. */
export const APPROVAL_TTL_SECONDS = 15 * 60;

/**
 * Open the approval a REQUIRE_APPROVAL decision is waiting for.
 *
 * Kept apart from lib/approvals so that authorize() can open one without
 * importing the module that calls authorize() back.
 *
 * The id is the only handle the agent's runtime gets, and it is a capability:
 * whoever holds it may poll for the outcome, nothing more. Hence a UUID rather
 * than anything guessable.
 */
export async function openApproval(
  repo: Repository,
  decision: DecisionRow,
  ownerAddress: string,
): Promise<{ id: string; status: 'PENDING'; expiresAt: string; url: string }> {
  const now = Date.now();
  const row: ApprovalRow = {
    id: `apr_${randomUUID()}`,
    decisionId: decision.id,
    ownerAddress,
    status: 'PENDING',
    expiresAt: new Date(now + APPROVAL_TTL_SECONDS * 1000).toISOString(),
    createdAt: new Date(now).toISOString(),
    onchainStatus: 'NONE',
  };
  await repo.createApproval(row);
  return { id: row.id, status: 'PENDING', expiresAt: row.expiresAt, url: `/api/approvals/${row.id}` };
}
