export type Hex = `0x${string}`;

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Ordinal used for comparisons and for the uint8 written on-chain. */
export const RISK_ORDINAL: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export const DECISIONS = ['ALLOW', 'DENY', 'REQUIRE_APPROVAL'] as const;
export type DecisionOutcome = (typeof DECISIONS)[number];

export const DECISION_ORDINAL: Record<DecisionOutcome, number> = {
  DENY: 0,
  ALLOW: 1,
  REQUIRE_APPROVAL: 2,
};

export const AGENT_STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * Every possible reason a decision came out the way it did.
 *
 * Closed enum on purpose: the UI never invents error text, the audit trail is
 * filterable by cause, and a new denial path cannot be added without also
 * naming it here.
 */
export const REASON_CODES = [
  // allow
  'OK',
  // deny
  'AGENT_SUSPENDED',
  'AGENT_REVOKED',
  'UNKNOWN_ACTION',
  'TOOL_DISABLED',
  'PERMISSION_DENIED',
  'INVALID_PARAMETERS',
  'LIMIT_EXCEEDED',
  'DAILY_LIMIT_EXCEEDED',
  'OUT_OF_TIME_WINDOW',
  'ENVIRONMENT_NOT_ALLOWED',
  'COUNTERPARTY_BLOCKED',
  'POLICY_INACTIVE',
  'POLICY_EXPIRED',
  'MALFORMED_INPUT',
  'INTERNAL_DENY',
  // step-up
  'APPROVAL_REQUIRED_RISK',
  'APPROVAL_REQUIRED_AMOUNT',
  'APPROVAL_REQUIRED_COUNTERPARTY',
  // step-up, satisfied
  'APPROVED_BY_OWNER',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Human-readable text for each reason code. The UI reads from here only. */
export const REASON_TEXT: Record<ReasonCode, string> = {
  OK: 'Authorized by policy.',
  AGENT_SUSPENDED: 'Agent is suspended and cannot act.',
  AGENT_REVOKED: 'Agent has been permanently revoked.',
  UNKNOWN_ACTION: 'Action is not a registered tool. Unknown actions are always denied.',
  TOOL_DISABLED: 'Tool exists but is disabled in this deployment.',
  PERMISSION_DENIED: 'Agent does not have permission to perform this action.',
  INVALID_PARAMETERS: 'Parameters failed the tool input schema.',
  LIMIT_EXCEEDED: 'Value exceeds the maximum allowed by this policy.',
  DAILY_LIMIT_EXCEEDED: 'Agent reached its daily transaction limit.',
  OUT_OF_TIME_WINDOW: 'Action attempted outside the permitted time window.',
  ENVIRONMENT_NOT_ALLOWED: 'Action is not permitted from this environment.',
  COUNTERPARTY_BLOCKED: 'Counterparty address is blocked by risk intelligence.',
  POLICY_INACTIVE: 'No active policy is bound to this agent.',
  POLICY_EXPIRED: 'The bound policy has expired and must be renewed.',
  MALFORMED_INPUT: 'Authorization request was malformed.',
  INTERNAL_DENY: 'Denied by default. No rule explicitly authorized this action.',
  APPROVAL_REQUIRED_RISK: 'Risk level requires explicit owner approval.',
  APPROVAL_REQUIRED_AMOUNT: 'Transaction value requires explicit owner approval.',
  APPROVAL_REQUIRED_COUNTERPARTY: 'Counterparty risk requires explicit owner approval.',
  APPROVED_BY_OWNER: 'Inside policy, and the step-up was approved by the owner with a passkey.',
};

export interface PolicyLimits {
  /** Max value of a single transaction, in minor units (cents). 0 = no transfers. */
  maxTransactionValue: number;
  /** Max number of value-moving actions per UTC day. 0 = none allowed. */
  dailyTransactions: number;
  /** Max value moved per UTC day, in minor units. */
  dailyValueCap: number;
}

export interface PolicyEnvironment {
  /** If non-empty, only these environments may invoke the agent. */
  allowedEnvironments?: string[];
  /** UTC hour range [startHour, endHour). Omitted = always allowed. */
  timeWindowUtc?: { startHour: number; endHour: number };
  /** Counterparty addresses that are never allowed, regardless of permissions. */
  blockedCounterparties?: string[];
}

export interface PolicyDocument {
  agentId: string;
  name: string;
  version: number;
  permissions: string[];
  limits: PolicyLimits;
  /** Risk at or above which the owner must approve out of band. */
  stepUpThreshold: RiskLevel;
  environment: PolicyEnvironment;
  /** Optional epoch-seconds expiry. */
  expiresAt?: number;
}

export interface AgentRecord {
  id: string;
  ownerAddress: string;
  status: AgentStatus;
  erc8004TokenId?: string;
  walletAddress?: string;
}

export interface ToolDescriptor {
  toolId: string;
  label: string;
  description: string;
  requiredPermission: string;
  risk: RiskLevel;
  /** Whether this tool moves value and therefore consumes transaction limits. */
  movesValue: boolean;
  enabled: boolean;
}

export interface RiskSignal {
  source: 'NANSEN' | 'INTERNAL';
  subjectAddress: string;
  labels: string[];
  /** 0..100. Higher = more dangerous. */
  severity: number;
}

export interface AuthorizationCapsule {
  version: 1;
  agentId: string;
  ownerAddress: string;
  action: string;
  intentHash: Hex;
  policyId: string;
  policyVersion: number;
  policyHash: Hex;
  decision: DecisionOutcome;
  risk: RiskLevel;
  reasonCode: ReasonCode;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  decisionHash: Hex;
}

export interface SignedCapsule {
  capsule: AuthorizationCapsule;
  /** EIP-191 signature by the attestation key. Never the agent key. */
  signature: Hex;
  attestationAddress: string;
}
