import { PrismaClient, type Prisma } from '@prisma/client';
import type { AuthorizationCapsule, Hex, PolicyDocument } from '@chancela/shared';
import type { UsageWindow } from '@chancela/policy-engine';
import type {
  ActionRow,
  AgentRow,
  ApprovalRow,
  ApproverKeyRow,
  DecisionFilter,
  DecisionRow,
  PolicyRow,
  Repository,
} from './repository';

/**
 * Postgres-backed repository.
 *
 * The same `Repository` contract the in-memory one implements, so the policy
 * engine, the API and every screen are unchanged by which of the two is in
 * play. The tests keep running against memory -- that is what makes the
 * security suite cheap enough for every push.
 *
 * Three things the relational shape forces, which the in-memory version got for
 * free:
 *
 *   - An agent's owner lives on `User`, and its wallet on `AgentWallet`. A
 *     flat `AgentRow` is assembled from the join.
 *   - A decision's anchor state lives on `AuditEvent`, because anchoring is
 *     asynchronous and `decisions` is append-only. `updateAnchor` writes there
 *     and never touches the decision.
 *   - `consumeNonce` relies on the primary key of `used_nonces` rather than a
 *     read-then-write. Two concurrent redemptions of one capsule race, and the
 *     loser has to be rejected by the database, not by application code.
 */

const json = (value: unknown) => (value ?? {}) as Prisma.InputJsonValue;
const iso = (d: Date) => d.toISOString();

export class PrismaRepository implements Repository {
  constructor(private readonly db: PrismaClient) {}

  // ── agents ────────────────────────────────────────────────────────────────

  private toAgentRow(a: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    erc8004TokenId: string | null;
    derivationIndex: number;
    activePolicyId: string | null;
    attestorAddress: string | null;
    createdAt: Date;
    suspendedAt: Date | null;
    user: { ownerAddress: string };
    wallets: Array<{ address: string; provider: string }>;
  }): AgentRow {
    const wallet = a.wallets[0];
    return {
      id: a.id,
      name: a.name,
      description: a.description ?? undefined,
      ownerAddress: a.user.ownerAddress,
      status: a.status as AgentRow['status'],
      erc8004TokenId: a.erc8004TokenId ?? undefined,
      walletAddress: wallet?.address,
      walletProvider: wallet?.provider as AgentRow['walletProvider'],
      derivationIndex: a.derivationIndex,
      attestorAddress: a.attestorAddress ?? undefined,
      activePolicyId: a.activePolicyId ?? undefined,
      createdAt: iso(a.createdAt),
      suspendedAt: a.suspendedAt ? iso(a.suspendedAt) : undefined,
    };
  }

  private readonly agentInclude = {
    user: { select: { ownerAddress: true } },
    wallets: { where: { isPrimary: true }, take: 1 },
  } as const;

  async listAgents(): Promise<AgentRow[]> {
    const rows = await this.db.agent.findMany({
      include: this.agentInclude,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toAgentRow(r));
  }

  async getAgent(id: string): Promise<AgentRow | null> {
    const row = await this.db.agent.findUnique({ where: { id }, include: this.agentInclude });
    return row ? this.toAgentRow(row) : null;
  }

  async createAgent(row: Omit<AgentRow, 'createdAt'>): Promise<AgentRow> {
    const user = await this.db.user.upsert({
      where: { ownerAddress: row.ownerAddress },
      create: { ownerAddress: row.ownerAddress },
      update: {},
    });

    await this.db.agent.create({
      data: {
        id: row.id,
        userId: user.id,
        name: row.name,
        description: row.description,
        status: row.status as never,
        erc8004TokenId: row.erc8004TokenId,
        derivationIndex: row.derivationIndex,
        activePolicyId: row.activePolicyId,
        attestorAddress: row.attestorAddress,
        ...(row.walletAddress
          ? {
              wallets: {
                create: {
                  address: row.walletAddress,
                  provider: (row.walletProvider ?? 'EXTERNAL') as never,
                  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143),
                  isPrimary: true,
                },
              },
            }
          : {}),
      },
    });

    const created = await this.getAgent(row.id);
    if (!created) throw new Error(`agent ${row.id} vanished immediately after create`);
    return created;
  }

  async updateAgent(id: string, patch: Partial<AgentRow>): Promise<AgentRow | null> {
    const exists = await this.db.agent.findUnique({ where: { id } });
    if (!exists) return null;

    await this.db.agent.update({
      where: { id },
      data: {
        name: patch.name,
        description: patch.description,
        status: patch.status as never,
        erc8004TokenId: patch.erc8004TokenId,
        derivationIndex: patch.derivationIndex,
        activePolicyId: patch.activePolicyId,
        attestorAddress: patch.attestorAddress,
        // Stamped on the way into SUSPENDED only, so a repeated suspend does not reset it.
        ...(patch.status === 'SUSPENDED' && exists.status !== 'SUSPENDED' ? { suspendedAt: new Date() } : {}),
      },
    });

    if (patch.walletAddress) {
      const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143);
      // One primary wallet per agent: demote the rest, then upsert this one.
      await this.db.$transaction([
        this.db.agentWallet.updateMany({ where: { agentId: id }, data: { isPrimary: false } }),
        this.db.agentWallet.upsert({
          where: { agentId_address_chainId: { agentId: id, address: patch.walletAddress, chainId } },
          create: {
            agentId: id,
            address: patch.walletAddress,
            provider: (patch.walletProvider ?? 'EXTERNAL') as never,
            chainId,
            isPrimary: true,
          },
          update: { isPrimary: true, provider: (patch.walletProvider ?? 'EXTERNAL') as never },
        }),
      ]);
    }
    return this.getAgent(id);
  }

  // ── policies ──────────────────────────────────────────────────────────────

  private toPolicyRow(p: {
    id: string;
    agentId: string;
    name: string;
    version: number;
    policyHash: string;
    document: Prisma.JsonValue;
    status: string;
    onchainTxHash: string | null;
    activatedAt: Date | null;
    createdAt: Date;
  }): PolicyRow {
    return {
      id: p.id,
      agentId: p.agentId,
      name: p.name,
      version: p.version,
      policyHash: p.policyHash as Hex,
      document: p.document as unknown as PolicyDocument,
      status: p.status as PolicyRow['status'],
      onchainTxHash: p.onchainTxHash ?? undefined,
      activatedAt: p.activatedAt ? iso(p.activatedAt) : undefined,
      createdAt: iso(p.createdAt),
    };
  }

  async listPolicies(agentId: string): Promise<PolicyRow[]> {
    const rows = await this.db.policy.findMany({
      where: { agentId },
      orderBy: { version: 'desc' },
    });
    return rows.map((r) => this.toPolicyRow(r));
  }

  async getPolicy(id: string): Promise<PolicyRow | null> {
    const row = await this.db.policy.findUnique({ where: { id } });
    return row ? this.toPolicyRow(row) : null;
  }

  async getActivePolicy(agentId: string): Promise<PolicyRow | null> {
    const row = await this.db.policy.findFirst({
      where: { agentId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    return row ? this.toPolicyRow(row) : null;
  }

  async createPolicy(row: Omit<PolicyRow, 'createdAt'>): Promise<PolicyRow> {
    const created = await this.db.policy.create({
      data: {
        id: row.id,
        agentId: row.agentId,
        name: row.name,
        version: row.version,
        policyHash: row.policyHash,
        document: json(row.document),
        status: row.status as never,
        onchainTxHash: row.onchainTxHash,
        activatedAt: row.activatedAt ? new Date(row.activatedAt) : null,
      },
    });
    return this.toPolicyRow(created);
  }

  /**
   * Exactly one ACTIVE policy per agent, enforced in a transaction. Two active
   * versions would make "which policy governed this decision" unanswerable,
   * which is the one question the product exists to answer.
   */
  async activatePolicy(id: string, txHash?: string): Promise<PolicyRow | null> {
    const target = await this.db.policy.findUnique({ where: { id } });
    if (!target) return null;

    const [, activated] = await this.db.$transaction([
      this.db.policy.updateMany({
        where: { agentId: target.agentId, status: 'ACTIVE', NOT: { id } },
        data: { status: 'ARCHIVED' },
      }),
      this.db.policy.update({
        where: { id },
        data: { status: 'ACTIVE', activatedAt: new Date(), onchainTxHash: txHash },
      }),
    ]);

    await this.db.agent.update({
      where: { id: target.agentId },
      data: { activePolicyId: id },
    });

    return this.toPolicyRow(activated);
  }

  // ── decisions ─────────────────────────────────────────────────────────────

  private toDecisionRow(d: {
    id: string;
    agentId: string;
    policyId: string | null;
    action: string;
    outcome: string;
    risk: string;
    reasonCode: string;
    reasonDetail: string | null;
    policyVersion: number;
    policyHash: string;
    intentHash: string;
    decisionHash: string;
    nonce: string;
    capsule: Prisma.JsonValue;
    signature: string;
    parameters: Prisma.JsonValue;
    trace: Prisma.JsonValue;
    riskFactors: Prisma.JsonValue;
    rawIntent: Prisma.JsonValue | null;
    aiProvider: string | null;
    aiModel: string | null;
    environment: string;
    requestId: string | null;
    issuedAt: Date;
    expiresAt: Date;
    createdAt: Date;
    audit: {
      id: string;
      anchorStatus: string;
      onchainTxHash: string | null;
      blockNumber: bigint | null;
    } | null;
  }): DecisionRow {
    return {
      id: d.id,
      agentId: d.agentId,
      policyId: d.policyId ?? undefined,
      action: d.action,
      outcome: d.outcome as DecisionRow['outcome'],
      risk: d.risk as DecisionRow['risk'],
      reasonCode: d.reasonCode,
      reasonDetail: d.reasonDetail ?? undefined,
      policyVersion: d.policyVersion,
      policyHash: d.policyHash as Hex,
      intentHash: d.intentHash as Hex,
      decisionHash: d.decisionHash as Hex,
      nonce: d.nonce,
      capsule: d.capsule as unknown as AuthorizationCapsule,
      signature: d.signature as Hex,
      trace: d.trace,
      riskFactors: d.riskFactors,
      rawIntent: d.rawIntent ?? undefined,
      aiProvider: d.aiProvider ?? undefined,
      aiModel: d.aiModel ?? undefined,
      environment: d.environment,
      requestId: d.requestId ?? undefined,
      issuedAt: iso(d.issuedAt),
      expiresAt: iso(d.expiresAt),
      createdAt: iso(d.createdAt),
      parameters: (d.parameters ?? {}) as Record<string, unknown>,
      anchorStatus: (d.audit?.anchorStatus ?? 'SKIPPED') as DecisionRow['anchorStatus'],
      onchainTxHash: d.audit?.onchainTxHash ?? undefined,
      blockNumber: d.audit?.blockNumber != null ? d.audit.blockNumber.toString() : undefined,
      auditId: d.audit?.id ?? `TA-AUDIT-${d.decisionHash.slice(2, 10).toUpperCase()}`,
    };
  }

  /**
   * Append-only, and the AuditEvent is written in the same transaction. A
   * decision that exists without its audit row would be a decision with no
   * anchor state -- silently unprovable.
   */
  async recordDecision(row: DecisionRow): Promise<DecisionRow> {
    await this.db.$transaction([
      this.db.decision.create({
        data: {
          id: row.id,
          agentId: row.agentId,
          policyId: row.policyId,
          action: row.action,
          outcome: row.outcome as never,
          risk: row.risk as never,
          reasonCode: row.reasonCode,
          reasonDetail: row.reasonDetail,
          policyVersion: row.policyVersion,
          policyHash: row.policyHash,
          intentHash: row.intentHash,
          decisionHash: row.decisionHash,
          nonce: row.nonce,
          capsule: json(row.capsule),
          signature: row.signature,
          parameters: json(row.parameters),
          trace: json(row.trace),
          riskFactors: json(row.riskFactors),
          rawIntent: row.rawIntent === undefined ? undefined : json(row.rawIntent),
          aiProvider: row.aiProvider,
          aiModel: row.aiModel,
          environment: row.environment,
          requestId: row.requestId,
          issuedAt: new Date(row.issuedAt),
          expiresAt: new Date(row.expiresAt),
        },
      }),
      this.db.auditEvent.create({
        data: {
          id: row.auditId,
          agentId: row.agentId,
          decisionId: row.id,
          eventType: `DECISION_${row.outcome}`,
          payloadHash: row.decisionHash,
          anchorStatus: row.anchorStatus as never,
          onchainTxHash: row.onchainTxHash,
          blockNumber: row.blockNumber ? BigInt(row.blockNumber) : null,
        },
      }),
    ]);
    return row;
  }

  async getDecision(id: string): Promise<DecisionRow | null> {
    const row = await this.db.decision.findUnique({ where: { id }, include: { audit: true } });
    return row ? this.toDecisionRow(row) : null;
  }

  async getDecisionByHash(hash: string): Promise<DecisionRow | null> {
    const row = await this.db.decision.findUnique({
      where: { decisionHash: hash },
      include: { audit: true },
    });
    return row ? this.toDecisionRow(row) : null;
  }

  async listDecisions(filter: DecisionFilter): Promise<DecisionRow[]> {
    const rows = await this.db.decision.findMany({
      where: {
        agentId: filter.agentId,
        outcome: filter.outcome as never,
        risk: filter.risk as never,
        action: filter.action,
        ...(filter.from || filter.to
          ? {
              createdAt: {
                ...(filter.from ? { gte: new Date(filter.from) } : {}),
                ...(filter.to ? { lte: new Date(filter.to) } : {}),
              },
            }
          : {}),
      },
      include: { audit: true },
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 100,
    });
    return rows.map((r) => this.toDecisionRow(r));
  }

  /** Writes to the audit event, never to the append-only decision. */
  async updateAnchor(
    decisionId: string,
    patch: { anchorStatus: DecisionRow['anchorStatus']; onchainTxHash?: string; blockNumber?: string },
  ): Promise<void> {
    await this.db.auditEvent.updateMany({
      where: { decisionId },
      data: {
        anchorStatus: patch.anchorStatus as never,
        onchainTxHash: patch.onchainTxHash,
        blockNumber: patch.blockNumber ? BigInt(patch.blockNumber) : undefined,
        confirmedAt: patch.anchorStatus === 'CONFIRMED' ? new Date() : undefined,
      },
    });
  }

  // ── usage windows ─────────────────────────────────────────────────────────

  async usageFor(agentId: string, dayKey: string): Promise<UsageWindow> {
    const row = await this.db.agentUsage.findUnique({
      where: { agentId_dayKey: { agentId, dayKey } },
    });
    return {
      transactionsToday: row?.transactionsToday ?? 0,
      valueMovedToday: row ? Number(row.valueMovedToday) : 0,
    };
  }

  async recordUsage(agentId: string, dayKey: string, value: number): Promise<void> {
    await this.db.agentUsage.upsert({
      where: { agentId_dayKey: { agentId, dayKey } },
      create: { agentId, dayKey, transactionsToday: 1, valueMovedToday: BigInt(Math.trunc(value)) },
      update: {
        transactionsToday: { increment: 1 },
        valueMovedToday: { increment: BigInt(Math.trunc(value)) },
      },
    });
  }

  // ── nonces ────────────────────────────────────────────────────────────────

  async isNonceUsed(nonce: string): Promise<boolean> {
    return (await this.db.usedNonce.count({ where: { nonce } })) > 0;
  }

  /**
   * The insert is the lock. Racing redemptions of the same capsule both reach
   * here; the primary key rejects the second, and P2002 is the losing caller's
   * answer -- not something application code could have decided correctly.
   */
  async consumeNonce(nonce: string, agentId: string): Promise<boolean> {
    try {
      await this.db.usedNonce.create({ data: { nonce, agentId } });
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return false;
      throw err;
    }
  }

  // ── actions ───────────────────────────────────────────────────────────────

  async recordAction(row: ActionRow): Promise<ActionRow> {
    const decision = await this.db.decision.findUnique({
      where: { id: row.decisionId },
      select: { intentHash: true, parameters: true },
    });

    await this.db.action.upsert({
      where: { decisionId: row.decisionId },
      create: {
        id: row.id,
        agentId: row.agentId,
        decisionId: row.decisionId,
        toolId: row.toolId,
        intentHash: decision?.intentHash ?? '',
        parameters: json(decision?.parameters),
        status: row.status as never,
        result: row.result === undefined ? undefined : json(row.result),
        error: row.error,
        executedAt: row.executedAt ? new Date(row.executedAt) : null,
      },
      update: {
        status: row.status as never,
        result: row.result === undefined ? undefined : json(row.result),
        error: row.error,
        executedAt: row.executedAt ? new Date(row.executedAt) : null,
      },
    });
    return row;
  }

  async listActions(agentId: string): Promise<ActionRow[]> {
    const rows = await this.db.action.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((a) => ({
      id: a.id,
      agentId: a.agentId,
      decisionId: a.decisionId,
      toolId: a.toolId,
      status: a.status as ActionRow['status'],
      result: a.result ?? undefined,
      error: a.error ?? undefined,
      executedAt: a.executedAt ? iso(a.executedAt) : undefined,
    }));
  }

  // ── approvals ─────────────────────────────────────────────────────────────

  async createApproval(row: ApprovalRow): Promise<ApprovalRow> {
    await this.db.approvalRequest.create({
      data: {
        id: row.id,
        decisionId: row.decisionId,
        requiredSigner: row.ownerAddress,
        status: row.status,
        expiresAt: new Date(row.expiresAt),
        createdAt: new Date(row.createdAt),
        onchainStatus: row.onchainStatus,
      },
    });
    return row;
  }

  async getApproval(id: string): Promise<ApprovalRow | null> {
    const row = await this.db.approvalRequest.findUnique({ where: { id } });
    return row ? toApproval(row) : null;
  }

  async listApprovals(ownerAddress: string, limit = 50): Promise<ApprovalRow[]> {
    const rows = await this.db.approvalRequest.findMany({
      where: { requiredSigner: { equals: ownerAddress, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toApproval);
  }

  async updateApproval(
    id: string,
    patch: Partial<Omit<ApprovalRow, 'id' | 'decisionId'>>,
  ): Promise<ApprovalRow | null> {
    const exists = await this.db.approvalRequest.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return null;
    const row = await this.db.approvalRequest.update({
      where: { id },
      data: {
        status: patch.status,
        resolvedAt: patch.resolvedAt ? new Date(patch.resolvedAt) : undefined,
        approvedDecisionId: patch.approvedDecisionId,
        assertion: patch.assertion === undefined ? undefined : json(patch.assertion),
        onchainStatus: patch.onchainStatus,
        onchainTxHash: patch.onchainTxHash,
        onchainError: patch.onchainError,
      },
    });
    return toApproval(row);
  }

  async getApproverKey(ownerAddress: string): Promise<ApproverKeyRow | null> {
    const row = await this.db.approverKey.findFirst({
      where: { ownerAddress: { equals: ownerAddress, mode: 'insensitive' } },
    });
    return row
      ? {
          ownerAddress: row.ownerAddress,
          credentialId: row.credentialId,
          publicKeyX: row.publicKeyX as Hex,
          publicKeyY: row.publicKeyY as Hex,
          createdAt: iso(row.createdAt),
        }
      : null;
  }

  async setApproverKey(row: ApproverKeyRow): Promise<ApproverKeyRow> {
    const data = {
      credentialId: row.credentialId,
      publicKeyX: row.publicKeyX,
      publicKeyY: row.publicKeyY,
    };
    await this.db.approverKey.upsert({
      where: { ownerAddress: row.ownerAddress },
      create: { ownerAddress: row.ownerAddress, createdAt: new Date(row.createdAt), ...data },
      update: data,
    });
    return row;
  }
}

function toApproval(row: {
  id: string;
  decisionId: string;
  requiredSigner: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  approvedDecisionId: string | null;
  assertion: unknown;
  onchainStatus: string;
  onchainTxHash: string | null;
  onchainError: string | null;
}): ApprovalRow {
  return {
    id: row.id,
    decisionId: row.decisionId,
    ownerAddress: row.requiredSigner,
    status: row.status as ApprovalRow['status'],
    expiresAt: iso(row.expiresAt),
    createdAt: iso(row.createdAt),
    resolvedAt: row.resolvedAt ? iso(row.resolvedAt) : undefined,
    approvedDecisionId: row.approvedDecisionId ?? undefined,
    assertion: row.assertion ?? undefined,
    onchainStatus: row.onchainStatus as ApprovalRow['onchainStatus'],
    onchainTxHash: row.onchainTxHash ?? undefined,
    onchainError: row.onchainError ?? undefined,
  };
}
