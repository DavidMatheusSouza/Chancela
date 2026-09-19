import { rawIntentSchema, type RawIntent } from '@trustagent/shared';
import { IntentExtractionError } from './types';

/**
 * Turn whatever the model returned into a RawIntent, or fail.
 *
 * Three things happen here that matter:
 *  1. Markdown fences and leading prose are stripped -- models add them.
 *  2. The result is parsed with a .strict() schema, so any smuggled field
 *     ("decision", "authorized", "risk": "LOW") is rejected outright rather
 *     than silently carried forward.
 *  3. Failure throws. It never degrades into a permissive default.
 */
export function parseIntent(rawText: string, provider: string): RawIntent {
  const candidate = extractJSONBlock(rawText);
  if (!candidate) {
    throw new IntentExtractionError('No JSON object found in model output', provider);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(candidate);
  } catch (err) {
    throw new IntentExtractionError('Model output was not valid JSON', provider, err);
  }

  const result = rawIntentSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new IntentExtractionError(
      `Model output failed the intent schema: ${result.error.issues
        .map((i) => `${i.path.join('.') || '<root>'} ${i.message}`)
        .join('; ')}`,
      provider,
    );
  }
  return result.data;
}

function extractJSONBlock(text: string): string | null {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1]?.trim() ?? trimmed;

  const start = body.indexOf('{');
  if (start === -1) return null;

  // Walk to the matching brace so trailing commentary is ignored.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}
