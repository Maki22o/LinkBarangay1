#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

container="linkbarangay-field-tests-$$"
trap 'docker rm --force --volumes "$container" >/dev/null 2>&1 || true' EXIT
docker run --detach --rm --network none --name "$container" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 -c wal_level=logical >/dev/null
sql() { docker exec --interactive "$container" psql -X -q -U postgres -v ON_ERROR_STOP=1 "$@"; }

for attempt in {1..60}; do
  if docker exec "$container" sh -c 'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres' >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 60 ]]; then docker logs "$container"; exit 1; fi
  sleep 1
done

sql < supabase/tests/bootstrap.sql
for migration in supabase/migrations/*.sql; do
  case "$migration" in
    */0007_*) sql < supabase/bootstrap/0007_fresh_baseline.sql ;;
    */0015_*) sql < supabase/tests/legacy_notification_fixture.sql
      sql < supabase/verification/0015_preflight.sql
      sql < "$migration" ;;
    *) sql < "$migration" ;;
  esac
done
sql < supabase/tests/field_scheduling.sql

# Hold the first booking transaction open and start an overlapping RPC in a
# different connection. The second client must see the winning booking.
sql <<'SQL' &
set application_name='lb-field-primary';
begin;
set local role authenticated;
select field_scheduling_tests.as_user(2);
select public.app_save_field_assignment(field_scheduling_tests.id(13),field_scheduling_tests.id(3),
  field_scheduling_tests.slot(360),60,'First booking');
select pg_sleep(3);
commit;
SQL
first_client=$!
for attempt in {1..60}; do
  if [[ "$(sql -Atc "select count(*) from pg_stat_activity where application_name='lb-field-primary' and wait_event='PgSleep'")" == 1 ]]; then break; fi
  if [[ "$attempt" == 60 ]]; then echo "First booking did not reach its hold point"; exit 1; fi
  sleep 0.05
done

if second_result=$(sql 2>&1 <<'SQL'
set role authenticated;
select field_scheduling_tests.as_user(2);
select public.app_save_field_assignment(field_scheduling_tests.id(14),field_scheduling_tests.id(3),
  field_scheduling_tests.slot(390),60,'Overlapping booking');
SQL
); then
  echo "An overlapping booking unexpectedly succeeded"; exit 1
fi
[[ "$second_result" == *"overlaps a booking"* ]] || { echo "$second_result"; exit 1; }
wait "$first_client"
echo "The integrated field scheduling and concurrent booking checks passed."
