-- Public anonymous reporting and tracking hardening.
-- Keeps the user-facing tracking code usable while never storing it in plain text.

create extension if not exists pgcrypto;

alter table public.lb_service_requests
  add column if not exists tracking_code_hash text;

update public.lb_service_requests
set tracking_code_hash = encode(digest(upper(tracking_code), 'sha256'), 'hex'),
    tracking_code = null
where tracking_code is not null and tracking_code_hash is null;

create unique index if not exists lb_requests_tracking_hash_key
  on public.lb_service_requests (tracking_code_hash)
  where tracking_code_hash is not null;

create or replace function public.app_hash_tracking_code()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.tracking_code is not null and btrim(new.tracking_code) <> '' then
    new.tracking_code_hash := encode(digest(upper(btrim(new.tracking_code)), 'sha256'), 'hex');
    new.tracking_code := null;
  end if;
  return new;
end $$;

drop trigger if exists app_hash_tracking_code_before_write on public.lb_service_requests;
create trigger app_hash_tracking_code_before_write
  before insert or update of tracking_code on public.lb_service_requests
  for each row execute function public.app_hash_tracking_code();

-- The database receives trusted request headers from the Supabase gateway. The
-- value is hashed before persistence, avoiding storage of raw IP addresses.
create table if not exists public.lb_public_rate_limits (
  scope text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts > 0),
  updated_at timestamptz not null default now()
);
alter table public.lb_public_rate_limits enable row level security;
revoke all on public.lb_public_rate_limits from public, anon, authenticated;

create or replace function public.app_enforce_public_rate(p_action text, p_limit integer, p_window interval)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_client text := coalesce(nullif(split_part(v_headers ->> 'x-forwarded-for', ',', 1), ''), nullif(v_headers ->> 'cf-connecting-ip', ''), 'unknown');
  v_scope text := p_action || ':' || encode(digest(v_client, 'sha256'), 'hex');
  v_attempts integer;
begin
  insert into public.lb_public_rate_limits(scope, window_started_at, attempts, updated_at)
  values (v_scope, now(), 1, now())
  on conflict (scope) do update set
    attempts = case when public.lb_public_rate_limits.window_started_at < now() - p_window then 1 else public.lb_public_rate_limits.attempts + 1 end,
    window_started_at = case when public.lb_public_rate_limits.window_started_at < now() - p_window then now() else public.lb_public_rate_limits.window_started_at end,
    updated_at = now()
  returning attempts into v_attempts;
  if v_attempts > p_limit then
    raise exception 'Too many attempts. Please wait and try again later.';
  end if;
end $$;

create or replace function public.app_limit_anonymous_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_anonymous and auth.uid() is null then
    perform public.app_enforce_public_rate('anonymous-report', 5, interval '15 minutes');
  end if;
  return new;
end $$;

drop trigger if exists app_limit_anonymous_report_before_insert on public.lb_service_requests;
create trigger app_limit_anonymous_report_before_insert
  before insert on public.lb_service_requests
  for each row execute function public.app_limit_anonymous_report();

create or replace function public.app_track_request(p_reference text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_req public.lb_service_requests;
  v_updates jsonb;
begin
  perform public.app_enforce_public_rate('request-tracking', 12, interval '15 minutes');
  select * into v_req from public.lb_service_requests
  where upper(reference) = upper(trim(coalesce(p_reference, '')))
    and tracking_code_hash = encode(digest(upper(trim(coalesce(p_code, ''))), 'sha256'), 'hex');
  if not found then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', type, 'previous_status', previous_status, 'new_status', new_status,
    'remarks', remarks, 'actor', actor_name, 'at', created_at
  ) order by created_at), '[]'::jsonb) into v_updates
  from public.lb_request_updates where request_id = v_req.id;
  return jsonb_build_object('found', true, 'request', jsonb_build_object(
    'id', v_req.id, 'reference', v_req.reference, 'title', v_req.title,
    'description', v_req.description, 'location', v_req.location,
    'status', v_req.status, 'priority', v_req.priority, 'created_at', v_req.created_at,
    'updated_at', v_req.updated_at
  ), 'updates', v_updates);
end $$;

revoke all on function public.app_enforce_public_rate(text,integer,interval) from public, anon, authenticated;
revoke all on function public.app_hash_tracking_code() from public, anon, authenticated;
revoke all on function public.app_limit_anonymous_report() from public, anon, authenticated;
revoke all on function public.app_track_request(text,text) from public;
grant execute on function public.app_track_request(text,text) to anon, authenticated;
