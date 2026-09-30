export * from './types';
export * from './prompt';
export * from './parse';
export * from './providers/openai-compatible';
export { RulesProvider, DEFAULT_TOOL_CATALOGUE } from './providers/rules';

import { RulesProvider } from './providers/rules';
import {
  createGroqProvider,
  createHunyuanProvider,
  createKimiProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
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
  if (choice === 'hunyuan' || (choice === 'auto' && process.env.HUNYUAN_API_KEY)) {
    const key = process.env.HUNYUAN_API_KEY;
    if (key) return createHunyuanProvider(key, process.env.HUNYUAN_MODEL);
  }
  if (choice === 'groq' || (choice === 'auto' && process.env.GROQ_API_KEY)) {
    const key = process.env.GROQ_API_KEY;
    if (key) return createGroqProvider(key, process.env.GROQ_MODEL);
  }
  if (choice === 'openrouter' || (choice === 'auto' && process.env.OPENROUTER_API_KEY)) {
    const key = process.env.OPENROUTER_API_KEY;
    if (key) return createOpenRouterProvider(key, process.env.OPENROUTER_MODEL);
  }
  if (choice === 'openai' || (choice === 'auto' && process.env.OPENAI_API_KEY)) {
    const key = process.env.OPENAI_API_KEY;
    if (key) return createOpenAIProvider(key, process.env.OPENAI_MODEL);
  }
  return new RulesProvider();
}

export interface ProviderInfo {
  id: string;
  /** Vendor name as a person would say it. */
  label: string;
  configured: boolean;
  model: string;
  docs: string;
}

export function availableProviders(): ProviderInfo[] {
  const env = process.env;
  return [
    { id: 'qwen', label: 'Qwen (Alibaba Cloud)', configured: Boolean(env.QWEN_API_KEY), model: env.QWEN_MODEL ?? 'qwen3.8-max', docs: 'https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max' },
    { id: 'kimi', label: 'Kimi (Moonshot)', configured: Boolean(env.KIMI_API_KEY), model: env.KIMI_MODEL ?? 'kimi-k2.6', docs: 'https://platform.moonshot.ai/' },
    { id: 'hunyuan', label: 'Hunyuan (Tencent Cloud)', configured: Boolean(env.HUNYUAN_API_KEY), model: env.HUNYUAN_MODEL ?? 'hy4-preview', docs: 'https://www.tencentcloud.com/act/pro/tokenhub' },
    { id: 'groq', label: 'Groq', configured: Boolean(env.GROQ_API_KEY), model: env.GROQ_MODEL ?? 'openai/gpt-oss-120b', docs: 'https://console.groq.com/docs' },
    { id: 'openrouter', label: 'OpenRouter', configured: Boolean(env.OPENROUTER_API_KEY), model: env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free', docs: 'https://openrouter.ai/docs' },
    { id: 'openai', label: 'OpenAI', configured: Boolean(env.OPENAI_API_KEY), model: env.OPENAI_MODEL ?? 'gpt-4o-mini', docs: 'https://platform.openai.com/docs' },
    { id: 'rules', label: 'Deterministic parser', configured: true, model: 'keyword-v1', docs: '' },
  ];
}
