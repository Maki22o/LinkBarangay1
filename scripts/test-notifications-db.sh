#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Creates only an isolated, disposable container, with no network or host ports.
# Never accepts a production database URL and never resets a Supabase project.
container_name="linkbarangay-notification-tests-$$"
cleanup() { docker rm --force --volumes "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --detach --rm --network none --name "$container_name" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 -c wal_level=logical >/dev/null
ready=false
for attempt in {1..60}; do
  # pg_isready also succeeds for the entrypoint's temporary initialization
  # server. Wait until PID 1 is the final postgres process as well.
  if docker exec "$container_name" sh -c 'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$container_name"; exit 1; fi
sql() { docker exec --interactive "$container_name" psql -X -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
sql < supabase/tests/bootstrap.sql
for migration in supabase/migrations/*.sql; do
  if [[ "$migration" == *'/0007_'* ]]; then
    if [[ "${LB_TEST_CANONICAL_BOOTSTRAP:-0}" == 1 ]]; then
      echo "Applying fresh canonical 0007 initializer instead of archived legacy conversion"
      sql < supabase/bootstrap/0007_fresh_baseline.sql
      continue
    fi
    echo "Applying explicit archive compatibility fixture before unchanged 0007"
    sql < supabase/tests/legacy_role_fixture.sql
  fi
  if [[ "$migration" == *'/0015_'* ]]; then
    sql < supabase/tests/legacy_notification_fixture.sql
    sql < supabase/verification/0015_preflight.sql
  fi
  echo "Applying $migration"
  sql < "$migration"
done
echo "Testing persisted delivery, scoping, security, read state, and rollback"
sql < supabase/tests/notifications.sql
sql < supabase/tests/notification_regressions.sql
# Hold the first transaction open while a second session retries its status.
# This exercises the request lock against real overlapping PostgreSQL clients.
sql <<'SQL' &
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',true);
select public.app_transition_request('40000000-0000-0000-0000-000000000077','verified');
select pg_sleep(1);
commit;
SQL
first_client=$!
sleep 0.2
sql <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
select public.app_transition_request('40000000-0000-0000-0000-000000000077','verified');
SQL
wait "$first_client"
sql <<'SQL'
select notification_tests.assert((select count(*)=1 from public.lb_request_updates
 where request_id='40000000-0000-0000-0000-000000000077' and new_status='verified'),
 'concurrent transition retries commit one workflow event');
select notification_tests.assert((select count(*)=1 from public.lb_notifications
 where request_id='40000000-0000-0000-0000-000000000077'
 and user_id='00000000-0000-0000-0000-000000000101' and event_type='request.verified'),
 'concurrent transition retries deliver one persisted owner notification');
SQL
