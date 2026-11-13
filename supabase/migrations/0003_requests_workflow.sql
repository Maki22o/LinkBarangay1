-- ============================================================================
-- LinkBarangay migration 0003 — service requests, request updates,
-- assignments, appointments, attachments, audit logs, storage bucket.
-- Additive and idempotent. Existing rows are preserved and backfilled.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lb_service_requests — widen to the full workflow schema
-- ---------------------------------------------------------------------------
create table if not exists public.lb_service_requests (
  id                 uuid primary key default gen_random_uuid(),
  reference          text,
  tracking_code      text,
  title              text not null default 'Untitled request',
  description        text not null default '',
  category_id        uuid references public.lb_service_categories(id),
  barangay_id        uuid references public.lb_barangays(id),
  department_id      uuid references public.lb_departments(id),
  status             text not null default 'submitted',
  priority           text not null default 'normal',
  is_anonymous       boolean not null default false,
  submitter_name     text,
  submitter_contact  text,
  location           text not null default '',
  submitted_by       uuid references auth.users(id) on delete set null,
  assigned_to        uuid references auth.users(id) on delete set null,
  assigned_by        uuid references auth.users(id) on delete set null,
  due_at             timestamptz,
  needs_info_by      uuid references auth.users(id) on delete set null,
  needs_info_message text not null default '',
  rejection_reason   text not null default '',
  resolved_at        timestamptz,
  closed_at          timestamptz,
  reopened_count     integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.lb_service_requests
  add column if not exists reference          text,
  add column if not exists tracking_code      text,
  add column if not exists category_id        uuid,
  add column if not exists barangay_id        uuid,
  add column if not exists department_id      uuid,
  add column if not exists priority           text,
  add column if not exists is_anonymous       boolean,
  add column if not exists submitter_name     text,
  add column if not exists submitter_contact  text,
  add column if not exists location           text,
  add column if not exists submitted_by       uuid,
  add column if not exists assigned_to        uuid,
  add column if not exists assigned_by        uuid,
  add column if not exists due_at             timestamptz,
  add column if not exists needs_info_by      uuid,
  add column if not exists needs_info_message text,
  add column if not exists rejection_reason   text,
  add column if not exists resolved_at        timestamptz,
  add column if not exists closed_at          timestamptz,
  add column if not exists reopened_count     integer,
  add column if not exists updated_at         timestamptz;

-- Defaults / backfills so every row satisfies the new constraints
update public.lb_service_requests set title    = 'Untitled request' where title    is null;
update public.lb_service_requests set description = coalesce(description, '') where description is null;
update public.lb_service_requests set location = coalesce(location, '') where location is null;
update public.lb_service_requests set status   = 'submitted'        where status   is null or status = '';
update public.lb_service_requests set priority = 'normal'           where priority is null or priority = '';
update public.lb_service_requests set is_anonymous = coalesce(is_anonymous, false) where is_anonymous is null;
update public.lb_service_requests set reopened_count = coalesce(reopened_count, 0) where reopened_count is null;
update public.lb_service_requests set needs_info_message = coalesce(needs_info_message, '') where needs_info_message is null;
update public.lb_service_requests set rejection_reason   = coalesce(rejection_reason, '')   where rejection_reason   is null;
update public.lb_service_requests set updated_at = coalesce(updated_at, now()) where updated_at is null;

-- If a legacy owner column exists (user_id / requester_id), copy it into submitted_by
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'lb_service_requests' and column_name = 'user_id') then
    update public.lb_service_requests set submitted_by = coalesce(submitted_by, "user_id");
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'lb_service_requests' and column_name = 'requester_id') then
    update public.lb_service_requests set submitted_by = coalesce(submitted_by, "requester_id");
  end if;
end $$;

-- Normalize legacy status/priority spellings, then constrain them
update public.lb_service_requests
set status = case lower(replace(trim(status), ' ', '_'))
               when 'open'              then 'submitted'
               when 'routed'            then 'assigned'
               when 'needs_correction'  then 'needs_information'
               when 'needs_info'        then 'needs_information'
               when 'inspection'        then 'for_inspection'
               when 'complete'          then 'resolved'
               when 'completed'         then 'resolved'
               else lower(replace(trim(status), ' ', '_'))
             end;

do $$
declare con record;
begin
  for con in
    select distinct c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.lb_service_requests'::regclass
      and c.contype = 'c' and a.attname in ('status', 'priority')
  loop
    execute format('alter table public.lb_service_requests drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.lb_service_requests alter column status   set not null;
alter table public.lb_service_requests alter column priority set not null;
alter table public.lb_service_requests alter column is_anonymous set not null;
alter table public.lb_service_requests alter column reopened_count set not null;

alter table public.lb_service_requests add constraint lb_requests_status_check
  check (status in ('submitted','for_verification','needs_information','verified',
                    'assigned','in_progress','for_inspection','resolved','closed','rejected'));
alter table public.lb_service_requests add constraint lb_requests_priority_check
  check (priority in ('low','normal','medium','high','urgent'));

-- Reference numbers + secure tracking codes (needed for public tracking)
update public.lb_service_requests
set reference = 'LB-' || to_char(coalesce(created_at, now()), 'YYYY') || '-' ||
                lpad((floor(random() * 9000) + 1000)::text, 4, '0')
where reference is null or reference = '';

update public.lb_service_requests
set tracking_code = upper(substring(md5(random()::text) from 1 for 6))
where tracking_code is null or tracking_code = '';

-- Unique indexes created AFTER backfill (NULLs are allowed to repeat in PG unique indexes)
create unique index if not exists lb_requests_reference_key     on public.lb_service_requests (reference);
create unique index if not exists lb_requests_tracking_key      on public.lb_service_requests (tracking_code);

create index if not exists lb_requests_status_idx      on public.lb_service_requests (status);
create index if not exists lb_requests_submitter_idx   on public.lb_service_requests (submitted_by);
create index if not exists lb_requests_barangay_idx    on public.lb_service_requests (barangay_id);
create index if not exists lb_requests_department_idx  on public.lb_service_requests (department_id);
create index if not exists lb_requests_assigned_idx    on public.lb_service_requests (assigned_to);
create index if not exists lb_requests_category_idx    on public.lb_service_requests (category_id);

-- ---------------------------------------------------------------------------
-- 2. lb_request_updates — full activity trail
-- ---------------------------------------------------------------------------
create table if not exists public.lb_request_updates (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references public.lb_service_requests(id) on delete cascade,
  actor_id        uuid references auth.users(id) on delete set null,
  actor_name      text not null default 'System',
  type            text not null default 'status_change',
  previous_status text,
  new_status      text,
  remarks         text not null default '',
  created_at      timestamptz not null default now()
);

alter table public.lb_request_updates add column if not exists actor_id        uuid;
alter table public.lb_request_updates add column if not exists actor_name      text;
alter table public.lb_request_updates add column if not exists type            text;
alter table public.lb_request_updates add column if not exists previous_status text;
alter table public.lb_request_updates add column if not exists new_status      text;
alter table public.lb_request_updates add column if not exists remarks         text;
alter table public.lb_request_updates add column if not exists created_at      timestamptz not null default now();

update public.lb_request_updates set actor_name = 'System' where actor_name is null;
update public.lb_request_updates set type = 'status_change' where type is null;
update public.lb_request_updates set remarks = '' where remarks is null;
update public.lb_request_updates set created_at = coalesce(created_at, now()) where created_at is null;

alter table public.lb_request_updates alter column type       set not null;
alter table public.lb_request_updates alter column actor_name set not null;
alter table public.lb_request_updates alter column remarks    set not null;

create index if not exists lb_updates_request_idx on public.lb_request_updates (request_id, created_at);

-- Auto-log the initial submission whenever a request is created
create or replace function public.app_log_request_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor_name text;
begin
  select coalesce(
    nullif(new.submitter_name, ''),
    (select full_name from public.lb_profiles where id = new.submitted_by),
    'System'
  ) into v_actor_name;

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, new_status, remarks)
  values
    (new.id, new.submitted_by, v_actor_name, 'status_change', 'submitted',
     case when new.is_anonymous then 'Anonymous report submitted' else 'Request submitted' end);
  return new;
end $$;

drop trigger if exists app_log_request_created_trg on public.lb_service_requests;
create trigger app_log_request_created_trg
  after insert on public.lb_service_requests
  for each row execute function public.app_log_request_created();

-- ---------------------------------------------------------------------------
-- 3. lb_assignments — dispatcher → field personnel job assignments
-- ---------------------------------------------------------------------------
create table if not exists public.lb_assignments (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.lb_service_requests(id) on delete cascade,
  assigned_to   uuid not null references auth.users(id) on delete cascade,
  assigned_by   uuid references auth.users(id) on delete set null,
  department_id uuid references public.lb_departments(id),
  status        text not null default 'pending',
  decline_reason text not null default '',
  schedule_at   timestamptz,
  deadline_at   timestamptz,
  accepted_at   timestamptz,
  completed_at  timestamptz,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.lb_assignments add column if not exists decline_reason text not null default '';
alter table public.lb_assignments add column if not exists notes          text not null default '';
alter table public.lb_assignments add column if not exists updated_at     timestamptz not null default now();

do $$
declare con record;
begin
  for con in
    select distinct c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.lb_assignments'::regclass and c.contype = 'c' and a.attname = 'status'
  loop
    execute format('alter table public.lb_assignments drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.lb_assignments add constraint lb_assignments_status_check
  check (status in ('pending','accepted','declined','in_progress','completed','verified'));

create index if not exists lb_assignments_request_idx  on public.lb_assignments (request_id);
create index if not exists lb_assignments_assignee_idx on public.lb_assignments (assigned_to, status);

-- ---------------------------------------------------------------------------
-- 4. lb_appointments — secretary appointment scheduling
-- ---------------------------------------------------------------------------
create table if not exists public.lb_appointments (
  id           uuid primary key default gen_random_uuid(),
  barangay_id  uuid references public.lb_barangays(id),
  resident_id  uuid references auth.users(id) on delete set null,
  request_id   uuid references public.lb_service_requests(id) on delete set null,
  scheduled_at timestamptz not null,
  purpose      text not null default '',
  status       text not null default 'scheduled',
  created_by   uuid references auth.users(id) on delete set null,
  notes        text not null default '',
  created_at   timestamptz not null default now()
);

do $$
declare con record;
begin
  for con in
    select distinct c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.lb_appointments'::regclass and c.contype = 'c' and a.attname = 'status'
  loop
    execute format('alter table public.lb_appointments drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.lb_appointments add constraint lb_appointments_status_check
  check (status in ('scheduled','completed','cancelled','no_show'));
create index if not exists lb_appointments_brgy_idx on public.lb_appointments (barangay_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- 5. lb_attachments — metadata for files in the private storage bucket
-- ---------------------------------------------------------------------------
create table if not exists public.lb_attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid references public.lb_service_requests(id) on delete cascade,
  owner_id     uuid references auth.users(id) on delete set null,
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null default '',
  size_bytes   bigint,
  kind         text not null default 'supporting_doc',
  created_at   timestamptz not null default now()
);

do $$
declare con record;
begin
  for con in
    select distinct c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.lb_attachments'::regclass and c.contype = 'c' and a.attname = 'kind'
  loop
    execute format('alter table public.lb_attachments drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.lb_attachments add constraint lb_attachments_kind_check
  check (kind in ('supporting_doc','before_photo','after_photo','reply_doc','completion_doc'));
create index if not exists lb_attachments_request_idx on public.lb_attachments (request_id);

-- ---------------------------------------------------------------------------
-- 6. lb_audit_logs — immutable trail of sensitive actions
-- ---------------------------------------------------------------------------
create table if not exists public.lb_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id) on delete set null,
  actor_name  text not null default 'System',
  action      text not null,
  entity_type text not null default '',
  entity_id   text not null default '',
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists lb_audit_created_idx  on public.lb_audit_logs (created_at desc);
create index if not exists lb_audit_entity_idx   on public.lb_audit_logs (entity_type, entity_id);

-- Audit every role/status/scope change made on profiles
create or replace function public.app_audit_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role)
    or (new.worker_function is distinct from old.worker_function)
    or (new.status is distinct from old.status)
    or (new.barangay_id   is distinct from old.barangay_id)
    or (new.department_id is distinct from old.department_id) then
    insert into public.lb_audit_logs
      (actor_id, actor_name, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      coalesce((select full_name from public.lb_profiles where id = auth.uid()), 'System'),
      'account.update',
      'lb_profiles',
      new.id::text,
      jsonb_build_object(
        'email',        new.email,
        'old_role',     old.role,     'new_role',     new.role,
        'old_worker_function', old.worker_function, 'new_worker_function', new.worker_function,
        'old_status',   old.status,   'new_status',   new.status,
        'old_barangay', old.barangay_id,   'new_barangay',   new.barangay_id,
        'old_department', old.department_id, 'new_department', new.department_id
      )
    );
  end if;
  return new;
end $$;

drop trigger if exists app_audit_profile_change_trg on public.lb_profiles;
create trigger app_audit_profile_change_trg
  after update on public.lb_profiles
  for each row execute function public.app_audit_profile_change();

-- ---------------------------------------------------------------------------
-- 7. Storage bucket for request attachments (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', false)
on conflict (id) do nothing;

-- Keep upload limits enforced by Storage even when a client bypasses the UI.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif','application/pdf']
where id = 'request-attachments';

drop policy if exists "lb attachments read"  on storage.objects;
drop policy if exists "lb attachments write" on storage.objects;

create policy "lb attachments read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'request-attachments'
    and (
      owner = auth.uid()
      or public.app_is_active_staff()
    )
  );

create policy "lb attachments write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'request-attachments'
    and owner = auth.uid()
    and public.app_is_active()
  );

-- ---------------------------------------------------------------------------
-- 8. Ensure the FK constraints used by PostgREST embeds exist.
--    (Columns added above via add column if not exists get their FKs from the
--    create table statement; this block covers columns that already existed.)
--    NOT VALID so legacy rows cannot fail the migration.
-- ---------------------------------------------------------------------------
do $$
declare
  fk record;
  con_name text;
begin
  for fk in
    select * from (values
      ('lb_service_requests', 'category_id',   'lb_service_categories'),
      ('lb_service_requests', 'barangay_id',   'lb_barangays'),
      ('lb_service_requests', 'department_id', 'lb_departments'),
      ('lb_service_requests', 'submitted_by',  'auth.users'),
      ('lb_service_requests', 'assigned_to',   'auth.users'),
      ('lb_service_requests', 'assigned_by',   'auth.users'),
      ('lb_service_requests', 'needs_info_by', 'auth.users'),
      ('lb_request_updates',  'request_id',    'lb_service_requests'),
      ('lb_request_updates',  'actor_id',      'auth.users'),
      ('lb_assignments',      'request_id',    'lb_service_requests'),
      ('lb_assignments',      'assigned_to',   'auth.users'),
      ('lb_assignments',      'assigned_by',   'auth.users'),
      ('lb_assignments',      'department_id', 'lb_departments'),
      ('lb_appointments',     'barangay_id',   'lb_barangays'),
      ('lb_appointments',     'resident_id',   'auth.users'),
      ('lb_appointments',     'request_id',    'lb_service_requests'),
      ('lb_appointments',     'created_by',    'auth.users'),
      ('lb_attachments',      'request_id',    'lb_service_requests'),
      ('lb_attachments',      'owner_id',      'auth.users'),
      ('lb_notifications',    'user_id',       'auth.users'),
      ('lb_notifications',    'request_id',    'lb_service_requests')
    ) as t(tbl, col, ref_table)
  loop
    con_name := fk.tbl || '_' || fk.col || '_fkey';
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = fk.tbl and column_name = fk.col
    ) and not exists (
      select 1 from pg_constraint
      where conname = con_name and conrelid = ('public.' || fk.tbl)::regclass
    ) then
      begin
        execute format(
          'alter table public.%I add constraint %I foreign key (%I) references %I(id) on delete set null not valid',
          fk.tbl, con_name, fk.col, fk.ref_table);
      exception when duplicate_object then null;
      end;
    end if;
  end loop;
end $$;
