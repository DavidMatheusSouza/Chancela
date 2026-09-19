import { describe, expect, it } from 'vitest';
import {
  TOOL_PARAMETER_SCHEMAS,
  TOOL_REGISTRY,
  authorizeRequestSchema,
  policyDocumentSchema,
  rawIntentSchema,
} from '../src/index';

describe('rawIntentSchema', () => {
  it('cannot express an authorization outcome', () => {
    for (const field of ['decision', 'allowed', 'authorized', 'approve', 'grant']) {
      const r = rawIntentSchema.safeParse({ action: 'X', parameters: {}, [field]: true });
      expect(r.success).toBe(false);
    }
  });

  it('accepts a minimal valid intent and defaults parameters', () => {
    const r = rawIntentSchema.parse({ action: 'CREATE_CUSTOMER' });
    expect(r.parameters).toEqual({});
  });
});

describe('tool parameter schemas', () => {
  it('covers every registered tool', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(TOOL_PARAMETER_SCHEMAS[tool.toolId], `missing schema for ${tool.toolId}`).toBeDefined();
    }
  });

  it('rejects unknown parameter keys for every tool', () => {
    for (const tool of TOOL_REGISTRY) {
      const schema = TOOL_PARAMETER_SCHEMAS[tool.toolId]!;
      expect(schema.safeParse({ __injected: true }).success).toBe(false);
    }
  });

  it('requires TRANSFER_FUNDS amounts to be positive integers', () => {
    const schema = TOOL_PARAMETER_SCHEMAS.TRANSFER_FUNDS!;
    expect(schema.safeParse({ amount: 100, recipient: 'x' }).success).toBe(true);
    expect(schema.safeParse({ amount: -100, recipient: 'x' }).success).toBe(false);
    expect(schema.safeParse({ amount: 0, recipient: 'x' }).success).toBe(false);
    // Floats are a rounding-attack surface; minor units are integers only.
    expect(schema.safeParse({ amount: 10.5, recipient: 'x' }).success).toBe(false);
  });
});

describe('policyDocumentSchema', () => {
  const valid = {
    agentId: 'TA-001',
    name: 'SalesAgent',
    version: 1,
    permissions: ['READ_CUSTOMERS'],
    limits: { maxTransactionValue: 0, dailyTransactions: 0, dailyValueCap: 0 },
    stepUpThreshold: 'HIGH',
    environment: {},
  };

  it('accepts a well-formed policy', () => {
    expect(policyDocumentSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown permission', () => {
    expect(
      policyDocumentSchema.safeParse({ ...valid, permissions: ['BECOME_ADMIN'] }).success,
    ).toBe(false);
  });

  it('rejects negative limits', () => {
    expect(
      policyDocumentSchema.safeParse({
        ...valid,
        limits: { maxTransactionValue: -1, dailyTransactions: 0, dailyValueCap: 0 },
      }).success,
    ).toBe(false);
  });

  it('rejects version 0', () => {
    expect(policyDocumentSchema.safeParse({ ...valid, version: 0 }).success).toBe(false);
  });
});

describe('authorizeRequestSchema', () => {
  it('defaults the environment to production', () => {
    const r = authorizeRequestSchema.parse({ action: 'READ_CUSTOMERS' });
    expect(r.context.environment).toBe('production');
  });

  it('rejects extra top-level fields', () => {
    expect(
      authorizeRequestSchema.safeParse({ action: 'X', bypassPolicy: true }).success,
    ).toBe(false);
  });
});
