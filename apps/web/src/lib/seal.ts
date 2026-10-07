import { activeChain } from './chain';
import { getRepository } from './store';

/**
 * The seal: an agent's standing as an image its operator can put on their own
 * page.
 *
 * A team that puts Chancela in front of its agent has, until now, had nothing
 * to show its own users except a link. This is the thing to show: the agent's
 * status, its ERC-8004 identity, the policy version in force and how many
 * requests were refused, drawn from the same records as the passport on every
 * request.
 *
 * An image proves nothing by itself -- anyone can copy one. The seal is a
 * pointer: the snippet wraps it in a link to the agent's passport, which reads
 * the registry on Monad. It is only ever as good as the page behind it, and it
 * carries nothing the passport does not already publish.
 */

export interface SealData {
  id: string;
  name: string;
  status: string;
  tokenId?: string;
  chainName: string;
  policyVersion?: number;
  policyHash?: string;
  policyAnchored: boolean;
  decisions: number;
  /** True when `decisions` is the page size rather than the full count. */
  decisionsCapped: boolean;
  refused: number;
  lastDecisionAt?: string;
}

type Standing = { label: string; color: string };

const INK = '#eef1f6';
const MUTED = '#949ca9';
const FAINT = '#778190';
const LINE = '#30363f';
const SURFACE = '#0e1014';
const CHAIN = '#7e7aff';
const ALLOW = '#38cb81';
const DENY = '#f45959';

/** How many decisions the seal counts before it says "or more". */
export const SEAL_DECISION_LIMIT = 1000;

export function standing(data: Pick<SealData, 'status' | 'tokenId'>): Standing {
  if (data.status === 'SUSPENDED') return { label: 'suspended', color: DENY };
  if (data.status !== 'ACTIVE') return { label: data.status.toLowerCase(), color: FAINT };
  // Active in our database but with no identity on the registry: nothing about
  // it is anchored, and the seal must not look like the one that is.
  if (!data.tokenId) return { label: 'not on-chain', color: FAINT };
  return { label: 'active', color: ALLOW };
}

/** Agent names are written by whoever created the agent; this file is markup. */
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const SHIELD =
  'M12 2.5 4.5 5.3v5.6c0 4.6 3 8.9 7.5 10.6 4.5-1.7 7.5-6 7.5-10.6V5.3L12 2.5Zm-1.1 12.3-3-3 1.2-1.2 1.8 1.8 4.2-4.2 1.2 1.2-5.4 5.4Z';

function identityLine(data: SealData): string {
  if (!data.tokenId) return 'No ERC-8004 identity yet';
  return `ERC-8004 #${data.tokenId} on ${data.chainName}`;
}

function policyLine(data: SealData): string {
  if (data.policyVersion === undefined || !data.policyHash) return 'No active policy';
  const where = data.policyAnchored ? 'anchored' : 'not anchored';
  return `Policy v${data.policyVersion} ${shortHash(data.policyHash)}, ${where}`;
}

function decisionLine(data: SealData): string {
  if (data.decisions === 0) return 'No decisions yet';
  const count = `${data.decisions}${data.decisionsCapped ? '+' : ''} decision${data.decisions === 1 ? '' : 's'}`;
  const last = data.lastDecisionAt ? `, last ${day(data.lastDecisionAt)}` : '';
  return `${count}, ${data.refused} refused${last}`;
}

/** The card: what goes on an operator's page. 360 x 116. */
export function renderSealCard(data: SealData): string {
  const s = standing(data);
  const pillWidth = Math.round(s.label.length * 6.4 + 26);
  const title = `Chancela seal for ${data.name}: ${s.label}. ${identityLine(data)}. ${policyLine(data)}. ${decisionLine(data)}.`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="116" viewBox="0 0 360 116" role="img" aria-label="${escapeXml(title)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="0.5" y="0.5" width="359" height="115" rx="10" fill="${SURFACE}" stroke="${LINE}"/>`,
    `<path d="${SHIELD}" fill="${CHAIN}" transform="translate(14 12) scale(0.9)"/>`,
    `<g font-family="ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
    // One text run, so the id follows the wordmark whatever font the viewer has.
    `<text x="42" y="27" font-size="12"><tspan fill="${INK}" font-weight="600">Chancela</tspan><tspan dx="8" fill="${FAINT}" font-size="11">${escapeXml(data.id)}</tspan></text>`,
    `<rect x="${346 - pillWidth}" y="13" width="${pillWidth}" height="20" rx="10" fill="${s.color}" fill-opacity="0.14" stroke="${s.color}" stroke-opacity="0.5"/>`,
    `<circle cx="${346 - pillWidth + 11}" cy="23" r="3" fill="${s.color}"/>`,
    `<text x="${346 - pillWidth + 19}" y="27" fill="${s.color}" font-size="11" font-weight="600">${escapeXml(s.label)}</text>`,
    `<text x="16" y="56" fill="${INK}" font-size="15" font-weight="600">${escapeXml(clip(data.name, 36))}</text>`,
    `<text x="16" y="75" fill="${MUTED}" font-size="11">${escapeXml(identityLine(data))}</text>`,
    `<text x="16" y="90" fill="${MUTED}" font-size="11">${escapeXml(policyLine(data))}</text>`,
    `<text x="16" y="105" fill="${MUTED}" font-size="11">${escapeXml(decisionLine(data))}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
}

/** The one-line badge, for a README. Twenty pixels high, like the others there. */
export function renderSealBadge(data: SealData): string {
  const s = standing(data);
  const right = data.tokenId && data.status === 'ACTIVE' && data.policyVersion !== undefined ? `${s.label} · policy v${data.policyVersion}` : s.label;
  const leftWidth = 70;
  const rightWidth = Math.round(right.length * 6.3 + 16);
  const width = leftWidth + rightWidth;
  const title = `Chancela: ${data.name} is ${right}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20" role="img" aria-label="${escapeXml(title)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<clipPath id="r"><rect width="${width}" height="20" rx="4"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${leftWidth}" height="20" fill="#23272f"/>`,
    `<rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${s.color}"/>`,
    `</g>`,
    `<g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">`,
    `<text x="8" y="14" fill="${INK}">chancela</text>`,
    `<text x="${leftWidth + 8}" y="14" fill="#0b0d11" font-weight="600">${escapeXml(right)}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
}

export async function sealData(id: string): Promise<SealData | null> {
  const repo = await getRepository();
  const agent = await repo.getAgent(id);
  if (!agent) return null;

  const policy = await repo.getActivePolicy(agent.id);
  const decisions = await repo.listDecisions({ agentId: agent.id, limit: SEAL_DECISION_LIMIT });
  const last = decisions.reduce<string | undefined>(
    (latest, d) => (latest === undefined || d.createdAt > latest ? d.createdAt : latest),
    undefined,
  );

  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    tokenId: agent.erc8004TokenId,
    chainName: activeChain().name,
    policyVersion: policy?.version,
    policyHash: policy?.policyHash,
    policyAnchored: Boolean(policy?.onchainTxHash),
    decisions: decisions.length,
    decisionsCapped: decisions.length >= SEAL_DECISION_LIMIT,
    refused: decisions.filter((d) => d.outcome === 'DENY').length,
    lastDecisionAt: last,
  };
}

/** `GET /seal/<id>.svg`, and `?style=badge` for the one-line form. */
export async function sealResponse(request: Request, file: string): Promise<Response> {
  const id = file.replace(/\.svg$/i, '');
  const data = await sealData(id);
  if (!data) return new Response('Unknown agent', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

  const badge = new URL(request.url).searchParams.get('style') === 'badge';
  return new Response(badge ? renderSealBadge(data) : renderSealCard(data), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Short, so a suspension shows on the operator's page within a minute.
      'cache-control': 'public, max-age=60',
      // It is embedded from other origins by design, and opened directly it
      // must stay an image: no script, no fetch, nothing but its own shapes.
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  });
}
