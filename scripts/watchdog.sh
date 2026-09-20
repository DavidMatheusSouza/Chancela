#!/usr/bin/env bash
# Keep the deployment answering while nobody is watching.
#
# Judging runs for two weeks, asynchronously. This runs from cron every ten
# minutes, checks what a judge would meet, repairs the two things an
# unprivileged user can repair, and writes one line per run to a log. Problems
# go to stderr too, so cron's MAILTO -- or ALERT_WEBHOOK_URL, if set -- carries
# them to a person.
#
#   */10 * * * * /path/to/scripts/watchdog.sh >> /path/to/chancela-watchdog.log 2>&1
#
# It spends no gas: anchoring is judged from the public audit trail, not by
# making decisions of its own.
set -uo pipefail

SITE="${WATCHDOG_SITE:-https://chancela.xyz}"
LOCAL="${WATCHDOG_LOCAL:-http://127.0.0.1:3080}"
PGDATA="${WATCHDOG_PGDATA:-/home/mygestor/.trustagent-pg/data}"
PGBIN="$(ls -d /usr/pgsql-*/bin 2>/dev/null | sort -V | tail -1)"
LOW_ANCHORS="${WATCHDOG_LOW_ANCHORS:-150}"
ME="$(id -un)"

problems=()
notes=()
json() { python3 -c "import sys,json
try:
    d=json.load(sys.stdin)
    for k in sys.argv[1].split('.'): d=d[k] if not k.isdigit() else d[int(k)]
    print(d)
except Exception: print('')" "$1"; }

# 1. The database. If it is down, start it: the cluster is ours.
if [ -n "$PGBIN" ] && ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$(dirname "$PGDATA")/server.log" -w -t 30 start >/dev/null 2>&1 \
    && notes+=("database was down: started") || problems+=("database is down and did not start")
fi

# 2. The app, from the inside. systemd restarts a dead process by itself; a
#    wedged one needs ending, which is how an unprivileged user asks for that.
local_health="$(curl -s -m 10 "$LOCAL/api/health")"
if [ "$(printf '%s' "$local_health" | json status)" != "ok" ]; then
  pid="$(ss -ltnp 2>/dev/null | grep '127.0.0.1:3080 ' | grep -oP 'pid=\K[0-9]+' | head -1)"
  if [ -n "$pid" ] && [ "$(ps -o user= -p "$pid" | tr -d ' ')" = "$ME" ]; then
    kill "$pid" && notes+=("app not answering: ended pid $pid for a restart")
    sleep 15
    local_health="$(curl -s -m 10 "$LOCAL/api/health")"
  fi
  [ "$(printf '%s' "$local_health" | json status)" = "ok" ] || problems+=("app is not answering on $LOCAL")
fi
[ "$(printf '%s' "$local_health" | json storage)" = "postgres" ] || problems+=("app is not on the database: $(printf '%s' "$local_health" | json storage)")
[ "$(printf '%s' "$local_health" | json anchoring)" = "enabled" ] || problems+=("anchoring is not enabled")

# 3. The site, from the outside, the way a judge arrives: no cookie, /demo.
code="$(curl -s -m 30 -L -c /dev/null -b /dev/null -o /dev/null -w '%{http_code}' "$SITE/demo")"
[ "$code" = "200" ] || problems+=("$SITE/demo answered $code without a login")

# 4. Gas, and whether recent decisions actually reached the chain.
status="$(curl -s -m 20 "$SITE/api/network/status")"
left="$(printf '%s' "$status" | json attestorFunds.anchorsLeft)"
[ "$(printf '%s' "$status" | json reachable)" = "True" ] || problems+=("Monad RPC unreachable from the app")
if [ -n "$left" ] && [ "$left" -lt "$LOW_ANCHORS" ] 2>/dev/null; then
  problems+=("attestor can pay for only $left more anchors: top it up")
fi
failed="$(curl -s -m 20 "$SITE/api/agents/TA-001/audit?limit=8" | python3 -c "import sys,json
try: print(sum(1 for e in json.load(sys.stdin)['events'] if e.get('anchorStatus')=='FAILED'))
except Exception: print(-1)")"
[ "$failed" = "-1" ] && problems+=("could not read the public audit trail")
[ "$failed" -ge 3 ] 2>/dev/null && problems+=("$failed of the last 8 decisions failed to anchor")

stamp="$(date -u +%FT%TZ)"
if [ "${#problems[@]}" -eq 0 ]; then
  echo "$stamp ok anchors_left=${left:-?} ${notes[*]:-}"
else
  line="$stamp PROBLEM: $(IFS='; '; echo "${problems[*]}") ${notes[*]:-}"
  echo "$line"; echo "$line" >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -s -m 10 -X POST -H 'content-type: application/json' \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "content": sys.argv[1]}))' "Chancela watchdog: $line")" \
      "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
fi
