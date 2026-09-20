/**
 * Chancela plugin for MetaMask Agent Wallet.
 *
 * MetaMask Agent Wallet already simulates transactions, scans them with
 * Blockaid and enforces outflow limits. What it cannot answer is the question
 * that comes first: is *this agent* permitted to attempt this at all, under a
 * named policy, with a record anyone can later verify?
 *
 * This plugin adds that step. Every command goes through the same
 * `POST /agents/:id/authorize` endpoint the dashboard uses -- there is no
 * plugin-specific shortcut, which is why the answer here and the answer in the
 * UI cannot disagree.
 *
 * Commands:
 *   mm chancela passport <agentId>
 *   mm chancela authorize <agentId> <ACTION> '<json params>'
 *   mm chancela audit <agentId> [--limit n]
 */

export interface PluginContext {
  /** Print a line to the user's terminal. */
  print: (line: string) => void;
  /** Non-zero exit tells Agent Wallet to abort the pending operation. */
  exit: (code: number) => void;
  fetch?: typeof fetch;
}

export interface PluginConfig {
  /** Base URL of a Chancela deployment. */
  apiUrl: string;
  apiKey?: string;
}

interface AuthorizeResponse {
  decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  risk: string;
  reasonCode: string;
  reasonText: string;
  policyVersion: number;
  policyHash: string;
  auditId: string;
  decisionHash: string;
  anchorStatus: string;
}

export function createPlugin(config: PluginConfig) {
  return {
    name: 'chancela',
    description: 'Identity, authorization and accountability checks for AI agents.',
    commands: {
      passport: passport(config),
      authorize: authorize(config),
      audit: audit(config),
    },
  };
}

function client(config: PluginConfig, ctx: PluginContext) {
  const doFetch = ctx.fetch ?? fetch;
  return async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await doFetch(`${config.apiUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const payload = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
    return payload;
  };
}

function passport(config: PluginConfig) {
  return async (args: string[], ctx: PluginContext) => {
    const agentId = args[0];
    if (!agentId) {
      ctx.print('usage: mm chancela passport <agentId>');
      return ctx.exit(1);
    }
    const call = client(config, ctx);
    const data = await call<{
      agent: { id: string; name: string; status: string; erc8004TokenId?: string; walletAddress?: string };
      policy: { version: number; policyHash: string; document: { permissions: string[] } } | null;
      trustScore: { score: number };
    }>(`/api/agents/${agentId}`);

    ctx.print(`${data.agent.name}  (${data.agent.id})`);
    ctx.print(`  status        ${data.agent.status}`);
    ctx.print(`  erc-8004      ${data.agent.erc8004TokenId ?? 'unregistered'}`);
    ctx.print(`  wallet        ${data.agent.walletAddress ?? '--'}`);
    ctx.print(`  trust score   ${data.trustScore.score}`);
    ctx.print(`  policy        v${data.policy?.version ?? 0}  ${data.policy?.policyHash ?? ''}`);
    ctx.print(`  permissions   ${(data.policy?.document.permissions ?? []).join(', ') || 'none'}`);
    return ctx.exit(0);
  };
}

function authorize(config: PluginConfig) {
  return async (args: string[], ctx: PluginContext) => {
    const [agentId, action, rawParams] = args;
    if (!agentId || !action) {
      ctx.print("usage: mm chancela authorize <agentId> <ACTION> '<json params>'");
      return ctx.exit(1);
    }

    let parameters: Record<string, unknown> = {};
    if (rawParams) {
      try {
        parameters = JSON.parse(rawParams) as Record<string, unknown>;
      } catch {
        ctx.print('parameters must be valid JSON');
        return ctx.exit(1);
      }
    }

    const call = client(config, ctx);
    const result = await call<AuthorizeResponse>(`/api/agents/${agentId}/authorize`, {
      method: 'POST',
      body: JSON.stringify({ action, parameters }),
    });

    const mark = result.decision === 'ALLOW' ? '✓' : result.decision === 'DENY' ? '✕' : '!';
    ctx.print(`${mark} ${result.decision}  ${action}  [${result.risk}]`);
    if (result.decision !== 'ALLOW') ctx.print(`  reason      ${result.reasonText} (${result.reasonCode})`);
    ctx.print(`  policy      v${result.policyVersion}  ${result.policyHash}`);
    ctx.print(`  audit       ${result.auditId}`);
    ctx.print(`  proof       ${result.decisionHash} (${result.anchorStatus.toLowerCase()})`);

    // A non-zero exit is what actually stops Agent Wallet. Printing a warning
    // and returning 0 would make this decorative.
    return ctx.exit(result.decision === 'ALLOW' ? 0 : 1);
  };
}

function audit(config: PluginConfig) {
  return async (args: string[], ctx: PluginContext) => {
    const agentId = args[0];
    if (!agentId) {
      ctx.print('usage: mm chancela audit <agentId> [--limit n]');
      return ctx.exit(1);
    }
    const limitFlag = args.indexOf('--limit');
    const limit = limitFlag >= 0 ? Number(args[limitFlag + 1] ?? 20) : 20;

    const call = client(config, ctx);
    const data = await call<{
      events: Array<{
        auditId: string;
        time: string;
        action: string;
        decision: string;
        risk: string;
        reasonCode: string;
        txHash: string | null;
      }>;
    }>(`/api/agents/${agentId}/audit?limit=${limit}`);

    for (const e of data.events) {
      const mark = e.decision === 'ALLOW' ? '✓' : e.decision === 'DENY' ? '✕' : '!';
      ctx.print(
        `${new Date(e.time).toISOString()}  ${mark} ${e.decision.padEnd(16)} ${e.action.padEnd(18)} ${e.risk.padEnd(9)} ${e.txHash ?? e.reasonCode}`,
      );
    }
    return ctx.exit(0);
  };
}
