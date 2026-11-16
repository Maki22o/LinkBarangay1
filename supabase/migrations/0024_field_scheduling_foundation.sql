begin;

alter table public.lb_service_categories
  add column field_appointment_minutes integer
    check (field_appointment_minutes between 15 and 480),
  add constraint lb_service_categories_field_department_check
    check (field_appointment_minutes is null or department_id is not null);

alter table public.lb_service_requests
  add column estimated_completion_at timestamptz,
  add column estimated_duration_minutes integer check (estimated_duration_minutes > 0),
  add column estimate_recorded_at timestamptz,
  add column priority_changed_at timestamptz;

alter table public.lb_appointments
  add column is_field_booking boolean not null default false,
  add column department_id uuid references public.lb_departments(id),
  add column preferred_at timestamptz,
  add column proposed_at timestamptz,
  add column end_at timestamptz,
  add column field_assignee_id uuid references public.lb_profiles(id) on delete set null,
  add column dispatcher_id uuid references public.lb_profiles(id) on delete set null,
  add column assignment_id uuid references public.lb_assignments(id) on delete set null,
  add column change_reason text not null default '',
  add column updated_at timestamptz not null default now();
alter table public.lb_appointments drop constraint lb_appointments_status_check;
alter table public.lb_appointments add constraint lb_appointments_status_check check (
  (not is_field_booking and status in ('scheduled','completed','cancelled','no_show'))
  or (is_field_booking and status in ('pending','confirmed','rescheduled','in_progress','completed','cancelled'))
);
alter table public.lb_appointments add constraint lb_appointments_end_check
  check (end_at is null or end_at > scheduled_at);
create unique index lb_field_appointment_request_unique on public.lb_appointments(request_id)
  where is_field_booking;
create index lb_field_appointments_department_date on public.lb_appointments(department_id, scheduled_at)
  where is_field_booking;
create index lb_field_appointments_assignment_idx on public.lb_appointments(assignment_id)
  where is_field_booking;
create index lb_assignments_bookable_idx on public.lb_assignments(assigned_to, schedule_at, deadline_at)
  where status in ('pending','accepted','in_progress') and appointment_status in ('scheduled','rescheduled');
create index lb_requests_dispatch_estimate_idx on public.lb_service_requests(estimated_completion_at)
  where estimated_completion_at is not null and status in ('verified','assigned','in_progress');
create index lb_requests_urgent_dispatch_idx on public.lb_service_requests(department_id, priority_changed_at, created_at)
  where priority='urgent' and assigned_to is null;
alter table public.lb_assignments drop constraint lb_assignments_status_check;
alter table public.lb_assignments add constraint lb_assignments_status_check check (status in
  ('pending','accepted','declined','in_progress','completed','verified','cancelled','unable_to_complete','needs_rescheduling'));
alter table public.lb_assignments
  add column progress_notes text not null default '',
  add column delay_reason text not null default '',
  add column completion_remarks text not null default '';

create table public.lb_field_working_hours (
  personnel_id uuid not null references public.lb_profiles(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  primary key (personnel_id, day_of_week)
);
create table public.lb_field_unavailability (
  id uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references public.lb_profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  created_at timestamptz not null default now()
);
create index lb_field_unavailability_range_idx on public.lb_field_unavailability(personnel_id, starts_at, ends_at);
alter table public.lb_field_working_hours enable row level security;
alter table public.lb_field_unavailability enable row level security;
revoke all on public.lb_field_working_hours, public.lb_field_unavailability from public, anon, authenticated;
grant select on public.lb_field_working_hours, public.lb_field_unavailability to authenticated;

create function public.app_dispatch_access(p_department uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.app_is_admin() or (
    public.app_current_role()='dispatcher' and public.app_current_status()='active'
    and p_department=public.app_current_department()
  ),false)
$$;
revoke all on function public.app_dispatch_access(uuid) from public, anon;
grant execute on function public.app_dispatch_access(uuid) to authenticated;

create policy lb_field_hours_owner on public.lb_field_working_hours for select to authenticated using (
  personnel_id=(select auth.uid()) and public.app_current_role()='field' and public.app_current_status()='active'
);
create policy lb_field_unavailability_owner on public.lb_field_unavailability for select to authenticated using (
  personnel_id=(select auth.uid()) and public.app_current_role()='field' and public.app_current_status()='active'
);

-- The desk appointment screen continues to manage its own records. Field bookings
-- use the scheduling RPCs. Residents get a projection via app_request_schedule.
drop policy lb_appointments_select on public.lb_appointments;
create policy lb_appointments_select on public.lb_appointments for select to authenticated using (
  public.app_is_admin()
  or (not is_field_booking and (
    resident_id=(select auth.uid())
    or (public.app_current_role()='barangay_staff' and public.app_current_status()='active'
      and barangay_id=public.app_current_barangay())
  ))
  or (is_field_booking and (public.app_dispatch_access(department_id)
    or (public.app_current_role()='field' and public.app_current_status()='active'
      and field_assignee_id=(select auth.uid()) and department_id=public.app_current_department())))
);
drop policy lb_appointments_write on public.lb_appointments;
create policy lb_appointments_write on public.lb_appointments for all to authenticated
  using (not is_field_booking and (public.app_is_admin() or (
    public.app_current_role()='barangay_staff' and public.app_current_status()='active' and barangay_id=public.app_current_barangay()
  )))
  with check (not is_field_booking and assignment_id is null and field_assignee_id is null and (
    public.app_is_admin() or (
      public.app_current_role()='barangay_staff' and public.app_current_status()='active' and barangay_id=public.app_current_barangay()
    )
  ));

-- Assignment instructions and notes are staff data, including over the REST API.
drop policy lb_assignments_select on public.lb_assignments;
create policy lb_assignments_select on public.lb_assignments for select to authenticated using (
  public.app_dispatch_access(department_id)
  or (public.app_current_status()='active' and (
    (public.app_current_role()='field' and assigned_to=(select auth.uid()) and department_id=public.app_current_department())
    or (public.app_current_role()='barangay_staff' and exists (
      select 1 from public.lb_service_requests r where r.id=request_id and r.barangay_id=public.app_current_barangay()
    ))
  ))
);

-- Walk-in inserts still use the table API. Workflow changes use the existing
-- SECURITY DEFINER RPCs so clients cannot bypass timing and permission checks.
create function public.app_guard_scheduling_fields()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_user not in ('anon','authenticated') then return new; end if;
  if tg_op='INSERT' then
    if new.priority <> 'normal' or new.status <> 'submitted' or new.assigned_to is not null
      or new.assigned_by is not null or new.estimated_completion_at is not null
      or new.estimated_duration_minutes is not null or new.estimate_recorded_at is not null or new.priority_changed_at is not null then
      raise exception 'Restricted request fields must be changed through the workflow';
    end if;
  elsif (new.priority,new.status,new.assigned_to,new.assigned_by,new.department_id,new.barangay_id,
      new.submitted_by,new.category_id,new.estimated_completion_at,new.estimated_duration_minutes,new.estimate_recorded_at,new.priority_changed_at)
    is distinct from (old.priority,old.status,old.assigned_to,old.assigned_by,old.department_id,old.barangay_id,
      old.submitted_by,old.category_id,old.estimated_completion_at,old.estimated_duration_minutes,old.estimate_recorded_at,old.priority_changed_at) then
    raise exception 'Restricted request fields must be changed through the workflow';
  end if;
  return new;
end $$;
revoke all on function public.app_guard_scheduling_fields() from public, anon, authenticated;
create trigger app_guard_scheduling_fields_trg before insert or update on public.lb_service_requests
  for each row execute function public.app_guard_scheduling_fields();

create function public.app_stamp_priority_change()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.priority is distinct from old.priority then new.priority_changed_at:=clock_timestamp(); end if;
  return new;
end $$;
revoke all on function public.app_stamp_priority_change() from public, anon, authenticated;
create trigger app_stamp_priority_change_trg before update of priority on public.lb_service_requests
  for each row execute function public.app_stamp_priority_change();

-- A transaction lock per worker serializes assignment, schedule edits and
-- leave. Different workers can still be scheduled concurrently.
create function public.app_lock_field_schedule(p_worker uuid)
returns void language sql set search_path=public as $$
  select pg_advisory_xact_lock(hashtextextended('lb-field-schedule:'||p_worker::text,0))
$$;
revoke all on function public.app_lock_field_schedule(uuid) from public, anon, authenticated;

create function public.app_field_on_duty(p_worker uuid,p_start timestamptz,p_end timestamptz)
returns boolean language sql stable set search_path=public as $$
  select p_end>p_start and exists (
    select 1 from public.lb_field_working_hours h
    cross join lateral (select (p_start at time zone 'Asia/Manila')::date as day) d
    where h.personnel_id=p_worker and h.day_of_week=extract(dow from d.day)
      and (d.day+h.start_time) at time zone 'Asia/Manila' <= p_start
      and (d.day+h.end_time) at time zone 'Asia/Manila' >= p_end
  )
$$;
revoke all on function public.app_field_on_duty(uuid,timestamptz,timestamptz) from public, anon, authenticated;

create function public.app_field_has_booking(p_worker uuid,p_start timestamptz,p_end timestamptz,p_skip_request uuid)
returns boolean language sql stable set search_path=public as $$
  select exists (
    select 1 from public.lb_assignments a
    join public.lb_service_requests r on r.id=a.request_id and r.assigned_to=a.assigned_to
      and r.department_id=a.department_id and r.status in ('verified','assigned','in_progress')
    where a.assigned_to=p_worker and a.request_id is distinct from p_skip_request
      and a.status in ('pending','accepted','in_progress') and a.appointment_status in ('scheduled','rescheduled')
      and a.schedule_at<p_end and a.deadline_at>p_start
      and a.id=(select last_job.id from public.lb_assignments last_job
        where last_job.request_id=r.id and last_job.assigned_to=p_worker
        order by last_job.created_at desc,last_job.id desc limit 1)
  )
$$;
revoke all on function public.app_field_has_booking(uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated;

create function public.app_field_is_free(p_worker uuid,p_start timestamptz,p_end timestamptz,p_skip_request uuid)
returns boolean language sql stable set search_path=public as $$
  select public.app_field_on_duty(p_worker,p_start,p_end)
    and not exists (select 1 from public.lb_field_unavailability b where b.personnel_id=p_worker
      and b.starts_at<p_end and b.ends_at>p_start)
    and not public.app_field_has_booking(p_worker,p_start,p_end,p_skip_request)
$$;
revoke all on function public.app_field_is_free(uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated;

create function public.app_dispatcher_in_booking_hours(p_user uuid,p_start timestamptz,p_end timestamptz)
returns boolean language sql stable set search_path=public as $$
  select not exists(select 1 from public.lb_dispatcher_availability where dispatcher_id=p_user)
    or exists (select 1 from public.lb_dispatcher_availability h
      cross join lateral (select (p_start at time zone 'Asia/Manila')::date as day) d
      where h.dispatcher_id=p_user and h.is_available and h.day_of_week=extract(dow from d.day)
        and (d.day+h.start_time) at time zone 'Asia/Manila' <= p_start
        and (d.day+h.end_time) at time zone 'Asia/Manila' >= p_end)
$$;
revoke all on function public.app_dispatcher_in_booking_hours(uuid,timestamptz,timestamptz) from public, anon, authenticated;

create function public.app_active_field_user()
returns uuid language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or public.app_current_role() is distinct from 'field'
    or public.app_current_status() is distinct from 'active' then
    raise exception 'An active field account is required';
  end if;
  return auth.uid();
end $$;
revoke all on function public.app_active_field_user() from public, anon, authenticated;

create function public.app_save_field_hours(p_hours jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare worker uuid:=public.app_active_field_user();
begin
  if jsonb_typeof(p_hours) is distinct from 'array' then raise exception 'Provide a list of working days'; end if;
  if jsonb_array_length(p_hours)>7 then raise exception 'Provide at most one window for each weekday'; end if;
  perform public.app_lock_field_schedule(worker);
  delete from public.lb_field_working_hours where personnel_id=worker;
  insert into public.lb_field_working_hours(personnel_id,day_of_week,start_time,end_time)
  select worker,h.day_of_week,h.start_time,h.end_time
  from jsonb_to_recordset(p_hours) h(day_of_week smallint,start_time time,end_time time);
  if exists (
    select 1 from public.lb_assignments a where a.assigned_to=worker and a.deadline_at>now()
      and a.status in ('pending','accepted','in_progress') and a.appointment_status in ('scheduled','rescheduled')
      and public.app_field_has_booking(worker,a.schedule_at,a.deadline_at,null)
      and not public.app_field_on_duty(worker,a.schedule_at,a.deadline_at)
  ) then raise exception 'These hours conflict with a booked job. Ask dispatch to reschedule it first.'; end if;
end $$;
revoke all on function public.app_save_field_hours(jsonb) from public, anon;
grant execute on function public.app_save_field_hours(jsonb) to authenticated;

create function public.app_set_field_block(p_start timestamptz,p_end timestamptz,p_remove_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare worker uuid:=public.app_active_field_user();
begin
  perform public.app_lock_field_schedule(worker);
  if p_remove_id is not null then
    delete from public.lb_field_unavailability where id=p_remove_id and personnel_id=worker;
    return;
  end if;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=greatest(p_start,now()) then raise exception 'Enter a valid unavailability period ending in the future'; end if;
  if public.app_field_has_booking(worker,p_start,p_end,null) then
    raise exception 'This period overlaps a booked job. Ask dispatch to reschedule it first.';
  end if;
  if not exists (select 1 from public.lb_field_unavailability where personnel_id=worker and starts_at=p_start and ends_at=p_end) then
    insert into public.lb_field_unavailability(personnel_id,starts_at,ends_at) values(worker,p_start,p_end);
  end if;
end $$;
revoke all on function public.app_set_field_block(timestamptz,timestamptz,uuid) from public, anon;
grant execute on function public.app_set_field_block(timestamptz,timestamptz,uuid) to authenticated;

commit;
