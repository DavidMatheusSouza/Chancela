import { describe, expect, it } from 'vitest';
import { callerKey, createAnchorBudget } from '../src/lib/anchor-budget';

const limits = { perCaller: 3, perCallerWindowMs: 600_000, perHour: 5, perDay: 8 };
const budget = () => createAnchorBudget(() => limits);
const T0 = 1_800_000_000_000;

describe('anchor budget', () => {
  it('lets one caller exhaust its own allowance, not everyone else\'s', () => {
    const b = budget();
    for (let i = 0; i < 3; i++) expect(b.take('loop', T0 + i).ok).toBe(true);
    expect(b.take('loop', T0 + 10)).toEqual({ ok: false, reason: 'CALLER' });
    expect(b.take('judge', T0 + 11).ok).toBe(true);
  });

  it('gives the caller its allowance back once the window has passed', () => {
    const b = budget();
    for (let i = 0; i < 3; i++) b.take('a', T0 + i);
    expect(b.take('a', T0 + 600_001).ok).toBe(true);
  });

  it('caps the hour across callers, however many there are', () => {
    const b = budget();
    for (let i = 0; i < 5; i++) expect(b.take(`ip-${i}`, T0 + i).ok).toBe(true);
    expect(b.take('ip-new', T0 + 10)).toEqual({ ok: false, reason: 'HOUR' });
    expect(b.take('ip-new', T0 + 3_600_005).ok).toBe(true);
  });

  it('caps the day even when every hour stays under its own cap', () => {
    const b = budget();
    let granted = 0;
    for (let h = 0; h < 4; h++) {
      for (let i = 0; i < 4; i++) if (b.take(`h${h}-${i}`, T0 + h * 3_600_001 + i).ok) granted++;
    }
    expect(granted).toBe(8);
    expect(b.take('late', T0 + 5 * 3_600_000)).toEqual({ ok: false, reason: 'DAY' });
  });

  it('does not count a refused request against anyone', () => {
    const b = budget();
    for (let i = 0; i < 3; i++) b.take('loop', T0 + i);
    for (let i = 0; i < 50; i++) b.take('loop', T0 + 100 + i);
    expect(b.usage(T0 + 200)).toMatchObject({ lastHour: 3, lastDay: 3 });
  });

  it('keys the caller on the address Cloudflare reports', () => {
    const req = (h: Record<string, string>) => new Request('http://x/', { headers: h });
    expect(callerKey(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' }))).toBe('203.0.113.7');
    expect(callerKey(req({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe('198.51.100.2');
    expect(callerKey(req({}))).toBe('direct');
  });
});
