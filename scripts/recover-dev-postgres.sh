#!/usr/bin/env bash
# Get back into the user-space Postgres cluster after its password is lost.
#
# The password lives only in .env. When .env is lost the data is intact but
# nobody can log in: every line of pg_hba.conf asks for scram. This script is
# run by the OS user that owns the cluster, and:
#
#   1. puts ONE extra rule at the top of pg_hba.conf -- `peer` on the local
#      socket, mapped to this OS user only, so no other account on a shared
#      host gets in during the window;
#   2. sets a fresh random password on the cluster's role;
#   3. restores pg_hba.conf and pg_ident.conf exactly, whatever happened;
#   4. writes DATABASE_URL into .env (mode 600) and restarts the web process.
#
# It never prints the password, never touches another cluster, and refuses to
# run against a data directory it does not own.
#
#   bash scripts/recover-dev-postgres.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGPORT="${PGPORT:-5442}"
ME="$(id -un)"

PGROOT="${PGROOT:-}"
if [ -z "$PGROOT" ]; then
  for candidate in "$ROOT/../.chancela-pg" "$ROOT/../.trustagent-pg"; do
    [ -d "$candidate/data" ] && PGROOT="$(cd "$candidate" && pwd)" && break
  done
fi
[ -n "$PGROOT" ] || { echo "No cluster found next to the repository. Set PGROOT." >&2; exit 1; }
DATA="$PGROOT/data"
[ "$(stat -c %U "$DATA")" = "$ME" ] || { echo "$DATA is not owned by $ME. Refusing." >&2; exit 1; }
grep -qE "^port *= *$PGPORT\b" "$DATA/postgresql.conf" || { echo "$DATA is not the cluster on port $PGPORT. Refusing." >&2; exit 1; }

BIN="$(ls -d /usr/pgsql-*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -z "$BIN" ] && BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$BIN" ] || { echo "No PostgreSQL binaries found." >&2; exit 1; }

cp -p "$DATA/pg_hba.conf" "$DATA/pg_hba.conf.pre-recovery"
cp -p "$DATA/pg_ident.conf" "$DATA/pg_ident.conf.pre-recovery"
restore() {
  cp -p "$DATA/pg_hba.conf.pre-recovery" "$DATA/pg_hba.conf"
  cp -p "$DATA/pg_ident.conf.pre-recovery" "$DATA/pg_ident.conf"
  rm -f "$DATA/pg_hba.conf.pre-recovery" "$DATA/pg_ident.conf.pre-recovery"
  "$BIN/pg_ctl" reload -D "$DATA" >/dev/null
  echo "access rules restored"
}
trap restore EXIT

{ echo "local all all peer map=recover"; cat "$DATA/pg_hba.conf.pre-recovery"; } > "$DATA/pg_hba.conf"
for role in chancela trustagent postgres; do echo "recover $ME $role"; done >> "$DATA/pg_ident.conf"
"$BIN/pg_ctl" reload -D "$DATA" >/dev/null
sleep 1

ROLE=""
for role in chancela trustagent postgres; do
  if "$BIN/psql" -h "$PGROOT" -p "$PGPORT" -U "$role" -d postgres -Atc 'select 1' >/dev/null 2>&1; then
    ROLE="$role"; break
  fi
done
[ -n "$ROLE" ] || { echo "Could not log in as any expected role." >&2; exit 1; }

DB="$("$BIN/psql" -h "$PGROOT" -p "$PGPORT" -U "$ROLE" -d postgres -Atc \
  "select datname from pg_database where not datistemplate and datname <> 'postgres' order by datname limit 1")"
[ -n "$DB" ] || { echo "No application database in this cluster." >&2; exit 1; }

PASS="$(openssl rand -hex 24)"
"$BIN/psql" -h "$PGROOT" -p "$PGPORT" -U "$ROLE" -d postgres -q <<SQL
ALTER ROLE "$ROLE" PASSWORD '$PASS';
SQL
echo "new password set for role $ROLE (database $DB)"

ENV="$ROOT/.env"
umask 077
touch "$ENV"
grep -v '^DATABASE_URL=' "$ENV" > "$ENV.tmp" || true
echo "DATABASE_URL=postgresql://$ROLE:$PASS@127.0.0.1:$PGPORT/$DB" >> "$ENV.tmp"
mv "$ENV.tmp" "$ENV"
chmod 600 "$ENV"
echo "DATABASE_URL written to $ENV"

# The unit restarts the process by itself; ending ours is how an unprivileged
# user asks for that. Scoped to the PID listening on the app's port.
PID="$(ss -ltnp 2>/dev/null | grep '127.0.0.1:3080 ' | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
if [ -n "$PID" ] && [ "$(ps -o user= -p "$PID" | tr -d ' ')" = "$ME" ]; then
  kill "$PID"
  echo "web process $PID ended; the service will start a new one with the database"
fi
