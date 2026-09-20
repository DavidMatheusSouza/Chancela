/**
 * Session cookies.
 *
 * A session is a compact signed token, not an opaque id in a store, so the
 * middleware can verify it at the edge without a database round trip on every
 * request. HMAC-SHA256 via Web Crypto, which exists in both the edge runtime
 * and Node.
 *
 * The identity in the session is an Ethereum address, because that is what
 * ownership means here: an agent's owner is whoever `ownerOf()` returns on the
 * ERC-8004 registry. Authorisation to change a policy is therefore tied to the
 * same key the chain recognises, not to a parallel account system.
 */

export const SESSION_COOKIE = 'chancela_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionPayload {
  /** Owner address, EIP-55 checksummed. */
  address: string;
  /** Where the session came from. */
  method: 'wallet' | 'privy' | 'passkey';
  issuedAt: number;
  expiresAt: number;
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters');
  }
  return value;
}

function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSession(
  address: string,
  method: SessionPayload['method'],
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    address,
    method,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
  };

  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await signBody(body)}`;
}

async function signBody(body: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(),
    new TextEncoder().encode(body),
  );
  return b64urlEncode(signature);
}

/**
 * Compare two strings without leaking their difference through timing.
 *
 * A plain `===` short-circuits at the first differing byte, which lets an
 * attacker discover a valid signature one character at a time.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify and decode. Returns null for anything suspect -- an expired session, a
 * bad signature and a malformed token are all just "not signed in", because
 * distinguishing them for the caller only helps an attacker.
 *
 * Verification recomputes the HMAC and compares, rather than calling
 * `crypto.subtle.verify`. The two are equivalent in principle, but `verify`
 * behaves differently across the Node and Edge runtimes, and this code runs in
 * both -- middleware on the edge, route handlers in Node. Recomputing is
 * identical everywhere.
 */
export async function readSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;

  const separator = token.indexOf('.');
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!body || !signature) return null;

  try {
    const expected = await signBody(body);
    if (!constantTimeEqual(signature, expected)) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(new Uint8Array(b64urlDecode(body))),
    ) as SessionPayload;

    if (typeof payload.address !== 'string' || typeof payload.expiresAt !== 'number') return null;
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(request?: { url?: string; headers?: Headers }) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: !isLocalPlainHttp(request),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

function isLocalPlainHttp(request?: { url?: string; headers?: Headers }): boolean {
  if (!request?.url) return false;
  try {
    const forwardedProto = request.headers?.get('x-forwarded-proto');
    if (forwardedProto && forwardedProto !== 'http') return false;

    const url = new URL(request.url);
    if (url.protocol !== 'http:') return false;
    return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(url.hostname);
  } catch {
    return false;
  }
}
