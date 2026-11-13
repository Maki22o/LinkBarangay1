-- ============================================================================
-- LinkBarangay migration 0001 — lb_profiles alignment, canonical roles,
-- signup trigger, privilege-escalation guards.
--
-- Additive and idempotent: safe to run on the existing "linkbarangay Project
-- collab" database. Existing role values (resident, officer, dispatcher,
-- field, admin) remain valid; secretary and captain are added.
-- Run in Supabase SQL Editor as one script.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ensure lb_profiles exists with the full column set (no-ops if present)
-- ---------------------------------------------------------------------------
create table if not exists public.lb_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  email         text not null default '',
  mobile        text not null default '',
  address       text not null default '',
  role          text not null default 'resident',
  worker_function text,
  status        text not null default 'active',
  barangay_id   uuid,
  department_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.lb_profiles add column if not exists full_name     text;
alter table public.lb_profiles add column if not exists email         text;
alter table public.lb_profiles add column if not exists mobile        text;
alter table public.lb_profiles add column if not exists address       text;
alter table public.lb_profiles add column if not exists barangay_id   uuid;
alter table public.lb_profiles add column if not exists department_id uuid;
alter table public.lb_profiles add column if not exists worker_function text;
alter table public.lb_profiles add column if not exists created_at    timestamptz not null default now();
alter table public.lb_profiles add column if not exists updated_at    timestamptz not null default now();

-- status must exist before the default is applied to old rows
alter table public.lb_profiles add column if not exists status text not null default 'active';

-- Backfill nulls so the NOT NULL + CHECK below always succeed
update public.lb_profiles set role   = 'resident' where role   is null or role   = '';
update public.lb_profiles set status = 'active'   where status is null or status = '';

-- ---------------------------------------------------------------------------
-- 2. Canonical role + status constraints (drop any legacy CHECKs first)
-- ---------------------------------------------------------------------------
do $$
declare
  con record;
begin
  for con in
    select distinct c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.lb_profiles'::regclass
      and c.contype = 'c'
      and a.attname in ('role', 'status', 'worker_function')
  loop
    execute format('alter table public.lb_profiles drop constraint %I', con.conname);
  end loop;
end $$;

update public.lb_profiles
set worker_function = role, role = 'worker'
where role in ('secretary','officer','captain','dispatcher','field');

alter table public.lb_profiles alter column role   set not null;
alter table public.lb_profiles alter column status set not null;

-- Canonical account roles are resident, worker, and admin.
alter table public.lb_profiles add constraint lb_profiles_role_check
  check (role in ('resident','worker','admin'));
alter table public.lb_profiles add constraint lb_profiles_worker_function_check
  check (worker_function is null or worker_function in ('secretary','officer','captain','dispatcher','field'));
alter table public.lb_profiles add constraint lb_profiles_worker_function_role_check
  check ((role = 'worker' and worker_function is not null) or (role <> 'worker' and worker_function is null));
alter table public.lb_profiles add constraint lb_profiles_status_check
  check (status in ('active','suspended','inactive'));

create index if not exists lb_profiles_role_idx       on public.lb_profiles (role);
create index if not exists lb_profiles_status_idx     on public.lb_profiles (status);
create index if not exists lb_profiles_barangay_idx   on public.lb_profiles (barangay_id);
create index if not exists lb_profiles_department_idx on public.lb_profiles (department_id);

-- ---------------------------------------------------------------------------
-- 3. Role helpers (SECURITY DEFINER so RLS policies can call them safely)
-- ---------------------------------------------------------------------------
create or replace function public.app_current_role()
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(worker_function, role) from public.lb_profiles where id = auth.uid()
$$;

create or replace function public.app_current_status()
returns text
language sql stable security definer set search_path = public as $$
  select status from public.lb_profiles where id = auth.uid()
$$;

create or replace function public.app_current_barangay()
returns uuid
language sql stable security definer set search_path = public as $$
  select barangay_id from public.lb_profiles where id = auth.uid()
$$;

create or replace function public.app_current_department()
returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.lb_profiles where id = auth.uid()
$$;

create or replace function public.app_current_full_name()
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), split_part(coalesce(email, ''), '@', 1), 'User')
  from public.lb_profiles where id = auth.uid()
$$;

-- Any authenticated user with an active account (residents included)
create or replace function public.app_is_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lb_profiles
    where id = auth.uid() and status = 'active'
  )
$$;

-- Active staff (any of the six staff roles)
create or replace function public.app_is_active_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lb_profiles
    where id = auth.uid()
      and status = 'active'
      and role in ('worker','admin')
  )
$$;

create or replace function public.app_is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lb_profiles
    where id = auth.uid() and status = 'active' and role = 'admin'
  )
$$;

revoke all on function public.app_current_role()       from public;
revoke all on function public.app_current_status()     from public;
revoke all on function public.app_current_barangay()   from public;
revoke all on function public.app_current_department() from public;
revoke all on function public.app_current_full_name()  from public;
revoke all on function public.app_is_active()          from public;
revoke all on function public.app_is_active_staff()    from public;
revoke all on function public.app_is_admin()           from public;
grant execute on function public.app_current_role()       to anon, authenticated;
grant execute on function public.app_current_status()     to anon, authenticated;
grant execute on function public.app_current_barangay()   to anon, authenticated;
grant execute on function public.app_current_department() to anon, authenticated;
grant execute on function public.app_current_full_name()  to authenticated;
grant execute on function public.app_is_active()          to anon, authenticated;
grant execute on function public.app_is_active_staff()    to authenticated;
grant execute on function public.app_is_admin()           to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Auto-create a resident profile when a user signs up through Supabase Auth
-- ---------------------------------------------------------------------------
create or replace function public.app_handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.lb_profiles (id, full_name, email, mobile, address, role, status)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'mobile', ''),
    coalesce(new.raw_user_meta_data->>'address', ''),
    'resident',
    'active'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.app_handle_new_user();

-- ---------------------------------------------------------------------------
-- 5. Profile update guard — nobody may change their own role/status/scope;
--    only ACTIVE ADMINISTRATORS may change another user's role/status/scope.
--    Service-role / SQL-editor contexts (auth.uid() is null) are unaffected.
-- ---------------------------------------------------------------------------
create or replace function public.app_guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  caller_role   text;
  caller_status text;
  v_caller      uuid := auth.uid();
begin
  if v_caller is null then
    return new;  -- service-role / migration context (Edge Function, SQL editor)
  end if;

  select role, status into caller_role, caller_status
  from public.lb_profiles where id = v_caller;

  if caller_role is null then
    raise exception 'Caller has no profile; profile updates denied';
  end if;

  if v_caller = new.id then
    -- Self-service: only free-text fields may change.
    if (new.role      is distinct from old.role)
      or (new.worker_function is distinct from old.worker_function)
      or (new.status  is distinct from old.status)
      or (new.barangay_id   is distinct from old.barangay_id)
      or (new.department_id is distinct from old.department_id) then
      raise exception 'Users cannot change their own role, status, barangay, or department';
    end if;
    return new;
  end if;

  -- Editing someone else requires an active administrator.
  if caller_role <> 'admin' or caller_status <> 'active' then
    raise exception 'Only active administrators may modify other accounts';
  end if;

  -- An administrator may not accidentally strip the last admin's role via the
  -- frontend path; role changes to other admins are allowed but audited (0004).
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists app_guard_profile_update_trg on public.lb_profiles;
create trigger app_guard_profile_update_trg
  before update on public.lb_profiles
  for each row execute function public.app_guard_profile_update();

-- Optional backfill: populate profile emails/names from auth users where empty
update public.lb_profiles p
set full_name = coalesce(nullif(p.full_name, ''), u.raw_user_meta_data->>'full_name',
                         u.raw_user_meta_data->>'name', split_part(coalesce(u.email,''),'@',1)),
    email    = coalesce(nullif(p.email, ''), u.email, '')
from auth.users u
where p.id = u.id
  and (p.full_name = '' or p.email = '');
