import type { AgentRecord, PolicyDocument } from '@trustagent/shared';
import type { EvaluateInput } from '../src/evaluate';

export const NOW = 1_760_000_000; // fixed epoch: 2025-10-09T08:53:20Z, hour 8 UTC

export const agent: AgentRecord = {
  id: 'TA-001',
  ownerAddress: '0x82f1aA0f3A1b2c3d4e5F60718293a4b5c6D7e891',
  status: 'ACTIVE',
  erc8004TokenId: '1',
  walletAddress: '0x91B2cC0f3A1b2c3d4e5F60718293a4b5c6D7e123',
};

export const salesPolicy: PolicyDocument = {
  agentId: 'TA-001',
  name: 'SalesAgent',
  version: 3,
  permissions: ['READ_CUSTOMERS', 'CREATE_CUSTOMER', 'SEND_PROPOSAL'],
  limits: { maxTransactionValue: 0, dailyTransactions: 0, dailyValueCap: 0 },
  stepUpThreshold: 'HIGH',
  environment: {},
};

export const treasuryPolicy: PolicyDocument = {
  agentId: 'TA-001',
  name: 'TreasuryAgent',
  version: 1,
  permissions: ['READ_TREASURY', 'TRANSFER_FUNDS'],
  // 100_000 cents = $1,000
  limits: { maxTransactionValue: 100_000, dailyTransactions: 3, dailyValueCap: 200_000 },
  stepUpThreshold: 'CRITICAL',
  environment: {},
};

export function input(over: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    agent,
    policy: salesPolicy,
    policyId: 'pol_1',
    action: 'CREATE_CUSTOMER',
    parameters: { name: 'Joao' },
    now: NOW,
    nonce: 'nonce-deadbeef-0001',
    ...over,
  };
}
