-- Phase 1 security hardening.
-- 1) Privileged (worker/admin) data access requires an AAL2 MFA session.
-- 2) Public tracking remains available only for new, non-enumerable references.
-- Existing short references remain visible to their signed-in owners, but are
-- deliberately not available through the public endpoint.

begin;

create or replace function public.app_mfa_verified()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
$$;

create or replace function public.app_current_role()
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when role = 'resident' or public.app_mfa_verified() then role
    else null
  end
  from public.lb_profiles where id = auth.uid()
$$;

create or replace function public.app_is_active()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.lb_profiles
    where id = auth.uid() and status = 'active'
      and (role = 'resident' or public.app_mfa_verified())
  )
$$;

create or replace function public.app_is_active_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.lb_profiles
    where id = auth.uid() and status = 'active' and role in ('worker', 'admin')
  ) and public.app_mfa_verified()
$$;

create or replace function public.app_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.lb_profiles
    where id = auth.uid() and status = 'active' and role = 'admin'
  ) and public.app_mfa_verified()
$$;

revoke all on function public.app_mfa_verified() from public, anon;
grant execute on function public.app_mfa_verified() to authenticated;

-- Preserve the dual department + barangay dispatcher check while also requiring MFA.
create or replace function public.app_dispatch_access(p_department uuid, p_barangay uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.app_is_admin() or (
    public.app_is_active_staff()
    and public.app_current_role()='dispatcher'
    and p_department=public.app_current_department()
    and p_barangay=public.app_current_barangay()
  ), false)
$$;

-- Do not change historical references: they may be printed on past receipts.
-- New references have 128 bits of randomness and are safe to use publicly.
create or replace function public.app_assign_secure_public_reference()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.reference is null or new.reference !~ '^LB-[A-F0-9]{32}$' then
    new.reference := 'LB-' || upper(encode(gen_random_bytes(16), 'hex'));
  end if;
  return new;
end;
$$;

drop trigger if exists app_assign_secure_public_reference_before_insert on public.lb_service_requests;
create trigger app_assign_secure_public_reference_before_insert
  before insert on public.lb_service_requests
  for each row execute function public.app_assign_secure_public_reference();

create or replace function public.app_track_request(p_reference text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_request public.lb_service_requests;
  v_updates jsonb;
  v_reference text := upper(trim(coalesce(p_reference, '')));
begin
  perform public.app_enforce_public_rate('request-tracking', 12, interval '15 minutes');
  if v_reference !~ '^LB-[A-F0-9]{32}$' then
    return jsonb_build_object('found', false);
  end if;

  select * into v_request from public.lb_service_requests
  where reference = v_reference and is_anonymous = false;
  if not found then return jsonb_build_object('found', false); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'type', type, 'previous_status', previous_status,
    'new_status', new_status, 'at', created_at
  ) order by created_at), '[]'::jsonb)
  into v_updates from public.lb_request_updates where request_id = v_request.id;

  return jsonb_build_object(
    'found', true,
    'request', jsonb_build_object(
      'reference', v_request.reference, 'status', v_request.status,
      'created_at', v_request.created_at, 'updated_at', v_request.updated_at
    ),
    'updates', v_updates
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
