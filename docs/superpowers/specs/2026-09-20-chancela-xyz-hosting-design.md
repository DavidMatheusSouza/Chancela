# Hosting Chancela on chancela.xyz

**Date:** 2026-09-20
**Status:** approved, not yet implemented

## Goal

Make `chancela.xyz` the permanent home for this project: real DNS, a named
Cloudflare tunnel, a supervised application process that survives a reboot, and
edge settings suited to a site whose `/api/` is called by agents as well as
browsers.

Today the app is a foreground `next start` owned by `clinica` with no
supervisor, reachable only through a throwaway quick tunnel
(`crops-morgan-hose-lloyd.trycloudflare.com`) whose hostname is baked into
`PUBLIC_BASE_URL` and the README. Both disappear when the process does.

Success means: the apex answers over HTTPS from a cold boot with no human in
the loop, and no URL in the repository points at a hostname that cannot be
recreated.

## Constraints from the host

This server also runs the Nítido Web studio stack (`/home/webdesigners`), six
customer sites, and fxmind. Chancela is not a studio customer, so it follows the
**fxmind pattern** that `/home/webdesigners/CLAUDE.md` documents for the
host's non-customer projects, not the customer playbook:

- ports outside `21000-23999` and **no row** in `registry/ports.tsv`
- its own `/etc/nginx/conf.d/<project>.conf` with namespaced maps
- its own systemd units rather than the studio's pm2 tree
- its own Cloudflare tunnel

`bin/preflight.sh`, `bin/deploy.sh` and the portal do not apply to this project.
Cloudflare credentials live in `/home/webdesigners/ac.env` (mode 600) — note
that `bin/cf-hostname.sh` still reads `$ROOT/.env`, which no longer exists, so
it silently takes its "no credentials" branch. This project calls the API
directly rather than depending on that script.

## Architecture

```
browser / agent client
  -> Cloudflare edge            zone chancela.xyz (5d787a3a05375138c6158b6c1eae79f9)
  -> cloudflared                chancela-cloudflared.service  (dedicated tunnel)
  -> nginx 127.0.0.1:3070       /etc/nginx/conf.d/chancela.conf
  -> next-server 127.0.0.1:3080 chancela-web.service
  -> postgres 127.0.0.1:5442    database `trustagent` (already live, unchanged)
```

`3070`/`3080` mirrors fxmind's `15070`/`15000`: nginx on the public-facing port,
the app on its own. Both sit outside the studio allocator's range, so
`bin/allocate-port.sh` can never hand either out.

### Components

**`chancela-web.service`** — the application. Runs `next start` from
`/home/mygestor/trustagent/apps/web` as user `clinica`, the existing owner of
the files, so no ownership changes are needed. `EnvironmentFile` points at
`/home/mygestor/trustagent/.env`. `Restart=always`, `RestartSec=5s`, enabled at
boot. Depends on `network-online.target`.

**`chancela-cloudflared.service`** — the connector. A dedicated named tunnel
`chancela`, credentials in `/etc/cloudflared/chancela.json` (mode 600, owned by
the service user). `Restart=always`, `RestartSec=5s`, enabled at boot — the
studio learned this the hard way: a clean exit with `Restart=on-failure` left
every site on Cloudflare 530 for 13 minutes.

The studio tunnel carries six paying customers' domains. Chancela stays off it
so that neither project can take the other down.

**`/etc/nginx/conf.d/chancela.conf`** — the origin. Self-contained; snippets in
`/etc/nginx/chancela/`. Every map is namespaced `$chancela_*` because map names
are global to the `http` context and the studio already defines `$wd_*`.

It supplies what Next.js does not:

- `set_real_ip_from 127.0.0.1; real_ip_header CF-Connecting-IP;` so logs and
  any limit see the real client instead of the loopback address
- `Cache-Control: public, max-age=0, s-maxage=600` on HTML and `expires 365d`
  on `/_next/static/`. The edge cache rule takes its TTL from the origin and
  bypasses anything unmarked, so without these headers the site has no edge
  cache at all
- a **Chancela-specific CSP**. The app loads Privy for wallet sign-in and calls
  Monad RPC from the browser, so the studio's default policy would break
  sign-in. The policy allows `https://*.privy.io` in `script-src`,
  `connect-src` and `frame-src`, and `https://testnet-rpc.monad.xyz` in
  `connect-src`, plus `'nonce-$request_id'` because Bot Fight Mode's JavaScript
  detections inject an inline script that no hash can cover
- a 503 holding page while the app is down, as fxmind does, so a restart shows
  a page rather than a connector error

`next.config.mjs` already sets `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy` and `Permissions-Policy`. nginx must not duplicate those
four; it adds only the CSP and `Cross-Origin-Opener-Policy`.

### Cloudflare zone

The zone is already active on the account with **zero DNS records** — a clean
slate, nothing to preserve or migrate.

- `chancela.xyz` and `www.chancela.xyz`: proxied CNAMEs to
  `<tunnel-id>.cfargotunnel.com`; both hostnames in the tunnel ingress ahead of
  the catch-all, pointing at `http://127.0.0.1:3070`
- redirect rule: `www.chancela.xyz/*` -> `https://chancela.xyz/$1`, 301
- SSL/TLS Full, Always Use HTTPS on, HSTS 6 months with `includeSubDomains`,
  minimum TLS 1.2, TLS 1.3 on, Automatic HTTPS Rewrites on. HSTS goes to 12
  months only after the site has been live a week; preload submission is the
  owner's call and is slow to undo
- Brotli, Early Hints, HTTP/3, 0-RTT, smart tiered cache on. Rocket Loader,
  Mirage, Polish, Auto Minify off
- cache rules: (1) eligible for cache with edge TTL from the origin's
  `Cache-Control`, bypassed when absent; (2) `/api/*` never cached
- WAF managed ruleset on, Bot Fight Mode on, Security Level Medium, Browser
  Integrity Check on
- rate limiting on `/api/*` only, at a ceiling the demo cannot reach. The
  guided demo fires seven steps in sequence from one IP and agent clients burst;
  the studio's 20-per-10s default is too tight. Use 60 requests per 10 s per IP,
  blocked for 10 s
- a configuration rule with `disable_rum: true`, so Cloudflare does not inject
  `static.cloudflareinsights.com/beacon.min.js` past the CSP

**Always Use HTTPS and agent POSTs.** A 301 turns a POST into a GET, which is
why the studio leaves this off for its API-only products. Here it stays on,
because `chancela.xyz` is primarily a browser-facing demo; the risk is limited
to a client that hardcodes `http://`. This is recorded so it can be revisited
if an agent integration reports lost request bodies.

### Application configuration

`PUBLIC_BASE_URL` moves from the quick-tunnel hostname to
`https://chancela.xyz`. The README's demo link and any other reference to
`crops-morgan-hose-lloyd.trycloudflare.com` are updated in the same change.

## Cutover

The new path is built and verified alongside the old one. The quick tunnel
(`cloudflared tunnel --url`, pid 3710693) and the ad-hoc `next` process
(pid 3740658) are retired **only after** the apex serves the site through the
edge — never before, so there is no window where the demo link is dead.

## Verification

Before cutover: `nginx -t` passes; `curl 127.0.0.1:3080/` and
`curl 127.0.0.1:3070/` both answer 200.

After cutover, from outside:

- `https://chancela.xyz/` and `https://chancela.xyz/demo` return 200
- `https://www.chancela.xyz/` returns 301 to the apex
- `http://chancela.xyz/` redirects to HTTPS
- TLS chain valid, `Strict-Transport-Security` present
- `Content-Security-Policy` present and Privy sign-in works in a real browser
- a response from `/api/` carries no cacheable header and reports an edge miss
- `curl` of the home page with a browser user agent contains no
  `cloudflareinsights` beacon
- `systemctl is-enabled chancela-web chancela-cloudflared` both report
  `enabled`; `systemctl restart` on each returns the site to 200
- the demo's seven-step run completes without a 429

## Risks

- **API token scope.** Creating a tunnel needs Account -> Cloudflare Tunnel:
  Edit; the zone rules need Zone -> Zone Settings: Edit and Zone -> DNS: Edit on
  `chancela.xyz`. The token verifies as active, but its exact permissions are
  unconfirmed. Probe this first; if a scope is missing, the fallback is the
  dashboard for that one step.
- **CSP and Privy.** The allowlist is derived from reading the source. A real
  browser sign-in is the only proof; expect one iteration on the policy.
- **Shared nginx.** `nginx -t` and a reload affect all sites on the host. Test
  the config before reloading, and reload rather than restart.
- **HSTS.** Six months of `includeSubDomains` is hard to walk back. It is only
  applied once the apex is confirmed serving over HTTPS.
