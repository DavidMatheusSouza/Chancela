import { REASON_TEXT, type ReasonCode } from '@chancela/shared';
import { explorerTxUrl } from './chain';
import type { ApprovalRow, Repository } from './repository';
import { challengeFor } from './webauthn-approval';

/**
 * What an approval looks like from outside: enough for the owner to know what
 * they are approving, and for the agent's runtime to pick up the answer. The
 * parameters are shown only to the owner -- the public view carries hashes.
 */
export async function describeApproval(repo: Repository, approval: ApprovalRow, forOwner: boolean) {
  const stepUp = await repo.getDecision(approval.decisionId);
  const approved = approval.approvedDecisionId ? await repo.getDecision(approval.approvedDecisionId) : null;
  return {
    id: approval.id,
    status: approval.status,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    resolvedAt: approval.resolvedAt ?? null,
    request: stepUp
      ? {
          agentId: stepUp.agentId,
          action: stepUp.action,
          risk: stepUp.risk,
          reasonCode: stepUp.reasonCode,
          reasonText: REASON_TEXT[stepUp.reasonCode as ReasonCode] ?? stepUp.reasonCode,
          auditId: stepUp.auditId,
          decisionHash: stepUp.decisionHash,
          intentHash: stepUp.intentHash,
          policyVersion: stepUp.policyVersion,
          /** The WebAuthn challenge an approval must sign: base64url of the decision hash. */
          challenge: challengeFor(stepUp.decisionHash),
          ...(forOwner ? { parameters: stepUp.parameters } : {}),
        }
      : null,
    onchain: {
      status: approval.onchainStatus,
      txHash: approval.onchainTxHash ?? null,
      explorerUrl: approval.onchainTxHash ? explorerTxUrl(approval.onchainTxHash) : null,
      note: approval.onchainError ?? null,
    },
    // Once approved, the ALLOW the runtime was waiting for -- an ordinary capsule.
    decision: approved
      ? {
          decisionId: approved.id,
          auditId: approved.auditId,
          decision: approved.outcome,
          reasonCode: approved.reasonCode,
          reasonText: REASON_TEXT[approved.reasonCode as ReasonCode] ?? approved.reasonCode,
          risk: approved.risk,
          policyVersion: approved.policyVersion,
          policyHash: approved.policyHash,
          intentHash: approved.intentHash,
          decisionHash: approved.decisionHash,
          capsule: approved.capsule,
          signature: approved.signature,
          expiresAt: Math.floor(Date.parse(approved.expiresAt) / 1000),
          anchorStatus: approved.anchorStatus,
        }
      : null,
  };
}
