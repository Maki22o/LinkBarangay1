-- Admin module integrity: profile scope relations, safe role assignment, realtime.

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.lb_profiles'::regclass and conname = 'lb_profiles_barangay_id_fkey') then
    alter table public.lb_profiles add constraint lb_profiles_barangay_id_fkey
      foreign key (barangay_id) references public.lb_barangays(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lb_profiles'::regclass and conname = 'lb_profiles_department_id_fkey') then
    alter table public.lb_profiles add constraint lb_profiles_department_id_fkey
      foreign key (department_id) references public.lb_departments(id) on delete set null;
  end if;
end $$;

-- An authenticated admin can edit resident/worker accounts, but admin access
-- can only be provisioned through trusted database setup, never client CRUD.
create or replace function public.app_guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  caller_role text;
  caller_status text;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then return new; end if;
  select role, status into caller_role, caller_status
    from public.lb_profiles where id = v_caller;
  if caller_role is null then raise exception 'Caller has no profile; profile updates denied'; end if;

  if v_caller = new.id then
    if new.role is distinct from old.role
      or new.worker_function is distinct from old.worker_function
      or new.status is distinct from old.status
      or new.barangay_id is distinct from old.barangay_id
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
  new.updated_at := now();
  return new;
end $$;

-- User management listens to profile changes; the existing SELECT RLS policies
-- still control which rows each connected user can receive.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lb_profiles'
    ) then
    alter publication supabase_realtime add table public.lb_profiles;
  end if;
end $$;

notify pgrst, 'reload schema';
