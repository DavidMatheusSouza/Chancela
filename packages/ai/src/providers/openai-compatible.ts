import { parseIntent } from '../parse';
import { buildSystemPrompt, wrapUserInput } from '../prompt';
import { IntentExtractionError, type AIProvider, type IntentRequest, type IntentResult } from '../types';

export interface OpenAICompatibleConfig {
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  /** Qwen 3.8-Max and Kimi both support strict JSON Schema; OpenAI uses the same field. */
  useJsonSchema?: boolean;
  timeoutMs?: number;
}

const INTENT_JSON_SCHEMA = {
  name: 'intent',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'parameters', 'confidence', 'rationale'],
    properties: {
      action: { type: 'string' },
      parameters: { type: 'object', additionalProperties: true },
      confidence: { type: 'number' },
      rationale: { type: 'string' },
    },
  },
} as const;

/**
 * One implementation covering every OpenAI-shaped chat API.
 *
 * Qwen (Alibaba Cloud Model Studio), Kimi (Moonshot) and OpenAI all speak this
 * protocol, so the differences between vendors collapse into configuration.
 * That is the point: the model layer is commodity precisely because it holds
 * no authority.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.name = config.name;
    this.model = config.model;
  }

  async extractIntent(req: IntentRequest): Promise<IntentResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 20_000);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: controller.signal,
        // Next.js caches server-side fetches, POSTs included. A cached answer
        // here would be last week's model reading today's request. Node's own
        // RequestInit type does not declare `cache`, though fetch honours it.
        ...({ cache: 'no-store' } as Record<string, unknown>),
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          messages: [
            { role: 'system', content: buildSystemPrompt(req.toolCatalog) },
            { role: 'user', content: wrapUserInput(req.utterance) },
          ],
          ...(this.config.useJsonSchema
            ? { response_format: { type: 'json_schema', json_schema: INTENT_JSON_SCHEMA } }
            : { response_format: { type: 'json_object' } }),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new IntentExtractionError(
          `${this.name} returned ${response.status}: ${body.slice(0, 300)}`,
          this.name,
        );
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = json.choices?.[0]?.message?.content ?? '';
      if (!raw) throw new IntentExtractionError('Empty completion', this.name);

      return {
        intent: parseIntent(raw, this.name),
        provider: this.name,
        model: this.config.model,
        raw,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof IntentExtractionError) throw err;
      throw new IntentExtractionError(
        err instanceof Error ? err.message : 'request failed',
        this.name,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Alibaba Cloud Model Studio -- qwen3.8-max, strict JSON Schema. */
export function createQwenProvider(apiKey: string, model = 'qwen3.8-max'): AIProvider {
  return new OpenAICompatibleProvider({
    name: 'qwen',
    model,
    baseUrl:
      process.env.QWEN_BASE_URL ??
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKey,
    useJsonSchema: true,
  });
}

/** Moonshot / Kimi -- OpenAI-compatible at /v1. */
export function createKimiProvider(apiKey: string, model = 'kimi-k2.6'): AIProvider {
  return new OpenAICompatibleProvider({
    name: 'kimi',
    model,
    baseUrl: process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1',
    apiKey,
    useJsonSchema: true,
  });
}

/**
 * Groq -- OpenAI-compatible, free tier, no card.
 *
 * `json_object` rather than strict JSON Schema: schema support varies by model
 * here, and the Zod gate in `parseIntent` rejects anything malformed anyway. A
 * provider that occasionally returns unparseable JSON degrades intent quality;
 * it cannot widen authorization, which is the only guarantee that matters.
 */
export function createGroqProvider(apiKey: string, model = 'openai/gpt-oss-120b'): AIProvider {
  return new OpenAICompatibleProvider({
    name: 'groq',
    model,
    baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    apiKey,
    useJsonSchema: false,
  });
}

/** OpenRouter -- one key, many models, several of them free. */
export function createOpenRouterProvider(
  apiKey: string,
  model = 'meta-llama/llama-3.3-70b-instruct:free',
): AIProvider {
  return new OpenAICompatibleProvider({
    name: 'openrouter',
    model,
    baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey,
    useJsonSchema: false,
  });
}

export function createOpenAIProvider(apiKey: string, model = 'gpt-4o-mini'): AIProvider {
  return new OpenAICompatibleProvider({
    name: 'openai',
    model,
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey,
    useJsonSchema: true,
  });
}
