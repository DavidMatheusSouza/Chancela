/**
 * End-to-end check of the passkey path, with a real WebAuthn ceremony.
 *
 * Chromium gets a virtual CTAP2 authenticator with the PRF extension, so this
 * exercises the same code a fingerprint would: create an account, land on
 * /keys, unlock with the same passkey, sign with a derived agent key, bind it
 * with a proof of possession, then reload and confirm the same passkey
 * reproduces the same address.
 *
 * It writes to whatever store the app uses -- it creates a real owner and a
 * real starter agent. Run it against a disposable database.
 *
 *   npx playwright install chromium
 *   node scripts/e2e-passkey.mjs shot.png      # app must be on localhost:3080
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:3080';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
  protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
  isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
const log = (m) => console.log(m);
page.on('console', (m) => { if (m.type() === 'error') log('  [browser error] ' + m.text().slice(0, 160)); });
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /create an account with a passkey/i }).click();
  await page.waitForURL(/\/keys/, { timeout: 30000 });
  log('1. passkey criada -> conta criada -> caiu em ' + new URL(page.url()).pathname);

  const me = await (await page.request.get(`${BASE}/api/auth/me`)).json();
  log('2. sessao: ' + JSON.stringify(me).slice(0, 140));

  await page.getByRole('button', { name: /unlock with passkey/i }).click();
  await page.getByText(/Unlocked/).waitFor({ timeout: 20000 });
  log('3. /keys destravado com a MESMA passkey');
  log('   dono confere com a sessao? ' + (await page.getByText('Your sign-in identity').count() ? 'SIM' : 'NAO'));

  await page.getByRole('button', { name: /sign a test/i }).first().click();
  await page.getByText(/signature verifies against this address/).waitFor({ timeout: 15000 });
  log('4. chave do agente assinou; assinatura verifica contra o endereco derivado');

  await page.getByRole('button', { name: /bind as wallet/i }).first().click();
  await page.getByText('Bound as wallet').waitFor({ timeout: 20000 });
  log('5. carteira vinculada (servidor verificou a prova de posse)');
  await page.screenshot({ path: process.argv[2] });

  // Second visit: a fresh page, same authenticator -> must reproduce the same keys.
  const addr1 = await page.locator('tbody tr').nth(1).locator('td').nth(2).innerText();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /unlock with passkey/i }).click();
  await page.getByText(/Unlocked/).waitFor({ timeout: 20000 });
  const addr2 = await page.locator('tbody tr').nth(1).locator('td').nth(2).innerText();
  log('6. determinismo: mesma passkey -> mesmo endereco? ' + (addr1.split('\n')[0] === addr2.split('\n')[0] ? 'SIM ' + addr2.split('\n')[0] : `NAO (${addr1} vs ${addr2})`));
  log('   ainda vinculada apos recarregar? ' + (await page.getByText('Bound as wallet').count() ? 'SIM' : 'NAO'));
} catch (e) {
  log('FALHOU: ' + e.message.split('\n')[0]);
  await page.screenshot({ path: process.argv[2] });
} finally { await browser.close(); }
