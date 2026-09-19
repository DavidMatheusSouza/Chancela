#!/usr/bin/env bash
#
# A Postgres for TrustAgent, without Docker and without root.
#
# docker-compose.yml remains the intended path. This exists for hosts where
# Docker is not installed and cannot be -- a shared box where you are not root,
# which is the common case for a hackathon VPS. It uses the system's Postgres
# binaries to run a cluster that belongs entirely to this project:
#
#   - its own data directory, outside the repository
#   - its own port, bound to loopback only
#   - its own role and database
#
# It never touches an existing cluster. If something else already listens on
# PGPORT, it stops rather than guessing.
set -euo pipefail

PGPORT="${PGPORT:-5442}"
# Sibling of the repository, not $HOME: on a shared host the account's home and
# the project's directory are often different owners entirely.
PGROOT="${PGROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.trustagent-pg}"
PGDATA="$PGROOT/data"
PGUSER="${PGUSER:-trustagent}"
PGPASS="${PGPASS:-trustagent}"
PGDB="${PGDB:-trustagent}"

BIN="$(ls -d /usr/pgsql-*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -z "$BIN" ] && BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$BIN" ]; then
  echo "No PostgreSQL binaries found. Install postgresql-server, or use docker compose." >&2
  exit 1
fi

if [ ! -d "$PGDATA" ]; then
  if ss -ltn 2>/dev/null | grep -q ":$PGPORT "; then
    echo "Port $PGPORT is already in use. Set PGPORT to something free." >&2
    exit 1
  fi
  mkdir -p "$PGROOT"
  "$BIN/initdb" -D "$PGDATA" -U "$PGUSER" --auth=scram-sha-256 \
    --pwfile=<(echo "$PGPASS") -E UTF8 >/dev/null
  cat >> "$PGDATA/postgresql.conf" <<CONF

# Loopback only, on a port of this project's own, so it cannot collide with or
# be reached by anything else on the host.
listen_addresses = '127.0.0.1'
port = $PGPORT
unix_socket_directories = '$PGROOT'
CONF
  echo "Initialised a cluster at $PGDATA"
fi

if "$BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  echo "Already running on port $PGPORT"
else
  "$BIN/pg_ctl" -D "$PGDATA" -l "$PGROOT/server.log" start >/dev/null
  sleep 2
  echo "Started on port $PGPORT"
fi

export PGPASSWORD="$PGPASS"
if ! "$BIN/psql" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d postgres -Atc \
     "SELECT 1 FROM pg_database WHERE datname='$PGDB'" | grep -q 1; then
  "$BIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$PGDB"
  echo "Created database $PGDB"
fi

echo
echo "Put this in .env, then run: pnpm db:push"
echo "DATABASE_URL=postgresql://$PGUSER:$PGPASS@127.0.0.1:$PGPORT/$PGDB"
echo
echo "Stop it with: $BIN/pg_ctl -D $PGDATA stop"
