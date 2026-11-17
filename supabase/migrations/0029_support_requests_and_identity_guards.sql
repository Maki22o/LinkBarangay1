-- LinkBarangay: help-desk requests and identity uniqueness safeguards.
-- Run after the existing numbered migrations in the Supabase SQL Editor.

create table if not exists public.lb_support_requests (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null default auth.uid() references public.lb_profiles(id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 4 and 180),
  category text not null check (category in ('account', 'request', 'technical', 'other')),
  description text not null check (char_length(btrim(description)) between 10 and 4000),
  contact text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lb_support_requests_submitter_created_idx
  on public.lb_support_requests (submitted_by, created_at desc);
create index if not exists lb_support_requests_status_created_idx
  on public.lb_support_requests (status, created_at desc);

alter table public.lb_support_requests enable row level security;

drop policy if exists support_requests_submit_own on public.lb_support_requests;
create policy support_requests_submit_own on public.lb_support_requests
  for insert to authenticated
  with check (submitted_by = auth.uid() and public.app_is_active());

drop policy if exists support_requests_read_own_or_admin on public.lb_support_requests;
create policy support_requests_read_own_or_admin on public.lb_support_requests
  for select to authenticated
  using (submitted_by = auth.uid() or public.app_is_admin());

drop policy if exists support_requests_admin_update on public.lb_support_requests;
create policy support_requests_admin_update on public.lb_support_requests
  for update to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());

-- Auth already enforces email uniqueness. Mirror it on lb_profiles so any
-- admin/import path cannot create conflicting profile records. Mobile numbers
-- intentionally remain non-unique: one real person can legitimately have a
-- resident account and an administrative or staff account using the same phone.
create unique index if not exists lb_profiles_email_ci_unique
  on public.lb_profiles (lower(email));

grant select, insert on public.lb_support_requests to authenticated;
