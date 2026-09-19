import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, readSession } from '@/lib/session';

/**
 * Authentication gate.
 *
 * Deny by default, mirroring the policy engine: everything under the matcher is
 * protected unless it is on the explicit public list. Adding a page does not
 * accidentally expose it.
 *
 * `/api/agents/:id/authorize` is deliberately public. It is the endpoint other
 * agent runtimes call, and it grants nothing on its own — it returns a signed
 * decision, which may well be a denial. Gating it behind a browser session
 * would make TrustAgent an application rather than infrastructure.
 */
const PUBLIC_PATHS = ['/', '/login'];
// `/api/network/status` joins the health checks: it reports only the chain id,
// the public RPC and the registry addresses, all of which are already published
// in the docs and readable on-chain by anyone.
const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/health', '/api/network/status', '/api/tools'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Agent-facing authorization and execution endpoints.
  if (/^\/api\/agents\/[^/]+\/(authorize|actions)$/.test(pathname)) return true;
  // Agent cards are public by design: ERC-8004 discovery depends on them.
  if (pathname.startsWith('/.well-known/agent-card/')) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in to use this endpoint' } },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
