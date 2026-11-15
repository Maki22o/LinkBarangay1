#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# The managed vfs Docker driver copies whole image layers per container. Avoid
# exhausting a small workspace before cleanup can even start a shell.
if [[ "$(docker info --format '{{.Driver}}')" == "vfs" ]]; then
  available_kib=$(df -Pk . | awk 'NR==2 {print $4}')
  if (( available_kib < 4 * 1024 * 1024 )); then
    echo 'The isolated Realtime setup requires at least 4 GiB free with the vfs Docker driver.' >&2
    echo 'Free test storage or run this optional suite on a larger Docker host.' >&2
    exit 2
  fi
fi

# Optional real-transport suite. All data and credentials belong to disposable
# local containers; this script never accepts a hosted project/database URL.
prefix="lb-notification-realtime-$$"
database="$prefix-db"
server="$prefix-server"
network="$prefix-network"
cleanup() {
  result=$?
  if [[ "$result" != 0 ]]; then docker logs --tail 50 "$server" 2>/dev/null || true; fi
  docker rm --force --volumes "$server" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run --detach --rm --name "$database" --network "$network" \
  -e POSTGRES_PASSWORD=local-notification-test-password \
  postgres:17 -c wal_level=logical >/dev/null
ready=false
for attempt in {1..60}; do
  if docker exec "$database" sh -c 'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$database"; exit 1; fi
sql() { docker exec --interactive "$database" psql -X -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
echo 'Installing logical decoding support in the disposable PostgreSQL container'
docker exec --user root "$database" sh -c \
  'apt-get update -qq && apt-get install --no-install-recommends -y postgresql-17-wal2json' >/dev/null
if [[ "$(sql -Atc "select count(*) from pg_settings where name='output_plugin_libraries'")" == 1 ]]; then
  # Some PostgreSQL minor versions require explicitly trusting both plugins.
  sql <<'SQL'
alter system set output_plugin_libraries=wal2json,pgoutput;
select pg_reload_conf();
SQL
fi
sql <<'SQL'
create schema _realtime;
create schema realtime;
SQL
sql < supabase/tests/bootstrap.sql
for migration in supabase/migrations/*.sql; do
  if [[ "$migration" == *'/0007_'* ]]; then sql < supabase/tests/legacy_role_fixture.sql; fi
  if [[ "$migration" == *'/0015_'* ]]; then
    sql < supabase/tests/legacy_notification_fixture.sql
    sql < supabase/verification/0015_preflight.sql
  fi
  sql < "$migration"
done
sql < supabase/tests/realtime_fixture.sql
echo 'Starting pinned Supabase Realtime v2.34.47 with a test-only tenant'
docker run --detach --rm --name "$server" --network "$network" -p 127.0.0.1::4000 \
  -e PORT=4000 -e DB_HOST="$database" -e DB_PORT=5432 -e DB_USER=postgres \
  -e DB_PASSWORD=local-notification-test-password -e DB_NAME=postgres \
  -e 'DB_AFTER_CONNECT_QUERY=SET search_path TO _realtime' -e DB_ENC_KEY=supabaserealtime \
  -e API_JWT_SECRET=local-notification-test-secret-at-least-32-characters \
  -e SECRET_KEY_BASE=local-notification-test-secret-key-base-at-least-sixty-four-characters \
  -e ERL_AFLAGS='-proto_dist inet_tcp' -e DNS_NODES="''" -e RLIMIT_NOFILE=10000 \
  -e APP_NAME=realtime -e SEED_SELF_HOST=true -e SELF_HOST_TENANT_NAME=realtime-dev \
  -e RUN_JANITOR=true supabase/realtime:v2.34.47 >/dev/null
binding=$(docker port "$server" 4000/tcp)
export LB_REALTIME_DB_CONTAINER="$database"
export LB_REALTIME_PORT="${binding##*:}"
node tests/notificationRealtime.integration.mjs
