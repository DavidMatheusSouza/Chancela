# Runbook: chancela.xyz

## Shape

    browser / agent
      -> Cloudflare edge            zone chancela.xyz (5d787a3a05375138c6158b6c1eae79f9)
      -> cloudflared                chancela-cloudflared.service  (own tunnel, NOT the studio's)
                                    tunnel chancela = 77a75a3a-2f5a-4f75-8471-1350bdf83fd8
      -> nginx 127.0.0.1:3070       /etc/nginx/conf.d/chancela.conf
      -> next start 127.0.0.1:3080  chancela-web.service (user clinica)
      -> postgres 127.0.0.1:5442    database `trustagent`

Ports 3070 (nginx), 3071 (connector metrics) and 3080 (app) sit outside the studio's
21000-23999 customer range and have no row in /home/webdesigners/registry/ports.tsv,
like fendwall and proparbiter. `bin/preflight.sh` and `bin/deploy.sh` do not apply here.

## Everything answers 530

The connector is down. `systemctl status chancela-cloudflared`, then restart it. The unit
is `Restart=always` precisely because a clean exit used to strand sites on 530 for minutes.

## Everything answers 503 with a holding page

nginx is up, the app is not. `systemctl status chancela-web`, then
`journalctl -u chancela-web -n 50`. The 503 is deliberate — nginx rewrites the upstream's
502 so crawlers read "come back later" rather than "broken gateway".

## Deploying a change

    su - clinica -c 'cd /home/mygestor/trustagent && git pull && pnpm install && pnpm build'
    systemctl restart chancela-web

Then purge the edge for this host only — never `purge_everything`, the token reaches
other people's zones:

    set -a; . /home/webdesigners/ac.env; set +a
    curl -s --max-time 30 -X POST \
      "https://api.cloudflare.com/client/v4/zones/5d787a3a05375138c6158b6c1eae79f9/purge_cache" \
      -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
      --data '{"hosts":["chancela.xyz"]}'

The unit runs `node node_modules/next/dist/bin/next`, not `node_modules/.bin/next`:
under pnpm the latter is a POSIX shell wrapper and node dies parsing it as JavaScript.

## Sign-in broke after a dependency bump

Almost always the CSP. Open the browser console, find the blocked origin, add it to the
`$chancela_csp` map in /etc/nginx/conf.d/chancela.conf, `nginx -t`, reload.

Two things that must not change:
- **No nonce.** A nonce makes browsers ignore `'unsafe-inline'`, which would break both
  Next.js's inline bootstrap and the inline script Bot Fight Mode injects on every page.
- **COOP stays `same-origin-allow-popups`.** Plain `same-origin` breaks the Privy sign-in
  popup silently, with nothing in the server logs.

## Cache rules: later rules win, not earlier ones

In the `http_request_cache_settings` phase Cloudflare evaluates **every** matching rule and
the **last** one wins — the opposite of the firewall phase. A host-wide `cache: true` rule
listed after an `/api/` `cache: false` rule overrides it, and `/api/` answers start coming
back `cf-cache-status: HIT`, which can serve one caller's response to another.

The live order is: host-wide rule first (and it excludes `/api/` in its own expression),
`/api/` `cache: false` last. nginx also sends `Cache-Control: no-store` on `/api/` so the
origin is correct even if the edge rule is ever misconfigured again. After changing cache
rules, verify with four repeated requests:

    for i in 1 2 3 4; do curl -sI https://chancela.xyz/api/health | grep -i cf-cache-status; done

`DYNAMIC` or `BYPASS` is correct. A single `HIT` on `/api/` is an incident: fix the rule
order, then purge the host.

## Editing nginx

Six live customer sites share this nginx. Always `nginx -t` before
`systemctl reload nginx`, and never `systemctl restart nginx`.

## Rate limiting

One rule, on `/api/*` only: 60 requests per 10 s per IP and colo, 10 s block. The guided
demo fires seven `/api/` calls in sequence, so the studio's usual 20-per-10s would throttle
a judge running the demo. If the demo grows, raise this before it bites.

## Never touch

The shared studio tunnel (`CF_TUNNEL_ID` in /home/webdesigners/ac.env,
4fc29ff9-f88f-485a-8c0d-f752737ab096) carries six customer domains across 31 ingress rules.
This project owns only the tunnel named `chancela`. Confirm which one you are editing
before any PUT to a tunnel configuration.
