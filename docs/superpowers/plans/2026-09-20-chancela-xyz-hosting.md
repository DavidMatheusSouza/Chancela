# chancela.xyz Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve this project at `https://chancela.xyz` from a supervised process behind a dedicated Cloudflare tunnel, so it comes back by itself after a reboot and no repository URL points at a throwaway hostname.

**Architecture:** Cloudflare edge -> dedicated `chancela` tunnel -> nginx on `127.0.0.1:3070` -> `next start` on `127.0.0.1:3080` -> the Postgres already listening on `127.0.0.1:5442`. Two new systemd units replace an unsupervised foreground process and a quick tunnel. This follows the fxmind pattern that `/home/webdesigners/CLAUDE.md` documents for this host's non-customer projects, not the studio customer playbook.

**Tech Stack:** Next.js 14.2.35 (Node 20.20.2 at `/usr/bin/node`), nginx, cloudflared 2026.9.1, systemd, Cloudflare API v4.

**Spec:** `docs/superpowers/specs/2026-09-20-chancela-xyz-hosting-design.md`

## Global Constraints

- Ports: nginx `3070`, app `3080`, cloudflared metrics `3071`. All outside `21000-23999`. **No row in `/home/webdesigners/registry/ports.tsv`.**
- Zone `chancela.xyz` = `5d787a3a05375138c6158b6c1eae79f9`. Account/token/shared-tunnel vars live in `/home/webdesigners/ac.env` (mode 600). Never echo their values; source the file and reference the variables.
- The **shared studio tunnel `CF_TUNNEL_ID` (`4fc29ff9-...`) must never be modified.** It carries six live customer domains. This project creates and edits only its own tunnel.
- App runs as existing user `clinica` (uid 1003), the owner of `/home/mygestor/trustagent`. No file-ownership changes.
- `apps/web/next.config.mjs` already sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`. **nginx must not set those four** — an nginx server-level `add_header` would shadow the app's per-route control.
- `Cross-Origin-Opener-Policy` must be `same-origin-allow-popups`, never `same-origin`. Privy signs in through a popup.
- The CSP uses `'unsafe-inline'` and **no nonce**. A nonce makes browsers ignore `'unsafe-inline'`, which would break Next.js's inline bootstrap and Cloudflare's Bot-Fight-Mode script.
- Cutover is last: the current quick tunnel (pid 3710693) and foreground `next` (pid 3740658) stay up until the apex serves through the edge.
- `nginx -t` before every reload. Reload, never restart — six other sites share this nginx.

## Review Focus

- **Privy popup blocked by COOP.** `same-origin` silently breaks wallet sign-in with no server-side error. Pinned in Task 2, verified in Task 7.
- **Duplicate security headers.** nginx re-adding what `next.config.mjs` sends yields two values per header and shadows per-route framing. Pinned in Task 2.
- **Connector exits cleanly and never returns.** `Restart=on-failure` leaves the site on Cloudflare 530; the studio lost 13 minutes to exactly this. `Restart=always` pinned in Task 3.
- **Demo burst trips the rate limit.** The guided demo fires seven `/api/` calls from one IP; the studio's 20-per-10s default would 429 it. Ceiling raised and exercised in Task 5 and Task 7.
- **HSTS applied before HTTPS is confirmed working.** Six months of `includeSubDomains` is hard to walk back. Task 5 asserts a 200 over HTTPS *before* enabling it.

---

### Task 1: Supervise the application

**Files:**
- Create: `/etc/systemd/system/chancela-web.service`
- Verify: `/home/mygestor/trustagent/.env` (already exists, unchanged here)

**Interfaces:**
- Consumes: nothing.
- Produces: a listener on `127.0.0.1:3080` owned by `chancela-web.service`, restartable and enabled at boot. Task 2 proxies to it.

- [ ] **Step 1: Write the check and watch it fail**

```bash
systemctl is-enabled chancela-web 2>&1
```
Expected: `Failed to get unit file state for chancela-web.service: No such file or directory`

- [ ] **Step 2: Confirm a production build exists**

```bash
ls /home/mygestor/trustagent/apps/web/.next/BUILD_ID && cat /home/mygestor/trustagent/apps/web/.next/BUILD_ID
```
Expected: a build id prints. If the file is missing, build first as `clinica`:
```bash
su - clinica -c 'cd /home/mygestor/trustagent && pnpm build'
```

- [ ] **Step 3: Write the unit**

```ini
# chancela-web: the Chancela Next.js app on 127.0.0.1:3080, behind nginx on 3070.
# Runs as clinica, the owner of /home/mygestor/trustagent, so no file ownership changes.
# Replaces an unsupervised foreground `next start` that did not survive a reboot.
[Unit]
Description=Chancela web (Next.js)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=clinica
Group=clinica
WorkingDirectory=/home/mygestor/trustagent/apps/web
EnvironmentFile=/home/mygestor/trustagent/.env
Environment=NODE_ENV=production
Environment=PORT=3080
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3080 -H 127.0.0.1
# Come back after any exit, a clean one included.
Restart=always
RestartSec=5s

NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/home/mygestor/trustagent/apps/web/.next
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
MemoryMax=1500M
TasksMax=512

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Stop the old foreground process, then start the unit**

The old process holds 3080, so it must go first. Find it fresh rather than trusting the recorded pid:
```bash
OLD=$(ss -Htlnp 'sport = :3080' | grep -oP 'pid=\K[0-9]+' | head -1)
echo "old next pid: ${OLD:-none}"
[ -n "$OLD" ] && kill "$OLD"
sleep 2
systemctl daemon-reload
systemctl enable --now chancela-web
```

- [ ] **Step 5: Run the checks and verify they pass**

```bash
systemctl is-enabled chancela-web   # expect: enabled
systemctl is-active chancela-web    # expect: active
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/   # expect: 200
```

- [ ] **Step 6: Prove it self-heals**

```bash
systemctl kill -s SIGKILL chancela-web
sleep 8
systemctl is-active chancela-web    # expect: active
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/   # expect: 200
```
This is the whole point of the task: a `SIGKILL` must not take the site down for more than a few seconds.

---

### Task 2: nginx origin on 3070

**Files:**
- Create: `/etc/nginx/chancela/security-headers.conf`
- Create: `/etc/nginx/chancela/proxy.conf`
- Create: `/etc/nginx/conf.d/chancela.conf`
- Create: `/var/www/chancela/503.html`

**Interfaces:**
- Consumes: the app on `127.0.0.1:3080` from Task 1.
- Produces: a listener on `127.0.0.1:3070` answering for `chancela.xyz` and `www.chancela.xyz`. Task 4 points tunnel ingress at it.

- [ ] **Step 1: Write the check and watch it fail**

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:3070/ 2>&1 || echo "connection refused, as expected"
```
Expected: connection refused.

- [ ] **Step 2: Create the holding page**

```bash
mkdir -p /var/www/chancela
cat > /var/www/chancela/503.html <<'HTML'
<!doctype html>
<html lang="en"><meta charset="utf-8">
<title>Chancela — back shortly</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
       background:#0b0b0f;color:#e8e8ea}
  main{max-width:32rem;padding:2rem;text-align:center}
  h1{font-size:1.25rem;font-weight:600;margin:0 0 .5rem}
  p{margin:0;color:#a0a0ab}
</style>
<main>
  <h1>Chancela is restarting</h1>
  <p>The service is coming back up. Refresh in a few seconds.</p>
</main>
</html>
HTML
chown -R nginx:nginx /var/www/chancela
```

- [ ] **Step 3: Write the proxy snippet**

```bash
mkdir -p /etc/nginx/chancela
cat > /etc/nginx/chancela/proxy.conf <<'CONF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $chancela_connection_upgrade;
proxy_connect_timeout 5s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
proxy_buffering on;
proxy_buffers 16 16k;
proxy_buffer_size 16k;
proxy_hide_header X-Powered-By;
CONF
```

- [ ] **Step 4: Write the header snippet**

Only the two headers `next.config.mjs` does *not* send. `same-origin-allow-popups` is required — Privy signs in through a popup and `same-origin` would break it silently.

```bash
cat > /etc/nginx/chancela/security-headers.conf <<'CONF'
# The four headers next.config.mjs already sends (X-Content-Type-Options, X-Frame-Options,
# Referrer-Policy, Permissions-Policy) are deliberately NOT repeated here: an nginx server-level
# add_header applies to every response and would shadow the app's per-route control, which is
# exactly how fxmind broke its embed widget.
#
# COOP is same-origin-allow-popups, never same-origin: Privy signs in through a popup.
add_header Cross-Origin-Opener-Policy "same-origin-allow-popups" always;
add_header Content-Security-Policy $chancela_csp always;
CONF
```

- [ ] **Step 5: Write the server block**

```bash
cat > /etc/nginx/conf.d/chancela.conf <<'CONF'
# chancela : chancela.xyz, www.chancela.xyz -> chancela tunnel (its own, not the studio's) -> 127.0.0.1:3070
# Loopback only. TLS terminates at Cloudflare. Ports 3070/3080 sit outside the studio's 21000-23999
# customer range and have no row in /home/webdesigners/registry/ports.tsv, like fendwall and proparbiter.

upstream chancela_app {
    server 127.0.0.1:3080;
    keepalive 32;
}

# "upgrade" only when the client asks for a WebSocket, empty otherwise, so keepalive is reused.
# Namespaced: map names are global to the http context and the studio already defines $wd_*.
map $http_upgrade $chancela_connection_upgrade {
    default  upgrade;
    ""       "";
}

# 'unsafe-inline' with NO nonce, on purpose: a nonce makes browsers ignore 'unsafe-inline', which
# would break both Next.js's inline bootstrap and the inline script Bot Fight Mode injects.
map $host $chancela_csp {
    default "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://auth.privy.io https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://auth.privy.io https://*.privy.io https://*.rpc.privy.systems https://testnet-rpc.monad.xyz https://testnet.monadexplorer.com https://explorer-api.walletconnect.com wss://relay.walletconnect.com; frame-src https://auth.privy.io https://challenges.cloudflare.com https://verify.walletconnect.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests";
}

# Cache-Control for HTML the app returns without one. Browsers revalidate every visit; the edge keeps
# 10 minutes. The zone's cache rule takes its TTL from this and bypasses anything unmarked, so without
# it the site would have no edge cache at all. Errors and redirects get nothing.
map "$status:$sent_http_cache_control" $chancela_cache_control {
    default  "";
    "200:"   "public, max-age=0, s-maxage=600";
}

server {
    listen 127.0.0.1:3070;
    server_name chancela.xyz www.chancela.xyz;

    access_log /var/log/nginx/chancela.access.log main;
    error_log  /var/log/nginx/chancela.error.log warn;

    # cloudflared is the only client, so the real visitor is in CF-Connecting-IP.
    set_real_ip_from 127.0.0.1;
    real_ip_header CF-Connecting-IP;

    include /etc/nginx/chancela/security-headers.conf;

    client_max_body_size 10m;
    absolute_redirect off;

    # While the app is down, answer with a page instead of a connector error.
    error_page 502 503 504 =503 /__down.html;
    location = /__down.html {
        root /var/www/chancela;
        internal;
        try_files /503.html =503;
        add_header Cache-Control "no-store" always;
    }

    # Hashed build output: immutable.
    location ^~ /_next/static/ {
        proxy_pass http://chancela_app;
        include /etc/nginx/chancela/proxy.conf;
        expires 365d;
        access_log off;
    }

    # Never cached at the edge; the zone rule enforces this too.
    location ^~ /api/ {
        proxy_pass http://chancela_app;
        include /etc/nginx/chancela/proxy.conf;
        include /etc/nginx/chancela/security-headers.conf;
    }

    location / {
        proxy_pass http://chancela_app;
        include /etc/nginx/chancela/proxy.conf;
        add_header Cache-Control $chancela_cache_control always;
        include /etc/nginx/chancela/security-headers.conf;
    }

    location ~ /\. { deny all; }
}
CONF
```

- [ ] **Step 6: Test the config before touching the running nginx**

```bash
nginx -t
```
Expected: `syntax is ok` / `test is successful`. **Do not reload on any other result** — six live customer sites share this nginx.

- [ ] **Step 7: Reload and run the checks**

```bash
systemctl reload nginx
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: chancela.xyz' http://127.0.0.1:3070/       # expect: 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: chancela.xyz' http://127.0.0.1:3070/demo   # expect: 200 or 307
```

- [ ] **Step 8: Pin the header contract**

```bash
curl -sI -H 'Host: chancela.xyz' http://127.0.0.1:3070/ | grep -iE 'cross-origin-opener|content-security-policy|x-frame-options|x-content-type|cache-control'
```
Expected, and each line must appear **exactly once**:
- `Cross-Origin-Opener-Policy: same-origin-allow-popups`
- `Content-Security-Policy: default-src 'self'; ...`
- `X-Frame-Options: DENY` (from the app, not nginx)
- `X-Content-Type-Options: nosniff` (from the app, not nginx)
- `Cache-Control` present once. The app sends `private, no-cache, no-store` on authenticated HTML and the `$chancela_cache_control` fallback correctly stays out of the way; only a route that sends none gets `public, max-age=0, s-maxage=600`.

A doubled `X-Frame-Options` or `X-Content-Type-Options` means the header snippet wrongly re-adds what the app sends — fix the snippet, re-run `nginx -t`, reload.

- [ ] **Step 9: Prove the holding page works**

```bash
systemctl stop chancela-web
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: chancela.xyz' http://127.0.0.1:3070/   # expect: 503
curl -s -H 'Host: chancela.xyz' http://127.0.0.1:3070/ | grep -o 'Chancela is restarting' # expect: match
systemctl start chancela-web
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: chancela.xyz' http://127.0.0.1:3070/   # expect: 200
```

---

### Task 3: Dedicated tunnel and connector

**Files:**
- Create: `/etc/chancela/credentials/cloudflared-tunnel.token` (mode 600)
- Create: `/etc/systemd/system/chancela-cloudflared.service`

**Interfaces:**
- Consumes: nginx on `127.0.0.1:3070` from Task 2.
- Produces: a healthy named tunnel whose id Task 4 uses for DNS and ingress. Record the id — later tasks refer to it as `CHANCELA_TUNNEL_ID`.

- [ ] **Step 1: Confirm the token can create a tunnel**

`cloudflared tunnel create` would need a browser login and a `cert.pem`. The API path needs neither. Probe the scope first:
```bash
set -a; . /home/webdesigners/ac.env; set +a
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel?is_deleted=false" \
  -H "Authorization: Bearer $CF_API_TOKEN" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("success:",d["success"], d.get("errors"))'
```
Expected: `success: True`. If it reports a permission error, stop: the token lacks Account -> Cloudflare Tunnel: Edit, and the tunnel must be created in the Zero Trust dashboard instead. Report that to the user rather than guessing.

- [ ] **Step 2: Create the tunnel**

`config_src: cloudflare` makes the ingress remote-managed through the API, matching how this host's other tunnels work.
```bash
set -a; . /home/webdesigners/ac.env; set +a
SECRET=$(head -c 32 /dev/urandom | base64)
RESP=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data "$(python3 -c 'import json,sys; print(json.dumps({"name":"chancela","tunnel_secret":sys.argv[1],"config_src":"cloudflare"}))' "$SECRET")")
echo "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("success:",d["success"], d.get("errors")); print("tunnel id:", (d.get("result") or {}).get("id"))'
```
Record the printed id as `CHANCELA_TUNNEL_ID`. If a tunnel named `chancela` already exists, reuse its id from Step 1's listing rather than creating a second one.

- [ ] **Step 2b: Define the id lookup every later step uses**

Rather than pasting the id by hand, resolve it by name. Use this snippet wherever a
step below says `CHANCELA_TUNNEL_ID=$(... see Task 3 Step 2b ...)`:

```bash
set -a; . /home/webdesigners/ac.env; set +a
CHANCELA_TUNNEL_ID=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel?name=chancela&is_deleted=false" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(r[0]["id"] if r else "")')
echo "chancela tunnel: ${CHANCELA_TUNNEL_ID:?not found}"
```
Expected: a uuid. It must never equal `$CF_TUNNEL_ID` — that is the studio tunnel.

- [ ] **Step 3: Fetch the connector token and store it**

```bash
set -a; . /home/webdesigners/ac.env; set +a
CHANCELA_TUNNEL_ID=$(... see Step 2b ...)
install -d -m 700 /etc/chancela/credentials
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CHANCELA_TUNNEL_ID/token" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["success"], d.get("errors"); sys.stdout.write(d["result"])' \
  > /etc/chancela/credentials/cloudflared-tunnel.token
chmod 600 /etc/chancela/credentials/cloudflared-tunnel.token
test -s /etc/chancela/credentials/cloudflared-tunnel.token && echo "token stored: $(wc -c < /etc/chancela/credentials/cloudflared-tunnel.token) bytes"
```
Expected: a non-zero byte count. Never `cat` this file.

- [ ] **Step 4: Create the service user**

The connector needs no filesystem access beyond its token.
```bash
id chancela >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin chancela
id chancela
```

- [ ] **Step 5: Write the unit**

```ini
# chancela-cloudflared: Chancela's own Cloudflare tunnel connector (chancela.xyz, www -> nginx 127.0.0.1:3070).
# Separate from the machine-wide cloudflared.service on purpose: that tunnel carries six live customer
# domains, and neither project should be able to take the other down.
# Ingress is remote-managed through the Cloudflare API; this unit only runs the connector.
[Unit]
Description=Chancela Cloudflare tunnel
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=notify
User=chancela
Group=chancela
LoadCredential=tunnel-token:/etc/chancela/credentials/cloudflared-tunnel.token
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel --metrics 127.0.0.1:3071 run --token-file %d/tunnel-token
TimeoutStartSec=0
# Come back after any exit, a clean one included: a plain SIGTERM would otherwise leave the site on 530.
Restart=always
RestartSec=5s

NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
ProtectSystem=strict
ProtectHome=tmpfs
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
SystemCallFilter=@system-service
SystemCallArchitectures=native
MemoryMax=512M
TasksMax=256

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 6: Start it and verify the connector registers**

```bash
systemctl daemon-reload
systemctl enable --now chancela-cloudflared
sleep 10
systemctl is-active chancela-cloudflared   # expect: active
```

- [ ] **Step 7: Verify Cloudflare sees it healthy**

```bash
set -a; . /home/webdesigners/ac.env; set +a
CHANCELA_TUNNEL_ID=$(... see Step 2b ...)
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CHANCELA_TUNNEL_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print("status:",r["status"],"connections:",len(r.get("connections") or []))'
```
Expected: `status: healthy` with 2 or more connections.

- [ ] **Step 8: Confirm the shared tunnel was untouched**

```bash
set -a; . /home/webdesigners/ac.env; set +a
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | python3 -c 'import json,sys; c=json.load(sys.stdin)["result"]["config"]; print("studio ingress rules:",len(c["ingress"])); [print("  ",r.get("hostname","<catch-all>"),"->",r.get("service")) for r in c["ingress"]]'
```
Expected: the customer hostnames, and **no `chancela.xyz` among them**.

---

### Task 4: DNS records and tunnel ingress

**Files:** none on disk. Cloudflare API only.

**Interfaces:**
- Consumes: `CHANCELA_TUNNEL_ID` from Task 3, nginx on `3070` from Task 2.
- Produces: `https://chancela.xyz` resolving and serving. Task 5 hardens the zone around it.

- [ ] **Step 1: Write the check and watch it fail**

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://chancela.xyz/ 2>&1 || echo "does not resolve yet, as expected"
```
Expected: a DNS failure. The zone has zero records at the start of this task.

- [ ] **Step 2: Point the ingress at nginx**

Note the catch-all must stay last.
```bash
set -a; . /home/webdesigners/ac.env; set +a
CHANCELA_TUNNEL_ID=$(... see Task 3 Step 2b ...)
curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CHANCELA_TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"config":{"ingress":[
    {"hostname":"chancela.xyz","service":"http://127.0.0.1:3070"},
    {"hostname":"www.chancela.xyz","service":"http://127.0.0.1:3070"},
    {"service":"http_status:404"}]}}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("success:",d["success"], d.get("errors"))'
```
Expected: `success: True`.

- [ ] **Step 3: Create the proxied CNAMEs**

```bash
set -a; . /home/webdesigners/ac.env; set +a
ZONE=5d787a3a05375138c6158b6c1eae79f9
CHANCELA_TUNNEL_ID=$(... see Task 3 Step 2b ...)
for NAME in chancela.xyz www.chancela.xyz; do
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
    -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
    --data "$(python3 -c 'import json,sys; print(json.dumps({"type":"CNAME","name":sys.argv[1],"content":sys.argv[2]+".cfargotunnel.com","proxied":True,"ttl":1}))' "$NAME" "$CHANCELA_TUNNEL_ID")" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result") or {}; print(r.get("name","ERROR"), "->", r.get("content", d.get("errors")))'
done
```
Expected: both names printing `-> <tunnel-id>.cfargotunnel.com`.

- [ ] **Step 4: Confirm the zone is active and on Cloudflare nameservers**

```bash
set -a; . /home/webdesigners/ac.env; set +a
curl -s "https://api.cloudflare.com/client/v4/zones/5d787a3a05375138c6158b6c1eae79f9" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print("status:",r["status"]); print("nameservers:",", ".join(r["name_servers"]))'
```
Expected: `status: active`. If it is `pending`, the nameservers must be set at the registrar before anything below will work — report it and stop.

- [ ] **Step 5: Run the check and verify it passes**

Give DNS a moment to propagate.
```bash
sleep 30
curl -s -o /dev/null -w 'apex   %{http_code}\n' --max-time 20 https://chancela.xyz/
curl -s -o /dev/null -w 'demo   %{http_code}\n' --max-time 20 https://chancela.xyz/demo
```
Expected: `200` for the apex; `200` or `307` for `/demo`.

- [ ] **Step 6: Confirm it is really our origin answering**

```bash
curl -sI https://chancela.xyz/ | grep -iE '^(cf-ray|server|content-security-policy|cross-origin-opener)'
```
Expected: a `cf-ray` header, `server: cloudflare`, and the CSP and COOP set in Task 2 — proof the request traversed the edge, the tunnel and nginx.

---

### Task 5: Zone settings, rules and edge policy

**Files:** none on disk. Cloudflare API only.

**Interfaces:**
- Consumes: a working `https://chancela.xyz` from Task 4.
- Produces: the hardened zone the spec describes. Task 7 verifies it end to end.

- [ ] **Step 1: Assert HTTPS works before enabling HSTS**

HSTS is hard to walk back, so it is gated on a real 200.
```bash
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://chancela.xyz/)
echo "apex over https: $CODE"
[ "$CODE" = "200" ] || { echo "ABORT: do not enable HSTS until the apex serves 200"; exit 1; }
```

- [ ] **Step 2: Apply the TLS and speed settings**

```bash
set -a; . /home/webdesigners/ac.env; set +a
ZONE=5d787a3a05375138c6158b6c1eae79f9
setting() {
  curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/settings/$1" \
    -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
    --data "{\"value\":$2}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'$1:', 'ok' if d['success'] else d.get('errors'))"
}
setting ssl '"full"'
setting always_use_https '"on"'
setting min_tls_version '"1.2"'
setting tls_1_3 '"on"'
setting automatic_https_rewrites '"on"'
setting brotli '"on"'
setting early_hints '"on"'
setting h2_prioritization '"on"'
setting 0rtt '"on"'
setting rocket_loader '"off"'
setting mirage '"off"'
setting polish '"off"'
setting browser_cache_ttl 0
setting security_level '"medium"'
setting browser_check '"on"'
```

Auto Minify is deliberately absent: Cloudflare retired that setting, and the assets
are already minified. Then smart tiered cache, which has its own endpoint:

```bash
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/argo/tiered_caching" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"value":"on"}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("tiered caching:", "ok" if d["success"] else d.get("errors"))'
```
A setting that is not available on the Free plan returns an error; note it and continue rather than aborting.

- [ ] **Step 3: Enable HTTP/3 and HSTS**

Six months, `includeSubDomains`, no preload. Preload is the owner's decision and is slow to undo.
```bash
set -a; . /home/webdesigners/ac.env; set +a
ZONE=5d787a3a05375138c6158b6c1eae79f9
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/settings/http3" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"value":"on"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); print("http3:", "ok" if d["success"] else d.get("errors"))'
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/settings/security_header" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"value":{"strict_transport_security":{"enabled":true,"max_age":15552000,"include_subdomains":true,"preload":false,"nosniff":true}}}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("hsts:", "ok" if d["success"] else d.get("errors"))'
```

- [ ] **Step 4: Redirect www to the apex**

```bash
set -a; . /home/webdesigners/ac.env; set +a
ZONE=5d787a3a05375138c6158b6c1eae79f9
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"rules":[{"action":"redirect","expression":"(http.host eq \"www.chancela.xyz\")","description":"www to apex","action_parameters":{"from_value":{"status_code":301,"target_url":{"expression":"concat(\"https://chancela.xyz\", http.request.uri.path)"},"preserve_query_string":true}}}]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("redirect rule:", "ok" if d["success"] else d.get("errors"))'
```

- [ ] **Step 5: Cache rules — origin-driven, /api/ never**

```bash
set -a; . /home/webdesigners/ac.env; set +a
ZONE=5d787a3a05375138c6158b6c1eae79f9
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/phases/http_request_cache_settings/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"rules":[
    {"action":"set_cache_settings","expression":"(starts_with(http.request.uri.path, \"/api/\"))","description":"never cache the API","action_parameters":{"cache":false}},
    {"action":"set_cache_settings","expression":"(http.host eq \"chancela.xyz\")","description":"origin-driven TTL, bypass when unmarked","action_parameters":{"cache":true,"edge_ttl":{"mode":"respect_origin"},"browser_ttl":{"mode":"respect_origin"}}}]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("cache rules:", "ok" if d["success"] else d.get("errors"))'
```
The `/api/` rule is listed first: rules evaluate in order and the first match wins.

- [ ] **Step 6: Turn off the analytics beacon**

The Bot-Fight-Mode beacon would be injected past the CSP and show up as a console error.
```bash
set -a; . /home/webdesigners/ac.env; set +a
ZONE=5d787a3a05375138c6158b6c1eae79f9
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/phases/http_config_settings/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"rules":[{"action":"set_config","expression":"true","description":"no RUM beacon (blocked by our CSP)","action_parameters":{"disable_rum":true}}]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("disable_rum:", "ok" if d["success"] else d.get("errors"))'
```

- [ ] **Step 6b: Confirm the WAF managed ruleset is deployed**

On Free, the Cloudflare Free Managed Ruleset is deployed automatically and the
deploy API is Pro-and-above, so this step **verifies** rather than applies.

```bash
set -a; . /home/webdesigners/ac.env; set +a
ZONE=5d787a3a05375138c6158b6c1eae79f9
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); rs=[r for r in d.get("result") or [] if r.get("phase")=="http_request_firewall_managed"]; print("managed WAF rulesets:", len(rs)); [print("  ",r["name"]) for r in rs]'
```
Expected: at least one entry in the `http_request_firewall_managed` phase. If the
list is empty, record it and tell the user the zone needs the managed ruleset
enabled in the dashboard — do not attempt a Pro-only API call.

- [ ] **Step 7: Bot Fight Mode**

```bash
set -a; . /home/webdesigners/ac.env; set +a
ZONE=5d787a3a05375138c6158b6c1eae79f9
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/bot_management" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"fight_mode":true,"enable_js":true}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("bot fight mode:", "ok" if d["success"] else d.get("errors"))'
```

- [ ] **Step 8: Rate limit on /api/, sized so the demo cannot trip it**

60 per 10 s per IP, not the studio's 20: the guided demo fires seven `/api/` calls in sequence from one address and agent clients burst.
```bash
set -a; . /home/webdesigners/ac.env; set +a
ZONE=5d787a3a05375138c6158b6c1eae79f9
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/phases/http_ratelimit/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"rules":[{"action":"block","expression":"(starts_with(http.request.uri.path, \"/api/\"))","description":"API abuse ceiling, above normal demo and agent traffic","ratelimit":{"characteristics":["ip.src","cf.colo.id"],"period":10,"requests_per_period":60,"mitigation_timeout":10}}]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("rate limit:", "ok" if d["success"] else d.get("errors"))'
```

- [ ] **Step 9: Run the checks and verify they pass**

```bash
sleep 20
curl -sI --max-time 20 https://chancela.xyz/ | grep -i strict-transport-security      # expect: max-age=15552000; includeSubDomains
curl -s -o /dev/null -w 'www -> %{http_code} %{redirect_url}\n' --max-time 20 https://www.chancela.xyz/   # expect: 301 https://chancela.xyz/
curl -s -o /dev/null -w 'http -> %{http_code} %{redirect_url}\n' --max-time 20 http://chancela.xyz/       # expect: 301 https://chancela.xyz/
```

---

### Task 6: Repoint the application and retire the quick tunnel

**Files:**
- Modify: `/home/mygestor/trustagent/.env` (`PUBLIC_BASE_URL`)
- Modify: `/home/mygestor/trustagent/README.md` (demo link)

**Interfaces:**
- Consumes: a verified `https://chancela.xyz` from Task 5.
- Produces: a repository with no reference to the throwaway hostname.

- [ ] **Step 1: Write the check and watch it fail**

```bash
cd /home/mygestor/trustagent
grep -rn 'trycloudflare\.com' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git . | head
```
Expected: matches in `.env` and `README.md`. These are what this task removes.

- [ ] **Step 2: Repoint PUBLIC_BASE_URL**

```bash
cd /home/mygestor/trustagent
cp .env .env.bak.$(date +%s)
sed -i 's#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://chancela.xyz#' .env
grep '^PUBLIC_BASE_URL=' .env
```
Expected: `PUBLIC_BASE_URL=https://chancela.xyz`

- [ ] **Step 3: Update the README demo link**

```bash
cd /home/mygestor/trustagent
sed -i 's#https://crops-morgan-hose-lloyd\.trycloudflare\.com#https://chancela.xyz#g' README.md
grep -n 'chancela.xyz' README.md | head
```
Expected: the "Open the guided demo" link now points at `https://chancela.xyz/demo`.

- [ ] **Step 4: Restart the app so it reads the new base URL, and rebuild if the value is inlined**

`PUBLIC_BASE_URL` has no `NEXT_PUBLIC_` prefix, so it is read at runtime and a restart is enough.
```bash
systemctl restart chancela-web
sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/   # expect: 200
```

- [ ] **Step 5: Confirm nothing in the repo still points at the old host**

```bash
cd /home/mygestor/trustagent
grep -rn 'trycloudflare\.com' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude='.env.bak.*' . | head
```
Expected: no output.

- [ ] **Step 6: Retire the quick tunnel — only now**

The apex has been serving since Task 4, so nothing goes dark here.
```bash
QT=$(pgrep -f 'cloudflared tunnel --url' || true)
echo "quick tunnel pid: ${QT:-none}"
[ -n "$QT" ] && kill $QT
sleep 3
pgrep -f 'cloudflared tunnel --url' || echo "quick tunnel retired"
curl -s -o /dev/null -w 'apex still up: %{http_code}\n' --max-time 20 https://chancela.xyz/   # expect: 200
```

- [ ] **Step 7: Commit**

```bash
cd /home/mygestor/trustagent
git add README.md
git commit -m "$(cat <<'MSG'
Point the demo link at chancela.xyz

The quick tunnel hostname in the README died with the process that
created it. The apex now serves the same app through a named tunnel.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```
`.env` is gitignored and is not committed.

---

### Task 7: End-to-end verification

**Files:**
- Create: `/home/mygestor/trustagent/docs/runbook-chancela-xyz.md`

**Interfaces:**
- Consumes: everything above.
- Produces: evidence for each line of the spec's verification list, and a runbook.

- [ ] **Step 1: Reachability and redirects**

```bash
for U in https://chancela.xyz/ https://chancela.xyz/demo https://www.chancela.xyz/ http://chancela.xyz/; do
  printf '%-32s %s %s\n' "$U" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$U")" "$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 20 "$U")"
done
```
Expected: apex `200`; `/demo` `200` or `307`; `www` `301` to `https://chancela.xyz/`; `http` `301` to `https://chancela.xyz/`.

- [ ] **Step 2: TLS chain**

```bash
echo | openssl s_client -connect chancela.xyz:443 -servername chancela.xyz 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```
Expected: a subject covering `chancela.xyz`, a Cloudflare issuer, and a `notAfter` in the future.

- [ ] **Step 3: Headers, each exactly once**

```bash
curl -sI --max-time 20 https://chancela.xyz/ | grep -icE '^x-frame-options'        # expect: 1
curl -sI --max-time 20 https://chancela.xyz/ | grep -icE '^x-content-type-options' # expect: 1
curl -sI --max-time 20 https://chancela.xyz/ | grep -iE '^(strict-transport-security|content-security-policy|cross-origin-opener-policy)'
```
Expected: counts of exactly `1`, and all three of HSTS, CSP and `same-origin-allow-popups` present.

- [ ] **Step 4: No beacon injected**

Cloudflare injects it only for browser user agents, so ask as one.
```bash
curl -s --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' \
  https://chancela.xyz/ | grep -c cloudflareinsights
```
Expected: `0`.

- [ ] **Step 5: /api/ is not edge-cached**

```bash
curl -sI --max-time 20 https://chancela.xyz/api/health | grep -iE '^(cf-cache-status|cache-control)'
```
Expected: `cf-cache-status: BYPASS` or `DYNAMIC`, never `HIT`. If `/api/health` does not exist, use any real `/api/` route; a 404 from the app still shows the cache status.

- [ ] **Step 6: The demo burst does not get throttled**

Twelve rapid requests — well past the seven the demo makes, well under the 60 ceiling.
```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w '%{http_code} ' --max-time 15 https://chancela.xyz/api/health
done; echo
```
Expected: no `429` in the output.

- [ ] **Step 7: Reboot safety without rebooting**

```bash
systemctl is-enabled chancela-web chancela-cloudflared   # expect: enabled, enabled
systemctl restart chancela-web chancela-cloudflared
sleep 15
curl -s -o /dev/null -w 'after restart: %{http_code}\n' --max-time 20 https://chancela.xyz/   # expect: 200
```

- [ ] **Step 8: Privy sign-in in a real browser**

The only check that cannot be automated here, and the one most likely to need an iteration. Open `https://chancela.xyz/demo`, choose **Continue as demo owner**, and confirm the console shows no `Content-Security-Policy` or `Cross-Origin-Opener-Policy` violation. If a violation names an origin, add that origin to the matching directive in the `$chancela_csp` map, `nginx -t`, reload, and re-check.

- [ ] **Step 9: Write the runbook**

```bash
cat > /home/mygestor/trustagent/docs/runbook-chancela-xyz.md <<'DOC'
# Runbook: chancela.xyz

## Shape

    browser / agent
      -> Cloudflare edge            zone chancela.xyz (5d787a3a05375138c6158b6c1eae79f9)
      -> cloudflared                chancela-cloudflared.service  (own tunnel, NOT the studio's)
      -> nginx 127.0.0.1:3070       /etc/nginx/conf.d/chancela.conf
      -> next start 127.0.0.1:3080  chancela-web.service (user clinica)
      -> postgres 127.0.0.1:5442    database `trustagent`

Ports 3070/3071/3080 sit outside the studio's 21000-23999 customer range and have
no row in /home/webdesigners/registry/ports.tsv, like fendwall and proparbiter.
`bin/preflight.sh` and `bin/deploy.sh` do not apply to this project.

## Everything answers 530

The connector is down. `systemctl status chancela-cloudflared` first, then restart it.
The unit is `Restart=always` precisely because a clean exit used to strand sites on 530.

## Everything answers 503 with a holding page

nginx is up, the app is not. `systemctl status chancela-web`, then
`journalctl -u chancela-web -n 50`.

## Deploying a change

    su - clinica -c 'cd /home/mygestor/trustagent && git pull && pnpm install && pnpm build'
    systemctl restart chancela-web

Then purge the edge for this host only -- never `purge_everything`:

    set -a; . /home/webdesigners/ac.env; set +a
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/5d787a3a05375138c6158b6c1eae79f9/purge_cache" \
      -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
      --data '{"hosts":["chancela.xyz"]}'

## Sign-in broke after a dependency bump

Almost always the CSP. Open the console, find the blocked origin, add it to the
`$chancela_csp` map in /etc/nginx/conf.d/chancela.conf, `nginx -t`, reload.
Do not add a nonce: it would make browsers ignore 'unsafe-inline' and break
Next.js's inline bootstrap.

## Editing nginx

Six live customer sites share this nginx. Always `nginx -t` before
`systemctl reload nginx`, and never `systemctl restart nginx`.

## Never touch

The shared studio tunnel (CF_TUNNEL_ID in /home/webdesigners/ac.env) carries six
customer domains. This project owns only the tunnel named `chancela`.
DOC
echo "runbook written"
```

- [ ] **Step 10: Commit**

```bash
cd /home/mygestor/trustagent
git add docs/runbook-chancela-xyz.md
git commit -m "$(cat <<'MSG'
Add the chancela.xyz runbook

Records the traffic path, what a 530 and a 503 each mean, how to deploy
and purge, and which tunnel must never be touched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```
