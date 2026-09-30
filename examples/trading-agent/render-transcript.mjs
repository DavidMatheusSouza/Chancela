// Turns a `claude -p --output-format stream-json` log into Markdown, adding
// nothing but headings: every model message and tool result is printed whole.
import { readFileSync } from 'node:fs';

const [file, prompt] = process.argv.slice(2);
const events = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const out = [];
const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
const result = events.find((e) => e.type === 'result');

out.push('# Claude Code as a trading agent — unedited transcript', '');
out.push(`Recorded ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC with \`examples/trading-agent/claude-code-session.sh\`.`);
out.push(`Model: \`${init?.model ?? 'unknown'}\`. Tools available to the model: ${(init?.tools ?? []).map((t) => `\`${t}\``).join(', ') || 'none'}.`);
out.push('The raw event stream is in the `.jsonl` file next to this one; this is the same content, formatted.', '');
out.push('## Prompt', '', '```text', prompt, '```', '');

for (const e of events) {
  const blocks = e.message?.content;
  if (!Array.isArray(blocks)) continue;
  for (const b of blocks) {
    if (e.type === 'assistant' && b.type === 'text' && b.text.trim()) out.push('## Claude', '', b.text.trim(), '');
    if (e.type === 'assistant' && b.type === 'tool_use') {
      out.push(`### → \`${b.name}\``, '', '```json', JSON.stringify(b.input, null, 2), '```', '');
    }
    if (e.type === 'user' && b.type === 'tool_result') {
      const text = Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join('\n') : String(b.content);
      out.push(`### ← ${b.is_error ? 'error' : 'result'}`, '', '```json', text, '```', '');
    }
  }
}
if (result) out.push('---', '', `${result.num_turns} turns · ${(result.duration_ms / 1000).toFixed(1)} s`);
console.log(out.join('\n'));
