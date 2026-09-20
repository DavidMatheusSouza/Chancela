/**
 * Record the guided demo as a silent screen capture.
 *
 * It drives the real site: signs in as the demo owner, opens /demo, presses
 * Run full demo and watches the six steps land. Nothing is simulated, so the
 * recording shows whatever actually happened -- including a slow anchor.
 *
 * There is no narration. Voice has to be recorded over this, or burnt in as
 * captions; see docs/DEMO.md for the script that matches these beats.
 *
 *   node scripts/record-demo.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3080';
const OUT = process.argv[3] ?? 'recording';
// 1080p: the brief names a projector at this size, and text has to survive it.
const SIZE = { width: 1920, height: 1080 };

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: SIZE },
  colorScheme: 'dark',
});
const page = await context.newPage();

const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`);

try {
  // Sign in through the same endpoint the button calls.
  const res = await page.request.post(`${BASE}/api/auth/dev`, { data: {} });
  if (!res.ok()) throw new Error(`demo sign-in failed: ${res.status()}`);
  log('signed in as the demo owner');

  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  log('opened /demo');
  await page.waitForTimeout(3500); // let the viewer read the header

  await page.getByRole('button', { name: /run full demo/i }).click();
  log('started the run');

  // The run is six steps; the action steps wait on a live model and a live
  // anchor, so this follows the clock rather than racing it.
  for (let elapsed = 0; elapsed < 75; elapsed += 5) {
    await page.waitForTimeout(5000);
    log(`  ${elapsed + 5}s`);
  }

  // Finish on the record, which is the frame worth pausing on.
  await page.waitForTimeout(4000);
  log('run complete');
} finally {
  await context.close(); // flushes the video file
  await browser.close();
}

log(`video written to ${OUT}/`);
