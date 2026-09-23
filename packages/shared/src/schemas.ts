import { z } from 'zod';
import { PERMISSIONS } from './permissions';
import { AGENT_STATUSES, DECISIONS, REASON_CODES, RISK_LEVELS } from './types';

export const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, 'must be 0x-prefixed hex');
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address');

const decimalString = z.string().regex(/^\d{1,30}(\.\d{1,30})?$/, 'must be a decimal string');

export const riskLevelSchema = z.enum(RISK_LEVELS);
export const decisionSchema = z.enum(DECISIONS);
export const reasonCodeSchema = z.enum(REASON_CODES);
export const agentStatusSchema = z.enum(AGENT_STATUSES);
export const permissionSchema = z.enum(PERMISSIONS);

export const policyLimitsSchema = z
  .object({
    maxTransactionValue: z.number().int().min(0),
    dailyTransactions: z.number().int().min(0),
    dailyValueCap: z.number().int().min(0),
  })
  .strict();

export const policyEnvironmentSchema = z
  .object({
    allowedEnvironments: z.array(z.string().min(1)).optional(),
    timeWindowUtc: z
      .object({
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(1).max(24),
      })
      .strict()
      .optional(),
    blockedCounterparties: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const policyDocumentSchema = z
  .object({
    agentId: z.string().min(1),
    name: z.string().min(1).max(120),
    version: z.number().int().min(1),
    permissions: z.array(permissionSchema),
    limits: policyLimitsSchema,
    stepUpThreshold: riskLevelSchema,
    environment: policyEnvironmentSchema,
    expiresAt: z.number().int().positive().optional(),
  })
  .strict();

/**
 * What an AI provider is allowed to return.
 *
 * Deliberately narrow. There is no `decision`, no `allowed`, no `authorized`
 * field -- a model cannot express an authorization outcome even if it tries,
 * because `.strict()` rejects unknown keys outright.
 *
 * `suggestedRisk` is accepted for display only and is discarded before the
 * policy engine runs.
 */
export const rawIntentSchema = z
  .object({
    action: z.string().min(1).max(64),
    parameters: z.record(z.unknown()).default({}),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().max(2000).optional(),
    suggestedRisk: riskLevelSchema.optional(),
  })
  .strict();

export type RawIntent = z.infer<typeof rawIntentSchema>;

/** Parameter schemas per tool. Enforced in step 4 of the pipeline. */
export const TOOL_PARAMETER_SCHEMAS: Record<string, z.ZodTypeAny> = {
  READ_CUSTOMERS: z.object({ query: z.string().max(200).optional() }).strict(),
  CREATE_CUSTOMER: z
    .object({
      name: z.string().min(1).max(200),
      email: z.string().email().optional(),
      phone: z.string().max(40).optional(),
    })
    .strict(),
  UPDATE_CUSTOMER: z
    .object({ customerId: z.string().min(1), patch: z.record(z.unknown()) })
    .strict(),
  DELETE_CUSTOMER: z.object({ customerId: z.string().min(1) }).strict(),
  SEND_PROPOSAL: z
    .object({
      customerId: z.string().min(1),
      amount: z.number().int().min(0).optional(),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  SEND_MESSAGE: z
    .object({ to: z.string().min(1), body: z.string().min(1).max(4000) })
    .strict(),
  READ_TREASURY: z.object({}).strict(),
  TRANSFER_FUNDS: z
    .object({
      /** Minor units (cents). Integers only -- floats are a rounding-attack surface. */
      amount: z.number().int().positive(),
      currency: z.string().length(3).default('USD'),
      recipient: z.string().min(1).max(200),
      recipientAddress: addressSchema.optional(),
      memo: z.string().max(500).optional(),
    })
    .strict(),
  PLACE_ORDER: z
    .object({
      /** Order notional in minor units (cents). This is what the limits count. */
      amount: z.number().int().positive(),
      // No defaults anywhere in this schema: a default is materialised into the
      // intent hash, and an integrator hashing the order they actually sent
      // would then get INTENT_MISMATCH for an order the policy allowed.
      currency: z.string().length(3).optional(),
      market: z.string().min(1).max(40),
      side: z.enum(['BUY', 'SELL']),
      orderType: z.enum(['MARKET', 'LIMIT']).optional(),
      /** Decimal strings, never floats. */
      size: decimalString.optional(),
      price: decimalString.optional(),
      venue: z.string().min(1).max(40).optional(),
      /** The market or router contract. Checked against blockedCounterparties. */
      marketAddress: addressSchema.optional(),
      clientOrderId: z.string().min(1).max(64).optional(),
    })
    .strict()
    .refine((o) => o.orderType !== 'LIMIT' || o.price !== undefined, {
      message: 'a LIMIT order needs a price',
    }),
  CHANGE_POLICY: z.object({ policyId: z.string().min(1) }).strict(),
  CHANGE_OWNER: z.object({ newOwner: addressSchema }).strict(),
  DELETE_AGENT: z.object({ agentId: z.string().min(1) }).strict(),
};

export const authorizeRequestSchema = z
  .object({
    action: z.string().min(1).max(64),
    parameters: z.record(z.unknown()).default({}),
    context: z
      .object({
        environment: z.string().max(40).default('production'),
        requestId: z.string().max(64).optional(),
      })
      .strict()
      .default({ environment: 'production' }),
  })
  .strict();

export const capsuleSchema = z
  .object({
    version: z.literal(1),
    agentId: z.string().min(1),
    ownerAddress: z.string().min(1),
    action: z.string().min(1),
    intentHash: hexSchema,
    policyId: z.string().min(1),
    policyVersion: z.number().int().min(1),
    policyHash: hexSchema,
    decision: decisionSchema,
    risk: riskLevelSchema,
    reasonCode: reasonCodeSchema,
    nonce: z.string().min(8),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    decisionHash: hexSchema,
  })
  .strict();

export const signedCapsuleSchema = z
  .object({
    capsule: capsuleSchema,
    signature: hexSchema,
    attestationAddress: addressSchema,
  })
  .strict();

export const executeRequestSchema = z
  .object({
    capsule: capsuleSchema,
    signature: hexSchema,
    parameters: z.record(z.unknown()),
  })
  .strict();

export const createAgentSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    permissions: z.array(permissionSchema).default([]),
  })
  .strict();
