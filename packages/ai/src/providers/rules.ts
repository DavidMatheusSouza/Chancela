import { TOOL_REGISTRY } from '@trustagent/shared';
import type { AIProvider, IntentRequest, IntentResult } from '../types';

/**
 * Deterministic keyword provider.
 *
 * Exists so the product is demonstrable with no API key and no network, and so
 * CI can exercise the full authorize -> execute path without a vendor. It is
 * intentionally crude: if a naive keyword matcher and a frontier model produce
 * the same authorization outcomes, that is evidence the model is not where the
 * security lives.
 */
export class RulesProvider implements AIProvider {
  readonly name = 'rules';
  readonly model = 'keyword-v1';

  async extractIntent(req: IntentRequest): Promise<IntentResult> {
    const started = Date.now();
    const text = req.utterance.toLowerCase();

    const action = matchAction(text);
    const parameters = extractParameters(action, req.utterance);

    return {
      intent: {
        action,
        parameters,
        confidence: action === 'UNKNOWN' ? 0.1 : 0.6,
        rationale: 'Keyword match (deterministic provider).',
      },
      provider: this.name,
      model: this.model,
      raw: JSON.stringify({ action, parameters }),
      latencyMs: Date.now() - started,
    };
  }
}

const KEYWORDS: Array<[string, RegExp]> = [
  ['TRANSFER_FUNDS', /\b(transfer\w*|transfir\w*|transfer[ei]\w*|send money|wire|pay out|remit|envi\w+)\b/],
  ['CREATE_CUSTOMER', /\b(create|add|register|new)\b.*\b(customer|client|cliente)\b/],
  ['DELETE_CUSTOMER', /\b(delete|remove|erase)\b.*\b(customer|client|cliente)\b/],
  ['UPDATE_CUSTOMER', /\b(update|edit|change)\b.*\b(customer|client|cliente)\b/],
  ['READ_CUSTOMERS', /\b(list|show|read|find|search)\b.*\b(customer|client|cliente)/],
  ['SEND_PROPOSAL', /\b(proposal|quote|orçamento|proposta)\b/],
  ['SEND_MESSAGE', /\b(message|whatsapp|email|mensagem)\b/],
  ['READ_TREASURY', /\b(balance|treasury|saldo)\b/],
  ['CHANGE_POLICY', /\b(policy|permission|policies|permissão)\b/],
  ['DELETE_AGENT', /\b(delete|revoke)\b.*\bagent\b/],
  ['CHANGE_OWNER', /\b(change|transfer)\b.*\bowner/],
];

function matchAction(text: string): string {
  for (const [action, pattern] of KEYWORDS) {
    if (pattern.test(text)) return action;
  }
  return 'UNKNOWN';
}

function extractParameters(action: string, original: string): Record<string, unknown> {
  switch (action) {
    case 'CREATE_CUSTOMER':
    case 'UPDATE_CUSTOMER':
    case 'DELETE_CUSTOMER': {
      const name = original.match(/\b(?:named|called|chamado|chamada)\s+([\p{L}][\p{L}\s'-]{0,60})/iu)?.[1];
      return name ? { name: name.trim() } : {};
    }
    case 'TRANSFER_FUNDS': {
      const amount = parseAmount(original);
      const recipient = original.match(/\b(?:to|para|pro)\s+([\p{L}][\p{L}\s'-]{0,60})/iu)?.[1];
      const params: Record<string, unknown> = { currency: 'USD' };
      if (amount !== undefined) params.amount = amount;
      if (recipient) params.recipient = recipient.trim();
      return params;
    }
    default:
      return {};
  }
}

/**
 * Parse a monetary amount into minor units (cents).
 *
 * Handles "$5,000", "R$ 5.000,00", "5000" and "5.5". The separator is
 * classified by what follows it: 1-2 trailing digits means a decimal point,
 * 3 or more means digit grouping. That heuristic is ambiguous for a value like
 * "1,50" in a locale that groups by comma -- and it resolves that ambiguity
 * upward, reading 150 rather than 1.50. Over-reading an amount can only make an
 * action look more expensive, which tightens the limit check. Under-reading
 * would loosen it, so the bias points the safe way on purpose.
 */
function parseAmount(text: string): number | undefined {
  const match = text.match(/(?:r\$|\$|usd|brl|eur)?\s*(\d[\d.,]*)/i);
  const raw = match?.[1];
  if (!raw) return undefined;

  const lastSeparator = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));

  let integerPart: string;
  let fractionPart: string;

  if (lastSeparator === -1) {
    integerPart = raw;
    fractionPart = '00';
  } else {
    const tail = raw.slice(lastSeparator + 1);
    if (/^\d{1,2}$/.test(tail)) {
      integerPart = raw.slice(0, lastSeparator).replace(/[.,]/g, '');
      fractionPart = tail.padEnd(2, '0');
    } else {
      integerPart = raw.replace(/[.,]/g, '');
      fractionPart = '00';
    }
  }

  const units = Number.parseInt(integerPart || '0', 10);
  const cents = Number.parseInt(fractionPart, 10);
  if (!Number.isSafeInteger(units) || !Number.isSafeInteger(cents)) return undefined;
  return units * 100 + cents;
}

/** Registry-aware tool catalogue for prompts. */
export const DEFAULT_TOOL_CATALOGUE = TOOL_REGISTRY;
