create table if not exists public.lb_google_drive_backup_oauth (
  id boolean primary key default true check (id),
  refresh_token text not null,
  drive_folder_id text,
  connected_at timestamptz not null default now(),
  connected_by uuid references auth.users(id) on delete set null
);
create table if not exists public.lb_google_drive_oauth_states (
  state uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.lb_google_drive_backup_oauth enable row level security;
alter table public.lb_google_drive_oauth_states enable row level security;
revoke all on public.lb_google_drive_backup_oauth, public.lb_google_drive_oauth_states from anon, authenticated;
