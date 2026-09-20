import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789abcdef';
delete process.env.POLICY_REGISTRY_ADDRESS;
delete process.env.DATABASE_URL;

const { demoSignIn, demoSignInAllowed, safeNext } = await import('../src/lib/demo-signin.js');
const { readSession } = await import('../src/lib/session.js');

const DEMO_OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

afterEach(() => vi.unstubAllEnvs());

describe('demo sign-in', () => {
  it('starts a real session for the seeded demo owner', async () => {
    const result = await demoSignIn();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.address).toBe(DEMO_OWNER);
    expect((await readSession(result.token))?.address).toBe(DEMO_OWNER);
  });

  it('is off in production unless explicitly allowed', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_DEV_SIGNIN', '');
    expect(demoSignInAllowed()).toBe(false);
    expect(await demoSignIn()).toMatchObject({ ok: false, status: 404 });

    vi.stubEnv('ALLOW_DEV_SIGNIN', 'true');
    expect(demoSignInAllowed()).toBe(true);
  });
});

describe('safeNext', () => {
  it('keeps a path on this site', () => {
    expect(safeNext('/demo')).toBe('/demo');
    expect(safeNext('/agents/TA-001?tab=audit')).toBe('/agents/TA-001?tab=audit');
  });

  it.each([null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'demo'])(
    'falls back to /demo for %s',
    (raw) => expect(safeNext(raw)).toBe('/demo'),
  );
});
