import { beforeEach, describe, expect, it } from 'vitest';

const { clearRateLimits, callerKey, rateLimit, rateLimitCaller } = await import('../src/lib/http');

const from = (ip?: string) =>
  new Request('https://chancela.xyz/api/auth/nonce', {
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  });

describe('callerKey', () => {
  it('prefers the header the proxy sets', () => {
    expect(callerKey(from('203.0.113.7'))).toBe('203.0.113.7');
  });

  it('takes the first hop of x-forwarded-for', () => {
    const request = new Request('https://chancela.xyz/', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(callerKey(request)).toBe('203.0.113.9');
  });

  it('falls back to a shared identity when there is no proxy', () => {
    expect(callerKey(from())).toBe('direct');
  });
});

describe('rateLimitCaller', () => {
  beforeEach(() => clearRateLimits());

  /*
   * The bug this covers: every sign-in endpoint shared one bucket, so the
   * first visitor to spend it locked out everyone else -- during judging,
   * silently, with a redirect to /login that still answers 200.
   */
  it('does not let one caller spend the allowance of another', () => {
    for (let i = 0; i < 3; i++) expect(rateLimitCaller(from('1.1.1.1'), 'demo', 3, 100)).toBe(true);
    expect(rateLimitCaller(from('1.1.1.1'), 'demo', 3, 100)).toBe(false);

    // A different visitor arrives to an untouched allowance.
    expect(rateLimitCaller(from('2.2.2.2'), 'demo', 3, 100)).toBe(true);
  });

  it('still stops a flood from many callers at the ceiling', () => {
    let granted = 0;
    for (let i = 0; i < 40; i++) {
      if (rateLimitCaller(from(`10.0.0.${i}`), 'flood', 5, 12)) granted++;
    }
    expect(granted).toBe(12);
  });

  it('keeps counting the caller that is over its own limit', () => {
    expect(rateLimitCaller(from('3.3.3.3'), 'tight', 1, 100)).toBe(true);
    expect(rateLimitCaller(from('3.3.3.3'), 'tight', 1, 100)).toBe(false);
    expect(rateLimitCaller(from('3.3.3.3'), 'tight', 1, 100)).toBe(false);
  });

  it('forgets a window once it has passed', () => {
    expect(rateLimit('short', 1, 1)).toBe(true);
    expect(rateLimit('short', 1, 1)).toBe(false);
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(rateLimit('short', 1, 1)).toBe(true);
        resolve();
      }, 5),
    );
  });
});
