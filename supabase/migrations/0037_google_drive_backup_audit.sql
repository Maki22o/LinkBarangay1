-- Records each off-site Google Drive backup attempt.  No Google credential is
-- stored in Postgres; credentials remain Edge Function secrets only.
create table if not exists public.lb_backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','failed')),
  trigger_source text not null default 'manual' check (trigger_source in ('manual','scheduled')),
  drive_folder_id text,
  database_rows integer not null default 0,
  storage_files integer not null default 0,
  error_message text,
  created_by uuid references auth.users(id) on delete set null
);

alter table public.lb_backup_runs enable row level security;

drop policy if exists lb_backup_runs_admin_read on public.lb_backup_runs;
create policy lb_backup_runs_admin_read on public.lb_backup_runs
  for select to authenticated using (public.app_is_admin());
