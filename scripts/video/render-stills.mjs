import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
const S = process.argv[2];
// marks.json from the recording names the reverted transaction it caught.
const TX = process.argv[3] ?? 'the reverted order';
const DAY = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
mkdirSync(`${S}/stills`, { recursive: true }); mkdirSync(`${S}/video-out/slides`, { recursive: true });
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">';
const BASE = `<style>body{margin:0;background:#0F1217}section{width:1920px;height:1080px;box-sizing:border-box;position:relative;overflow:hidden}h1,h2,h3,p,ul,ol{margin:0}ul,ol{padding-left:1.2em}li{margin-bottom:10px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #2A313C;padding:0.45em 0.6em;text-align:left}a{color:inherit}aside{display:none}</style>`;
const order = JSON.parse(readFileSync(`${S}/deck/project/deck.json`, 'utf8')).order;
const pages = order.map((id, i) => [`s${i + 1}`, readFileSync(`${S}/deck/project/slides/${id}.html`, 'utf8')]);
// As large as the box allows: the longest line fits its width, every line its height.
const fit = (body) => {
  const lines = body.split('\n');
  const longest = Math.max(...lines.map((l) => l.length));
  return Math.min(34, Math.floor(1590 / (longest * 0.6)), Math.floor(700 / (lines.length * 1.45)));
};
const term = (title, cmd, body, note) => `<section style="background:#0B0D11;color:#D8DCE3;font-family:'JetBrains Mono',monospace;padding:90px 120px;display:flex;flex-direction:column;gap:28px">
<p style="font-family:'IBM Plex Sans',sans-serif;font-size:26px;color:#3FD1A6;letter-spacing:3px;text-transform:uppercase">${esc(title)}</p>
<div style="background:#12151B;border:1px solid #262D38;border-radius:14px;padding:36px 40px;flex:1;overflow:hidden">
<p style="font-size:26px;color:#3FD1A6">$ ${esc(cmd)}</p>
<pre style="font-family:'JetBrains Mono',monospace;font-size:${fit(body)}px;line-height:1.45;white-space:pre-wrap;margin:18px 0 0">${esc(body)}</pre></div>
<p style="font-family:'IBM Plex Sans',sans-serif;font-size:26px;color:#A7ADB8">${esc(note)}</p></section>`;
const read = (f) => readFileSync(`${S}/${f}`, 'utf8').trimEnd();
const short = (h) => (h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h);
pages.push(['t1', term('The chain’s own answer', `cast receipt ${short(TX)} --rpc-url https://testnet-rpc.monad.xyz`, read('receipt.txt'),
  `from = the agent’s wallet · to = the venue · status 0: Monad reverted the order the policy refused. Recorded ${DAY}.`)]);
pages.push(['t3', term('Same agent, same venue', 'cast receipt <both orders> --rpc-url https://testnet-rpc.monad.xyz', read('pair.txt'),
  'The order the policy allowed carried the attestor’s grant and was filled. The one it refused could not be.')]);
pages.push(['t4', term('Claude Code as the agent, unedited', 'bash examples/trading-agent/claude-code-session.sh', read('claude.txt'),
  'Claude complied with the forged exception. The exchange tool asked Chancela first. Full transcript: docs/transcripts in the repository.')]);
pages.push(['t2', term('Verify it yourself', 'npx chancela-check   (the on-chain half)', read('check-gate.txt'), `A real run on ${DAY}. Every line says who answered: Monad, your machine, or the service.`)]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, html] of pages) {
  const dir = name.startsWith('t') ? `${S}/stills` : `${S}/video-out/slides`;
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}${BASE}</head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log('rendered', name);
}
await browser.close();
