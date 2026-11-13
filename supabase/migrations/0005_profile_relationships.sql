-- LinkBarangay migration 0005 — expose direct profile relationships to
-- PostgREST for the profile embeds used by request, assignment, and
-- appointment queries. The existing auth.users foreign keys remain intact.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lb_service_requests_submitted_by_profile_fkey'
      and conrelid = 'public.lb_service_requests'::regclass
  ) then
    alter table public.lb_service_requests
      add constraint lb_service_requests_submitted_by_profile_fkey
      foreign key (submitted_by) references public.lb_profiles(id)
      on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lb_service_requests_assigned_to_profile_fkey'
      and conrelid = 'public.lb_service_requests'::regclass
  ) then
    alter table public.lb_service_requests
      add constraint lb_service_requests_assigned_to_profile_fkey
      foreign key (assigned_to) references public.lb_profiles(id)
      on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lb_assignments_assigned_to_profile_fkey'
      and conrelid = 'public.lb_assignments'::regclass
  ) then
    alter table public.lb_assignments
      add constraint lb_assignments_assigned_to_profile_fkey
      foreign key (assigned_to) references public.lb_profiles(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lb_appointments_resident_id_profile_fkey'
      and conrelid = 'public.lb_appointments'::regclass
  ) then
    alter table public.lb_appointments
      add constraint lb_appointments_resident_id_profile_fkey
      foreign key (resident_id) references public.lb_profiles(id)
      on delete set null not valid;
  end if;
end $$;

-- Tell PostgREST to refresh its relationship cache after applying the FKs.
notify pgrst, 'reload schema';
