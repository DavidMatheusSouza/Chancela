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
// `/opengraph-image` is fetched by link-preview crawlers, which never carry a
// session. It renders static marketing copy and reads nothing.
const PUBLIC_PATHS = ['/', '/login', '/opengraph-image'];
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

  /*
   * `request.nextUrl` carries the origin this process is bound to, which
   * behind a tunnel or a reverse proxy is 127.0.0.1. Redirecting to it sent
   * visitors to localhost on their own machine -- a dead address, and the
   * first thing anyone following a link to a gated page would hit.
   *
   * PUBLIC_BASE_URL is preferred because it is configuration rather than
   * something a client can set. The forwarded headers are the fallback; they
   * are client-supplied in principle, but this origin listens only on
   * loopback, so they can only arrive through the proxy in front of it.
   */
  const forwardedHost = request.headers.get('x-forwarded-host');
  const base =
    process.env.PUBLIC_BASE_URL ??
    (forwardedHost
      ? `${request.headers.get('x-forwarded-proto') ?? 'https'}://${forwardedHost}`
      : request.nextUrl.origin);

  return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, base));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
