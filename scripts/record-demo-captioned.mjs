/**
 * Record the technical demo video: landing page, the no-login demo button, the
 * full guided run, then the attack on /live that Monad reverts and that
 * refusal's proof page, where the policy engine runs it again -- against the
 * live site, so it shows whatever actually happened.
 *
 * It notes the moment each step appears (marks.json), and
 * scripts/caption-demo.py turns those into captions that are timed to this
 * run rather than to a guess:
 *
 *   npx playwright install chromium                       # once
 *   node scripts/record-demo-captioned.mjs https://chancela.xyz recording
 *   python3 scripts/caption-demo.py recording             # -> recording/chancela-technical-demo.mp4
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const BASE = process.argv[2] ?? 'https://chancela.xyz';
const OUT = process.argv[3] ?? 'recording';
mkdirSync(OUT, { recursive: true });
const SIZE = { width: 1920, height: 1080 };
// The site is laid out for a desk monitor; in a video it is watched in a small
// player. Zooming the page keeps the recording sharp (it is still 1920x1080)
// and makes the text readable there.
const ZOOM = Number(process.env.ZOOM ?? 1.35);
const QUESTIONS = {
  identity: 'Who is this agent, and what may it do?',
  allow: 'It asks for something inside its policy.',
  proof: 'Can anyone check that this happened?',
  deny: 'Now an order bigger than its policy allows.',
  injection: 'Can the instruction talk its way past the policy?',
  breaker: 'And if it simply keeps trying?',
  approval: 'Inside the rules — but too much for the agent alone.',
  audit: 'Was every attempt written down?',
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: SIZE }, colorScheme: 'dark' });
await context.addInitScript((z) => {
  const apply = () => { if (document.documentElement) document.documentElement.style.zoom = String(z); };
  apply(); document.addEventListener('DOMContentLoaded', apply); window.addEventListener('load', apply);
}, ZOOM);
const page = await context.newPage();
// Hydration can reset <html>'s inline style, so the zoom is put back after every navigation.
const zoom = () => page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, ZOOM);
// Keep the current demo step at the top of the frame, clear of the captions.
const frameStep = () => page.getByRole('button', { name: /Agent identity/ }).first()
  .evaluate((el) => { el.style.scrollMarginTop = '16px'; el.scrollIntoView({ block: 'start' }); }).catch(() => {});
const t0 = Date.now(); const marks = {}; const mark = (k) => { if (!(k in marks)) { marks[k] = (Date.now() - t0) / 1000; console.log(k, marks[k].toFixed(1)); } };
try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await zoom(); mark('landing');
  await page.waitForTimeout(4000);
  // The three proofs under the hero: executed, reverted, Claude Code's attempt.
  await page.mouse.wheel(0, Math.round(560 * ZOOM)); mark('proofs');
  await page.waitForTimeout(7000);
  await page.mouse.wheel(0, -Math.round(560 * ZOOM));
  await page.waitForTimeout(1200);
  await page.getByRole('link', { name: /run the live demo/i }).first().click();
  await page.waitForURL('**/demo', { timeout: 30000 }); await page.waitForLoadState('networkidle'); await zoom(); mark('demo');
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: /run full demo/i }).click(); mark('run');
  const deadline = Date.now() + 190000;
  while (Date.now() < deadline) {
    for (const [k, q] of Object.entries(QUESTIONS)) if (!(k in marks) && await page.getByText(q, { exact: true }).count()) mark(k);
    if ('audit' in marks && (Date.now() - t0) / 1000 - marks.audit > 9) break;
    await zoom(); await frameStep();
    await page.waitForTimeout(500);
  }
  // The on-chain half: the agent is told to buy $25,000, the policy refuses,
  // the agent sends the order to the venue anyway and Monad reverts it.
  await page.goto(`${BASE}/live`, { waitUntil: 'networkidle' }); await zoom(); mark('live');
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: /\$25,000 of MON/ }).click(); mark('attack');
  await page.getByText('Monad reverted it', { exact: false }).waitFor({ timeout: 90000 }); mark('reverted');
  await page.getByRole('status').scrollIntoViewIfNeeded();
  await page.waitForTimeout(7000);
  marks.tx = await page.getByRole('link', { name: /see the reverted transaction/i }).getAttribute('href');
  // The refusal's own proof page: the checks against Monad, then the policy
  // engine run again on the recorded inputs. Wait until the decision is anchored
  // so the page shows the finished proof, not one still in flight.
  const proof = page.getByRole('link', { name: /open the proof/i });
  marks.auditId = (await proof.getAttribute('href')).split('/').pop();
  for (let i = 0; i < 40; i++) {
    const body = await (await page.request.get(`${BASE}/api/proofs/${marks.auditId}`)).json().catch(() => ({}));
    if (body?.anchor?.status === 'CONFIRMED') break;
    await page.waitForTimeout(500);
  }
  mark('openproof');
  await proof.click();
  await page.waitForURL('**/proof/**', { timeout: 30000 }); await page.waitForLoadState('networkidle'); await zoom(); mark('replay');
  await page.waitForTimeout(4500);
  await page.getByRole('heading', { name: 'Run it again' }).evaluate((el) => { el.style.scrollMarginTop = '24px'; el.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  await page.waitForTimeout(9000);
  mark('end');
} finally {
  writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks, null, 1));
  await context.close(); await browser.close();
}
