-- Dispatchers and field personnel are scoped to BOTH their department and
-- barangay. This prevents one department's staff from viewing or assigning
-- work that belongs to another barangay.
begin;

alter table public.lb_profiles drop constraint if exists lb_profiles_worker_scope_check;
alter table public.lb_profiles add constraint lb_profiles_worker_scope_check
  check (role <> 'worker'
    or (worker_function = 'barangay_staff' and barangay_id is not null)
    or (worker_function in ('dispatcher','field') and barangay_id is not null and department_id is not null)
  ) not valid;

create or replace function public.app_dispatch_access(p_department uuid, p_barangay uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.app_is_admin() or (
    public.app_current_role()='dispatcher' and public.app_current_status()='active'
    and p_department=public.app_current_department()
    and p_barangay=public.app_current_barangay()
  ),false)
$$;
revoke all on function public.app_dispatch_access(uuid,uuid) from public, anon;
grant execute on function public.app_dispatch_access(uuid,uuid) to authenticated;

create or replace function public.app_can_access_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select r.submitted_by=auth.uid() or public.app_is_admin() or
    (public.app_is_active_staff() and (
      (public.app_current_role()='barangay_staff' and r.barangay_id=public.app_current_barangay())
      or (public.app_current_role()='dispatcher' and r.department_id=public.app_current_department()
          and r.barangay_id=public.app_current_barangay())
      or (public.app_current_role()='field' and r.assigned_to=auth.uid()
          and r.barangay_id=public.app_current_barangay())
    )) from public.lb_service_requests r where r.id=p_request_id),false)
$$;

drop policy if exists lb_profiles_select on public.lb_profiles;
create policy lb_profiles_select on public.lb_profiles for select to authenticated using (
  id=(select auth.uid()) or public.app_is_admin() or (public.app_is_active_staff() and (
    (public.app_current_role()='barangay_staff' and barangay_id=public.app_current_barangay())
    or (public.app_current_role() in ('dispatcher','field') and department_id=public.app_current_department()
        and barangay_id=public.app_current_barangay())
  ))
);

drop policy if exists lb_assignments_select on public.lb_assignments;
create policy lb_assignments_select on public.lb_assignments for select to authenticated using (
  public.app_is_admin()
  or (public.app_current_status()='active' and exists (
    select 1 from public.lb_service_requests r where r.id=request_id and (
      (public.app_current_role()='dispatcher' and r.department_id=public.app_current_department()
        and r.barangay_id=public.app_current_barangay())
      or (public.app_current_role()='field' and assigned_to=(select auth.uid())
        and r.barangay_id=public.app_current_barangay())
      or (public.app_current_role()='barangay_staff' and r.barangay_id=public.app_current_barangay())
    )
  ))
);

drop policy if exists lb_appointments_select on public.lb_appointments;
create policy lb_appointments_select on public.lb_appointments for select to authenticated using (
  public.app_is_admin()
  or (not is_field_booking and (resident_id=(select auth.uid()) or
    (public.app_current_role()='barangay_staff' and public.app_current_status()='active' and barangay_id=public.app_current_barangay())))
  or (is_field_booking and public.app_current_status()='active' and (
    (public.app_current_role()='dispatcher' and department_id=public.app_current_department() and barangay_id=public.app_current_barangay())
    or (public.app_current_role()='field' and field_assignee_id=(select auth.uid()) and barangay_id=public.app_current_barangay())
  ))
);

-- Patch all audited dispatcher workflow RPCs that load a request as `r`.
-- Their pre-existing department check becomes department + barangay scope.
do $scope$
declare fn record; definition text;
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and pg_get_functiondef(p.oid) like '%public.app_dispatch_access(r.department_id)%'
  loop
    definition:=replace(pg_get_functiondef(fn.oid),
      'public.app_dispatch_access(r.department_id)',
      'public.app_dispatch_access(r.department_id, r.barangay_id)');
    execute definition;
  end loop;
end $scope$;

-- An assignee must belong to the same barangay as the request as well.
do $scope$
declare definition text;
begin
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='app_save_field_assignment' limit 1;
  if definition is not null then
    definition:=replace(definition, 'r.department_id<>f.department_id',
      'r.department_id<>f.department_id or r.barangay_id is distinct from f.barangay_id');
    execute definition;
  end if;
end $scope$;

create or replace view public.lb_dispatch_queue with (security_invoker=true) as
select r.id,r.reference,r.title,r.status,r.priority,r.dispatch_priority_order,r.description,r.location,
  r.created_at,r.department_id,r.category_id,c.name as category_name,
  coalesce(nullif(resident.full_name,''),r.submitter_name) as resident_name,
  worker.full_name as personnel_name,b.preferred_at,b.status as appointment_status,
  case when b.status='pending' then null else coalesce(b.scheduled_at,legacy.schedule_at) end as scheduled_at,
  case when r.estimate_recorded_at is not null then r.estimated_completion_at else legacy.deadline_at end as estimated_completion_at,
  r.barangay_id
from public.lb_service_requests r
left join public.lb_service_categories c on c.id=r.category_id
left join public.lb_profiles resident on resident.id=r.submitted_by
left join public.lb_profiles worker on worker.id=r.assigned_to
left join public.lb_appointments b on b.request_id=r.id and b.is_field_booking
left join lateral (select a.schedule_at,a.deadline_at from public.lb_assignments a
  where a.request_id=r.id and a.assigned_to=r.assigned_to order by a.created_at desc,a.id desc limit 1) legacy on true
where public.app_dispatch_access(r.department_id,r.barangay_id)
  and (r.status in ('verified','assigned','in_progress','for_inspection') or b.status='pending');

notify pgrst,'reload schema';
commit;
