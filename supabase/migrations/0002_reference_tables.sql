-- ============================================================================
-- LinkBarangay migration 0002 — reference/configuration tables + seed data.
-- Additive and idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Barangays
-- ---------------------------------------------------------------------------
create table if not exists public.lb_barangays (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  code       text not null default '',
  city       text not null default '',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Departments (city-level response units)
-- ---------------------------------------------------------------------------
create table if not exists public.lb_departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text not null default '',
  description text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Service categories — each routes to a department and carries SLA hours
-- ---------------------------------------------------------------------------
create table if not exists public.lb_service_categories (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  description       text not null default '',
  department_id     uuid references public.lb_departments(id),
  required_documents jsonb not null default '[]'::jsonb,
  sla_hours         integer not null default 72,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Settings (SLA defaults, routing rules, workflow configuration)
-- ---------------------------------------------------------------------------
create table if not exists public.lb_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- ---------------------------------------------------------------------------
-- Seed data (matches the existing prototype's shown records)
-- ---------------------------------------------------------------------------
insert into public.lb_barangays (name, code) values
  ('San Roque',  'SR'),
  ('San Rafael', 'SRF'),
  ('Santo Niño', 'SN')
on conflict (name) do nothing;

insert into public.lb_departments (name, code, description) values
  ('Barangay Hall',     'BH', 'Barangay-level services, documents, and emergency coordination'),
  ('City Engineering',  'CE', 'Roads, infrastructure, streetlights, and electrical works'),
  ('Public Works',      'PW', 'Drainage systems and public maintenance'),
  ('Waste Management',  'WM', 'Sanitation and waste collection')
on conflict (name) do nothing;

insert into public.lb_service_categories (name, slug, description, department_id, sla_hours) values
  ('Roads & Infrastructure', 'roads-infrastructure', 'Damaged roads, sidewalks, and public infrastructure',
    (select id from public.lb_departments where name = 'City Engineering'), 96),
  ('Electrical',             'electrical',           'Streetlights and public electrical concerns',
    (select id from public.lb_departments where name = 'City Engineering'), 48),
  ('Drainage',               'drainage',             'Clogged drainage and flood control',
    (select id from public.lb_departments where name = 'Public Works'), 72),
  ('Sanitation',             'sanitation',           'Uncollected waste and sanitation concerns',
    (select id from public.lb_departments where name = 'Waste Management'), 48),
  ('Documents & Permits',    'documents-permits',    'Barangay clearances, permits, and certificates',
    (select id from public.lb_departments where name = 'Barangay Hall'), 72),
  ('Safety & Emergency',     'safety-emergency',     'Urgent community safety concerns',
    (select id from public.lb_departments where name = 'Barangay Hall'), 24),
  ('Community Welfare',      'community-welfare',    'Health, senior, youth, and social welfare services',
    (select id from public.lb_departments where name = 'Barangay Hall'), 120)
on conflict (slug) do nothing;

insert into public.lb_settings (key, value) values
  ('sla', '{"verification_hours": 24, "routing_hours": 24, "resolution_days": 5, "reopen_days": 7}'::jsonb),
  ('routing', '{"mode": "category_department", "default_department": "Barangay Hall"}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: reference data is publicly readable (needed pre-login for registration
-- and submission forms); writes are admin-only.
-- ---------------------------------------------------------------------------
alter table public.lb_barangays         enable row level security;
alter table public.lb_departments       enable row level security;
alter table public.lb_service_categories enable row level security;
alter table public.lb_settings          enable row level security;

drop policy if exists lb_barangays_read       on public.lb_barangays;
drop policy if exists lb_barangays_admin_write on public.lb_barangays;
drop policy if exists lb_departments_read     on public.lb_departments;
drop policy if exists lb_departments_admin_write on public.lb_departments;
drop policy if exists lb_categories_read      on public.lb_service_categories;
drop policy if exists lb_categories_admin_write on public.lb_service_categories;
drop policy if exists lb_settings_read        on public.lb_settings;
drop policy if exists lb_settings_admin_write on public.lb_settings;

create policy lb_barangays_read on public.lb_barangays
  for select to anon, authenticated using (true);
create policy lb_barangays_admin_write on public.lb_barangays
  for all to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());

create policy lb_departments_read on public.lb_departments
  for select to anon, authenticated using (true);
create policy lb_departments_admin_write on public.lb_departments
  for all to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());

create policy lb_categories_read on public.lb_service_categories
  for select to anon, authenticated using (true);
create policy lb_categories_admin_write on public.lb_service_categories
  for all to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());

create policy lb_settings_read on public.lb_settings
  for select to authenticated using (public.app_is_active_staff());
create policy lb_settings_admin_write on public.lb_settings
  for all to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());
