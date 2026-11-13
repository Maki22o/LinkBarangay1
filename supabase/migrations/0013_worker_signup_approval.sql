-- LinkBarangay migration 0013 — worker sign-up with admin approval.
-- A person who signs up as a worker gets a RESIDENT profile with status
-- 'pending'. They cannot sign in or read data until an administrator approves
-- the account (sets role/function/scope and status='active') in User Management.
-- The role is still never taken from client input: the metadata flag can only
-- produce a pending resident, never an active worker.

alter table public.lb_profiles drop constraint if exists lb_profiles_status_check;
alter table public.lb_profiles add constraint lb_profiles_status_check
  check (status in ('active','suspended','inactive','pending'));

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
    case when new.raw_user_meta_data->>'requested_role' = 'worker' then 'pending' else 'active' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
