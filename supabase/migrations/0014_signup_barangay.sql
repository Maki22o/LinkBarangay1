-- LinkBarangay migration 0014 — save the barangay chosen at sign-up.
-- The sign-up form already asks for a barangay, but it was never stored.
-- The trigger now saves it only if it matches a real barangay.

create or replace function public.app_handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_barangay uuid;
begin
  select b.id into v_barangay
  from public.lb_barangays b
  where b.id::text = new.raw_user_meta_data->>'barangay_id';

  insert into public.lb_profiles (id, full_name, email, mobile, address, barangay_id, role, status)
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
    v_barangay,
    'resident',
    case when new.raw_user_meta_data->>'requested_role' = 'worker' then 'pending' else 'active' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
