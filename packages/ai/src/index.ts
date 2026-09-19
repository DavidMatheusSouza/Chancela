export * from './types';
export * from './prompt';
export * from './parse';
export * from './providers/openai-compatible';
export { RulesProvider, DEFAULT_TOOL_CATALOGUE } from './providers/rules';

import { RulesProvider } from './providers/rules';
import {
  createKimiProvider,
  createOpenAIProvider,
  createQwenProvider,
} from './providers/openai-compatible';
import type { AIProvider } from './types';

/**
 * Pick a provider from the environment.
 *
 * Falls back to the deterministic rules provider rather than failing, so the
 * product always runs. A missing API key degrades intent quality -- never
 * authorization.
 */
export function resolveProvider(preferred?: string): AIProvider {
  const choice = (preferred ?? process.env.AI_PROVIDER ?? 'auto').toLowerCase();

  if (choice === 'qwen' || (choice === 'auto' && process.env.QWEN_API_KEY)) {
    const key = process.env.QWEN_API_KEY;
    if (key) return createQwenProvider(key, process.env.QWEN_MODEL);
  }
  if (choice === 'kimi' || (choice === 'auto' && process.env.KIMI_API_KEY)) {
    const key = process.env.KIMI_API_KEY;
    if (key) return createKimiProvider(key, process.env.KIMI_MODEL);
  }
  if (choice === 'openai' || (choice === 'auto' && process.env.OPENAI_API_KEY)) {
    const key = process.env.OPENAI_API_KEY;
    if (key) return createOpenAIProvider(key, process.env.OPENAI_MODEL);
  }
  return new RulesProvider();
}

export function availableProviders(): Array<{ id: string; configured: boolean; model: string }> {
  return [
    { id: 'qwen', configured: Boolean(process.env.QWEN_API_KEY), model: process.env.QWEN_MODEL ?? 'qwen3.8-max' },
    { id: 'kimi', configured: Boolean(process.env.KIMI_API_KEY), model: process.env.KIMI_MODEL ?? 'kimi-k2.6' },
    { id: 'openai', configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini' },
    { id: 'rules', configured: true, model: 'keyword-v1' },
  ];
}
