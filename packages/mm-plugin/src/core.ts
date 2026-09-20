/**
 * The part of the plugin that does not know it is a plugin.
 *
 * Everything here is plain functions over an injected `fetch`, so it is tested
 * without MetaMask, oclif or a network. The command classes in ./commands are
 * thin adapters: they read flags, call these, and turn a refusal into a
 * non-zero exit.
 *
 * Every call goes to the same public endpoints the Chancela dashboard uses.
 * There is no plugin-specific shortcut, which is why the answer in a terminal
 * and the answer in the UI cannot disagree.
 */

export interface ChancelaConfig {
  /** Base URL of a Chancela deployment, e.g. https://chancela.xyz */
  apiUrl: string;
  fetch?: typeof fetch;
}

export interface Decision {
  decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  action: string;
  risk: string;
  reasonCode: string;
  reasonText: string;
  policyVersion: number;
  policyHash: string;
  auditId: string;
  decisionHash: string;
  anchorStatus: string;
  /** Present when this refusal tripped the circuit breaker. */
  agentSuspended: boolean;
}

export interface Passport {
  id: string;
  name: string;
  status: string;
  identity: string;
  wallet: string | null;
  trustScore: number;
  policyVersion: number;
  policyHash: string | null;
  permissions: string[];
}

export interface AuditLine {
  auditId: string;
  time: string;
  action: string;
  decision: string;
  risk: string;
  reasonCode: string;
  txHash: string | null;
}

export class ChancelaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

export function resolveApiUrl(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const url = flag ?? env.CHANCELA_API_URL;
  if (!url) {
    throw new ChancelaError(
      'CHANCELA_NOT_CONFIGURED',
      'No Chancela deployment is configured.',
      'Pass --api-url https://your-deployment or set CHANCELA_API_URL.',
    );
  }
  return url.replace(/\/+$/, '');
}

async function call<T>(config: ChancelaConfig, path: string, init?: RequestInit): Promise<T> {
  const doFetch = config.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    // Unreachable is not permission. The caller must treat this as a refusal.
    throw new ChancelaError(
      'CHANCELA_UNREACHABLE',
      `Could not reach Chancela at ${config.apiUrl}.`,
      'Nothing was authorized. Check the URL and try again; do not proceed without a decision.',
    );
  }
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new ChancelaError(
      payload?.error?.code ?? `HTTP_${response.status}`,
      payload?.error?.message ?? `Chancela answered ${response.status}.`,
      'Nothing was authorized.',
    );
  }
  return payload;
}

export function parseParams(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  throw new ChancelaError(
    'INVALID_PARAMS',
    '--params must be a JSON object.',
    `Example: --params '{"amount":500000,"recipient":"0xabc"}'`,
  );
}

/** Ask the policy engine. Returns the decision whatever it is; never throws on DENY. */
export async function authorize(
  config: ChancelaConfig,
  agentId: string,
  action: string,
  parameters: Record<string, unknown>,
): Promise<Decision> {
  const r = await call<Omit<Decision, 'action' | 'agentSuspended'> & { breaker?: { tripped?: boolean } }>(
    config,
    `/api/agents/${encodeURIComponent(agentId)}/authorize`,
    { method: 'POST', body: JSON.stringify({ action, parameters }) },
  );
  return {
    decision: r.decision,
    action,
    risk: r.risk,
    reasonCode: r.reasonCode,
    reasonText: r.reasonText,
    policyVersion: r.policyVersion,
    policyHash: r.policyHash,
    auditId: r.auditId,
    decisionHash: r.decisionHash,
    anchorStatus: r.anchorStatus,
    agentSuspended: Boolean(r.breaker?.tripped) || r.reasonCode === 'AGENT_SUSPENDED',
  };
}

/**
 * Turn anything other than ALLOW into a thrown error.
 *
 * This is the whole point of the plugin. A policy check that prints a warning
 * and exits 0 is decorative: `mm chancela authorize ... && mm transfer ...`
 * would sail straight through it. Only a non-zero exit actually stops the next
 * command, so a refusal has to be one.
 */
export function assertAllowed(d: Decision): Decision {
  if (d.decision === 'ALLOW') return d;
  if (d.decision === 'REQUIRE_APPROVAL') {
    throw new ChancelaError(
      'CHANCELA_APPROVAL_REQUIRED',
      `${d.action} needs the owner's approval first (${d.risk}). Audit ${d.auditId}.`,
      'Do not proceed. The agent owner must approve this action in Chancela.',
    );
  }
  throw new ChancelaError(
    'CHANCELA_DENIED',
    `${d.action} was refused: ${d.reasonText} (${d.reasonCode}, ${d.risk}). Audit ${d.auditId}.`,
    d.agentSuspended
      ? 'The agent is suspended. Every request is refused until its owner reactivates it. Do not retry.'
      : 'Do not proceed and do not rephrase the request: the policy decides, not the wording.',
  );
}

export async function passport(config: ChancelaConfig, agentId: string): Promise<Passport> {
  const d = await call<{
    agent: { id: string; name: string; status: string; erc8004TokenId?: string; walletAddress?: string };
    policy: { version: number; policyHash: string; document: { permissions: string[] } } | null;
    trustScore: { score: number };
  }>(config, `/api/agents/${encodeURIComponent(agentId)}`);
  return {
    id: d.agent.id,
    name: d.agent.name,
    status: d.agent.status,
    identity: d.agent.erc8004TokenId ? `ERC-8004 #${d.agent.erc8004TokenId}` : 'unregistered',
    wallet: d.agent.walletAddress ?? null,
    trustScore: d.trustScore.score,
    policyVersion: d.policy?.version ?? 0,
    policyHash: d.policy?.policyHash ?? null,
    permissions: d.policy?.document.permissions ?? [],
  };
}

export async function audit(config: ChancelaConfig, agentId: string, limit: number): Promise<AuditLine[]> {
  const safe = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 200) : 20;
  const d = await call<{ events: AuditLine[] }>(
    config,
    `/api/agents/${encodeURIComponent(agentId)}/audit?limit=${safe}`,
  );
  return d.events ?? [];
}
