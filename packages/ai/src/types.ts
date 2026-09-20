import type { RawIntent, ToolDescriptor } from '@chancela/shared';

export interface IntentRequest {
  utterance: string;
  toolCatalog: readonly ToolDescriptor[];
  agentName: string;
}

export interface IntentResult {
  intent: RawIntent;
  provider: string;
  model: string;
  /** Raw model text, kept for the audit record. Never re-fed into a decision. */
  raw: string;
  latencyMs: number;
}

/**
 * The only contract an AI vendor has with Chancela.
 *
 * Narrow on purpose. A provider turns prose into a candidate action name plus
 * parameters, and that is all it can ever do. Swapping Qwen for Kimi cannot
 * change an authorization outcome, because neither one participates in it.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  extractIntent(req: IntentRequest): Promise<IntentResult>;
}

export class IntentExtractionError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IntentExtractionError';
  }
}
