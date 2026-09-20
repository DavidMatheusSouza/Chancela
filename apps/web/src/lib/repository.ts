import type {
  AgentStatus,
  AuthorizationCapsule,
  DecisionOutcome,
  Hex,
  PolicyDocument,
  RiskLevel,
} from '@chancela/shared';
import type { UsageWindow } from '@chancela/policy-engine';

export interface AgentRow {
  id: string;
  name: string;
  description?: string;
  ownerAddress: string;
  status: AgentStatus;
  erc8004TokenId?: string;
  walletAddress?: string;
  walletProvider?: 'PRIVY' | 'MERA' | 'EXTERNAL';
  derivationIndex: number;
  attestorAddress?: string;
  activePolicyId?: string;
  createdAt: string;
}

export interface PolicyRow {
  id: string;
  agentId: string;
  name: string;
  version: number;
  policyHash: Hex;
  document: PolicyDocument;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  onchainTxHash?: string;
  activatedAt?: string;
  createdAt: string;
}

export interface DecisionRow {
  id: string;
  agentId: string;
  policyId?: string;
  action: string;
  outcome: DecisionOutcome;
  risk: RiskLevel;
  reasonCode: string;
  reasonDetail?: string;
  policyVersion: number;
  policyHash: Hex;
  intentHash: Hex;
  decisionHash: Hex;
  nonce: string;
  capsule: AuthorizationCapsule;
  signature: Hex;
  trace: unknown;
  riskFactors: unknown;
  rawIntent?: unknown;
  aiProvider?: string;
  aiModel?: string;
  environment: string;
  requestId?: string;
  issuedAt: string;
  expiresAt: string;
  createdAt: string;
  parameters: Record<string, unknown>;
  anchorStatus: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'SKIPPED';
  onchainTxHash?: string;
  blockNumber?: string;
  auditId: string;
}

export interface ActionRow {
  id: string;
  agentId: string;
  decisionId: string;
  toolId: string;
  status: 'PENDING' | 'EXECUTED' | 'FAILED' | 'BLOCKED';
  result?: unknown;
  error?: string;
  executedAt?: string;
}

/** One owner approval of one step-up decision. */
export interface ApprovalRow {
  id: string;
  decisionId: string;
  ownerAddress: string;
  status: 'PENDING' | 'APPROVED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  resolvedAt?: string;
  approvedDecisionId?: string;
  assertion?: unknown;
  onchainStatus: 'NONE' | 'PENDING' | 'CONFIRMED' | 'FAILED' | 'SKIPPED';
  onchainTxHash?: string;
  onchainError?: string;
}

/** The passkey an owner approves with: credential id and P-256 public key. */
export interface ApproverKeyRow {
  ownerAddress: string;
  credentialId: string;
  publicKeyX: Hex;
  publicKeyY: Hex;
  createdAt: string;
}

export interface DecisionFilter {
  agentId?: string;
  outcome?: DecisionOutcome;
  risk?: RiskLevel;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Storage contract.
 *
 * Small on purpose. Keeping it this narrow is what lets the entire authorize ->
 * execute path run in tests and in CI with no database at all, which in turn is
 * what makes the security suite cheap enough to run on every push.
 */
export interface Repository {
  listAgents(): Promise<AgentRow[]>;
  getAgent(id: string): Promise<AgentRow | null>;
  createAgent(row: Omit<AgentRow, 'createdAt'>): Promise<AgentRow>;
  updateAgent(id: string, patch: Partial<AgentRow>): Promise<AgentRow | null>;

  listPolicies(agentId: string): Promise<PolicyRow[]>;
  getPolicy(id: string): Promise<PolicyRow | null>;
  getActivePolicy(agentId: string): Promise<PolicyRow | null>;
  createPolicy(row: Omit<PolicyRow, 'createdAt'>): Promise<PolicyRow>;
  activatePolicy(id: string, txHash?: string): Promise<PolicyRow | null>;

  recordDecision(row: DecisionRow): Promise<DecisionRow>;
  getDecision(id: string): Promise<DecisionRow | null>;
  getDecisionByHash(hash: string): Promise<DecisionRow | null>;
  listDecisions(filter: DecisionFilter): Promise<DecisionRow[]>;
  updateAnchor(
    decisionId: string,
    patch: { anchorStatus: DecisionRow['anchorStatus']; onchainTxHash?: string; blockNumber?: string },
  ): Promise<void>;

  usageFor(agentId: string, dayKey: string): Promise<UsageWindow>;
  recordUsage(agentId: string, dayKey: string, value: number): Promise<void>;

  isNonceUsed(nonce: string): Promise<boolean>;
  consumeNonce(nonce: string, agentId: string): Promise<boolean>;

  recordAction(row: ActionRow): Promise<ActionRow>;
  listActions(agentId: string): Promise<ActionRow[]>;

  createApproval(row: ApprovalRow): Promise<ApprovalRow>;
  getApproval(id: string): Promise<ApprovalRow | null>;
  listApprovals(ownerAddress: string, limit?: number): Promise<ApprovalRow[]>;
  updateApproval(id: string, patch: Partial<Omit<ApprovalRow, 'id' | 'decisionId'>>): Promise<ApprovalRow | null>;

  getApproverKey(ownerAddress: string): Promise<ApproverKeyRow | null>;
  setApproverKey(row: ApproverKeyRow): Promise<ApproverKeyRow>;
}
