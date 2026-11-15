-- Isolated transport-test fixtures only. Never run on a deployed project.
-- Model both claim formats used by Supabase SQL clients and Realtime's RLS engine.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')
$$;
grant execute on function auth.role() to anon,authenticated;
insert into public.lb_barangays(id,name,code) values
 ('10000000-0000-0000-0000-000000000001','Transport Test Barangay','RT');
insert into public.lb_service_categories(id,name,slug) values
 ('30000000-0000-0000-0000-000000000001','Transport Test','realtime-transport-test');
insert into auth.users(id,email,raw_user_meta_data)
select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 'transport-' || n || '@example.test',
 '{"barangay_id":"10000000-0000-0000-0000-000000000001"}'::jsonb
from unnest(array[101,102,201]) n;
update public.lb_profiles set role='worker',worker_function='secretary'
 where id='00000000-0000-0000-0000-000000000201';
-- Seed account notices are unrelated to the events under test.
truncate public.lb_notifications;
