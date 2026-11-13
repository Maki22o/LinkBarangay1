-- Worker profiles must have the scope required by their assigned function.
-- NOT VALID preserves existing legacy profiles until an admin repairs them,
-- while still enforcing the invariant on inserts and subsequent updates.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lb_profiles'::regclass
      and conname = 'lb_profiles_worker_scope_check'
  ) then
    alter table public.lb_profiles
      add constraint lb_profiles_worker_scope_check
      check (
        role <> 'worker'
        or (worker_function in ('secretary','officer','captain') and barangay_id is not null)
        or (worker_function in ('dispatcher','field') and department_id is not null)
      ) not valid;
  end if;
end $$;
