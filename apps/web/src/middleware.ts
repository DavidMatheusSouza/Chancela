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
 * would make Chancela an application rather than infrastructure.
 */
// `/opengraph-image` is fetched by link-preview crawlers, which never carry a
// session. It renders static marketing copy and reads nothing.
// `/robots.txt` and `/sitemap.xml` are fetched by crawlers, which never carry
// a session. Gating them behind the login redirect would tell every crawler
// that the site is a login page.
// `/privacy`, `/terms` and `/security.txt` say who runs the site and what it
// keeps. They are for the visitor who has not decided to trust it yet.
const PUBLIC_PATHS = [
  '/',
  '/live',
  '/pitch',
  '/login',
  '/privacy',
  '/terms',
  '/security.txt',
  '/opengraph-image',
  '/robots.txt',
  '/sitemap.xml',
];
// The pages that exist behind the session. Only these send a signed-out visitor
// to the sign-in page; see the end of `middleware`.
const SESSION_PAGE_PREFIXES = [
  '/dashboard',
  '/agents',
  '/policies',
  '/audit',
  '/activity',
  '/approvals',
  '/keys',
  '/settings',
  '/trust',
  '/integrations',
  '/demo',
];
// `/api/network/status` joins the health checks: it reports only the chain id,
// the public RPC and the registry addresses, all of which are already published
// in the docs and readable on-chain by anyone.
const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/health', '/api/network/status', '/api/tools'];

/** The same words as `app/not-found.tsx`, with no script and nothing to load. */
const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Nothing here - Chancela</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#090a0d;color:#eef1f6;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:28rem;padding:0 24px;text-align:center}
h1{margin:0;font-size:26px;font-weight:600;letter-spacing:-0.02em}
p{margin:8px 0 0;font-size:13.5px;line-height:1.6;color:#949ca9}
a{display:inline-block;margin-top:28px;padding:10px 16px;border:1px solid #21252d;border-radius:8px;background:#0e1014;color:#eef1f6;font-size:14px;text-decoration:none}
a:hover{border-color:#30363f}
</style>
</head>
<body>
<main>
<h1>Nothing here</h1>
<p>That address does not match an agent, a policy or a proof in this deployment.</p>
<a href="/">&larr; Back to Chancela</a>
</main>
</body>
</html>`;

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Agent-facing authorization and execution endpoints.
  if (/^\/api\/agents\/[^/]+\/(authorize|actions)$/.test(pathname)) return true;
  // Reading a passport, an audit trail or a proof. These are what accountability
  // means to anyone outside this service -- a wallet, another agent's runtime, a
  // reviewer -- and a proof that needs a login is verifiable by nobody but us.
  // The audit projection carries no parameters and no prompts, only what is
  // anchored plus the action name. PATCH on the agent path guards itself with
  // an ownership check, so opening the path here does not open the write.
  if (/^\/api\/agents\/[^/]+(\/audit)?$/.test(pathname)) return true;
  if (pathname.startsWith('/api/proofs/')) return true;
  // Visitors attacking the live agent. Takes an attack id only; see the route.
  if (pathname === '/api/live/attack') return true;
  // The same proofs, rendered and re-checked against Monad for a person.
  if (/^\/proof\/[^/]+$/.test(pathname)) return true;
  // An agent's passport, read-only: the page over `/api/agents/:id` and its audit
  // trail, which are public already. The console and the policy editor under
  // it stay behind the session, and every write checks ownership itself.
  if (/^\/agents\/[^/]+$/.test(pathname)) return true;
  // Where an agent's runtime waits for its owner's answer. The id is an
  // unguessable capability; approving through the same path checks the session
  // and the ownership itself.
  if (/^\/api\/approvals\/apr_[0-9a-f-]{36}$/.test(pathname)) return true;
  if (pathname === '/api/approvals/showcase') return true;
  // Agent cards are public by design: ERC-8004 discovery depends on them. The
  // second path is the same file where a proxy refuses dot-directories.
  if (pathname.startsWith('/.well-known/agent-card/')) return true;
  if (pathname.startsWith('/agent-card/')) return true;
  // The seal an operator embeds on their own page: the passport as an image.
  if (pathname.startsWith('/seal/')) return true;
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

  // The guided demo is the one page a signed-out visitor is walked into rather
  // than stopped at: judges arrive by link, with nobody to tell them which
  // button to press. The route decides whether a demo session is on offer.
  if (pathname === '/demo') {
    return NextResponse.redirect(new URL('/api/auth/demo?next=%2Fdemo', base));
  }

  if (SESSION_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, base));
  }

  // Anything else is an address this site does not have. It used to be sent to
  // the sign-in page like the rest, so a mistyped link, or a scanner probing
  // for `/wp-admin`, was answered with a wallet prompt: the behaviour of a
  // phishing page. It is still denied by default -- a page added under the
  // session and left off the list above is not shown, it is a 404 -- but the
  // answer is now the honest one.
  //
  // The page is written here rather than rewritten to the app's not-found
  // route: behind the proxy this process does not recognise its own origin, so
  // Next treats the rewrite as one to another host and proxies it, which
  // answered 500.
  return new NextResponse(NOT_FOUND_HTML, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
