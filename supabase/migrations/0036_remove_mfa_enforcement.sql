-- MFA is no longer part of the LinkBarangay application access flow.
-- Keep the identity-document and administrator approval controls intact.

begin;

create or replace function public.app_current_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(worker_function, role) from public.lb_profiles where id = auth.uid()
$$;

create or replace function public.app_is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lb_profiles where id = auth.uid() and status = 'active'
  )
$$;

create or replace function public.app_is_active_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lb_profiles
    where id = auth.uid() and status = 'active' and role in ('worker', 'admin')
  )
$$;

create or replace function public.app_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lb_profiles
    where id = auth.uid() and status = 'active' and role = 'admin'
  )
$$;

create or replace function public.app_dispatch_access(p_department uuid, p_barangay uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.app_is_admin() or (
    public.app_current_role()='dispatcher' and public.app_current_status()='active'
    and p_department=public.app_current_department()
    and p_barangay=public.app_current_barangay()
  ),false)
$$;

-- Preserve the server-side rule that a public staff applicant cannot be made
-- active until an administrator has approved their ID/address document.
create or replace function public.app_guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller_role text;
  caller_status text;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then return new; end if;
  select role, status into caller_role, caller_status from public.lb_profiles where id = v_caller;
  if caller_role is null then raise exception 'Caller has no profile; profile updates denied'; end if;
  if v_caller = new.id then
    if new.role is distinct from old.role or new.worker_function is distinct from old.worker_function
      or new.status is distinct from old.status or new.barangay_id is distinct from old.barangay_id
      or new.department_id is distinct from old.department_id then
      raise exception 'Users cannot change their own role, worker function, status, barangay, or department';
    end if;
    return new;
  end if;
  if caller_role <> 'admin' or caller_status <> 'active' then
    raise exception 'Only active administrators may modify other accounts';
  end if;
  if new.role = 'admin' and old.role <> 'admin' then
    raise exception 'Admin accounts may only be provisioned through trusted setup';
  end if;
  if new.role = 'worker' and new.status = 'active'
     and not (old.role = 'worker' and old.status = 'active')
     and not exists (
       select 1 from public.lb_resident_verifications v
       where v.user_id = new.id and v.status = 'approved' and v.storage_path is not null
     ) then
    raise exception 'Approve the applicant’s identity and residential-address document before activating staff access';
  end if;
  new.updated_at := now();
  return new;
end $$;

notify pgrst, 'reload schema';
commit;
