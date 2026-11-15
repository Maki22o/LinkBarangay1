-- Dispatcher availability, appointment estimates, collision prevention and resident schedule access.
alter table public.lb_assignments add column if not exists appointment_status text not null default 'pending'
  check (appointment_status in ('pending','scheduled','rescheduled','completed','cancelled'));
alter table public.lb_assignments add column if not exists duration_minutes integer
  check (duration_minutes is null or duration_minutes between 15 and 480);
update public.lb_assignments set appointment_status=case when schedule_at is null then 'pending' else 'scheduled' end,
  duration_minutes=case when schedule_at is not null and deadline_at>schedule_at then ceil(extract(epoch from (deadline_at-schedule_at))/60.0)::integer else null end
where appointment_status='pending' and (schedule_at is not null or deadline_at is not null);

create table if not exists public.lb_dispatcher_availability (
  id uuid primary key default gen_random_uuid(),
  dispatcher_id uuid not null references public.lb_profiles(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lb_dispatcher_availability_time_check check (end_time > start_time),
  constraint lb_dispatcher_availability_slot_unique unique (dispatcher_id,day_of_week,start_time)
);
alter table public.lb_dispatcher_availability enable row level security;
grant select on public.lb_dispatcher_availability to authenticated;
drop policy if exists lb_dispatcher_availability_scope on public.lb_dispatcher_availability;
create policy lb_dispatcher_availability_scope on public.lb_dispatcher_availability for all to authenticated
  using (dispatcher_id=(select auth.uid()) and exists(select 1 from public.lb_profiles p where p.id=(select auth.uid()) and p.role='worker' and p.worker_function='dispatcher' and p.status='active') or public.app_is_admin())
  with check (dispatcher_id=(select auth.uid()) and exists(select 1 from public.lb_profiles p where p.id=(select auth.uid()) and p.role='worker' and p.worker_function='dispatcher' and p.status='active') or public.app_is_admin());

create or replace function public.app_save_dispatcher_availability(p_windows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_window jsonb; v_day integer; v_start time; v_end time;
begin
 if v_uid is null or not exists(select 1 from public.lb_profiles where id=v_uid and role='worker' and worker_function='dispatcher' and status='active') then
  raise exception 'Only active dispatchers can manage availability'; end if;
 if jsonb_typeof(p_windows)<>'array' or jsonb_array_length(p_windows)>7 then raise exception 'Provide at most one availability window per day'; end if;
 for v_window in select value from jsonb_array_elements(p_windows) loop
  v_day:=(v_window->>'day_of_week')::integer; v_start:=(v_window->>'start_time')::time; v_end:=(v_window->>'end_time')::time;
  if v_day not between 0 and 6 or v_start>=v_end then raise exception 'Availability hours are invalid'; end if;
  if exists(select 1 from jsonb_array_elements(p_windows) other where other.value->>'day_of_week'=v_window->>'day_of_week' and other.value is distinct from v_window) then
   raise exception 'Only one time window per weekday is supported'; end if;
 end loop;
 delete from public.lb_dispatcher_availability where dispatcher_id=v_uid;
 insert into public.lb_dispatcher_availability(dispatcher_id,day_of_week,start_time,end_time,is_available)
 select v_uid,(item.value->>'day_of_week')::smallint,(item.value->>'start_time')::time,(item.value->>'end_time')::time,true
 from jsonb_array_elements(p_windows) as item(value);
 return jsonb_build_object('saved',jsonb_array_length(p_windows));
end $$;
revoke all on function public.app_save_dispatcher_availability(jsonb) from public,anon;
grant execute on function public.app_save_dispatcher_availability(jsonb) to authenticated;

-- Residents can read schedule/status details for their own requests; other
-- assignment visibility continues to follow dispatcher, barangay, and assignee scopes.
drop policy if exists lb_assignments_select on public.lb_assignments;
create policy lb_assignments_select on public.lb_assignments for select to authenticated using (
  assigned_to=(select auth.uid()) or public.app_is_admin()
  or (public.app_current_role()='dispatcher' and public.app_current_status()='active' and department_id=public.app_current_department())
  or (public.app_current_role()='barangay_staff' and public.app_current_status()='active'
    and exists(select 1 from public.lb_service_requests r where r.id=request_id and r.barangay_id=public.app_current_barangay()))
  or exists(select 1 from public.lb_service_requests r where r.id=request_id and r.submitted_by=(select auth.uid())));

create or replace function public.app_assign_field(
 p_request_id uuid,p_field_user_id uuid,p_schedule_at timestamptz default null,p_deadline_at timestamptz default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; f public.lb_profiles; p public.lb_profiles; a public.lb_assignments; v_id uuid; v_duration integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into p from public.lb_profiles where id=auth.uid();
 if not found or p.status<>'active' or not (p.role='admin' or (p.role='worker' and p.worker_function='dispatcher')) then
  raise exception 'Only dispatchers and administrators can assign field personnel'; end if;
 select * into r from public.lb_service_requests where id=p_request_id for update;
 if not found then raise exception 'Request not found'; end if;
 if p.role<>'admin' and r.department_id is distinct from p.department_id then raise exception 'This request belongs to another department'; end if;
 if r.status not in ('verified','assigned') then raise exception 'The request must be verified before field assignment'; end if;
 select * into f from public.lb_profiles where id=p_field_user_id;
 if not found or f.role<>'worker' or f.worker_function<>'field' or f.status<>'active' then raise exception 'Selected user is not active field personnel'; end if;
 if (p.role<>'admin' and f.department_id is distinct from p.department_id) or (r.department_id is not null and f.department_id is distinct from r.department_id) then raise exception 'Field personnel belongs to another department'; end if;
 if (p_schedule_at is null) <> (p_deadline_at is null) then raise exception 'Provide both appointment start and estimated completion'; end if;
 if p_schedule_at is not null then
  v_duration:=ceil(extract(epoch from (p_deadline_at-p_schedule_at))/60.0)::integer;
  if p_schedule_at<=now() or v_duration not between 15 and 480 then raise exception 'Appointment must be in the future and last 15 minutes to 8 hours'; end if;
  if p.role='worker' and not exists(select 1 from public.lb_dispatcher_availability av
    where av.dispatcher_id=p.id and av.is_available
      and av.day_of_week=extract(dow from p_schedule_at at time zone 'Asia/Manila')
      and (p_schedule_at at time zone 'Asia/Manila')::time>=av.start_time
      and (p_deadline_at at time zone 'Asia/Manila')::time<=av.end_time) then
    raise exception 'The appointment is outside your saved availability'; end if;
  if exists(select 1 from public.lb_assignments x where x.assigned_to=f.id and x.request_id<>r.id
    and x.appointment_status in ('scheduled','rescheduled') and x.schedule_at<p_deadline_at and x.deadline_at>p_schedule_at) then
    raise exception 'This field worker already has an appointment during that time'; end if;
 end if;
 if r.assigned_to=f.id then
  select * into a from public.lb_assignments where request_id=r.id and assigned_to=f.id order by created_at desc,id desc limit 1 for update;
  if found and a.status in ('pending','accepted','in_progress') then
   if (a.schedule_at,a.deadline_at,a.notes) is distinct from (p_schedule_at,p_deadline_at,coalesce(p_notes,'')) then
    update public.lb_assignments set schedule_at=p_schedule_at,deadline_at=p_deadline_at,duration_minutes=v_duration,
      appointment_status=case when p_schedule_at is null then 'pending' else 'rescheduled' end,
      notes=coalesce(p_notes,''),updated_at=now() where id=a.id;
   end if;
   return jsonb_build_object('assignment_id',a.id);
  end if;
 end if;
 insert into public.lb_assignments(request_id,assigned_to,assigned_by,department_id,status,schedule_at,deadline_at,duration_minutes,appointment_status,notes,created_at)
 values(r.id,f.id,p.id,f.department_id,'pending',p_schedule_at,p_deadline_at,v_duration,
   case when p_schedule_at is null then 'pending' else 'scheduled' end,coalesce(p_notes,''),clock_timestamp()) returning id into v_id;
 update public.lb_service_requests set assigned_to=f.id,assigned_by=p.id,department_id=coalesce(department_id,f.department_id),updated_at=now() where id=r.id;
 insert into public.lb_request_updates(request_id,actor_id,actor_name,type,previous_status,new_status,remarks)
 values(r.id,p.id,coalesce(nullif(p.full_name,''),'Dispatcher'),'assignment',r.status,r.status,
   'Assigned to '||coalesce(nullif(f.full_name,''),'field personnel')||case when p_schedule_at is not null then ' · appointment '||to_char(p_schedule_at at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI')||' · estimated completion '||to_char(p_deadline_at at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI') else '' end);
 return jsonb_build_object('assignment_id',v_id);
end $$;
revoke all on function public.app_assign_field(uuid,uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.app_assign_field(uuid,uuid,timestamptz,timestamptz,text) to authenticated;

-- Keep appointment status in step with assignment state and notify the resident of scheduling changes.
create or replace function public.app_sync_assignment_appointment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='completed' then new.appointment_status:='completed';
 elsif new.status='declined' then new.appointment_status:='cancelled';
 elsif (new.schedule_at,new.deadline_at) is distinct from (old.schedule_at,old.deadline_at) then
  new.appointment_status:=case when new.schedule_at is null then 'pending' when old.schedule_at is null then 'scheduled' else 'rescheduled' end;
 end if;
 return new;
end $$;
drop trigger if exists app_sync_assignment_appointment_trg on public.lb_assignments;
create trigger app_sync_assignment_appointment_trg before update on public.lb_assignments for each row execute function public.app_sync_assignment_appointment();

create or replace function public.app_notify_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; v_key text:='assignment:'||gen_random_uuid(); v_title text; v_message text;
begin
 select * into r from public.lb_service_requests where id=new.request_id;
 if tg_op='INSERT' then v_title:=case when new.schedule_at is null then 'New Job Assigned' else 'Appointment Scheduled' end;
 elsif (new.assigned_to,new.schedule_at,new.deadline_at,new.appointment_status) is distinct from (old.assigned_to,old.schedule_at,old.deadline_at,old.appointment_status) then
  v_title:=case when new.appointment_status='rescheduled' then 'Appointment Rescheduled' when new.appointment_status='completed' then 'Appointment Completed' when new.appointment_status='cancelled' then 'Appointment Cancelled' else 'Job Schedule Updated' end;
 else return new; end if;
 v_message:=coalesce(r.reference,'Request')||': '||v_title||case when new.schedule_at is not null then ' for '||to_char(new.schedule_at at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI')||' (Philippine time), estimated completion '||to_char(new.deadline_at at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI')||' ('||new.duration_minutes||' minutes).' else '.' end;
 if r.submitted_by is not null and public.app_resident_is_verified(r.submitted_by) then
  perform public.app_emit_notification(r.submitted_by,v_key,'appointment.'||new.appointment_status,v_title,v_message,r.id,'request-detail',r.id);
 end if;
 if new.assigned_to is not null then perform public.app_emit_notification(new.assigned_to,v_key,'assignment.updated',v_title,v_message,null,'job-detail',new.id); end if;
 if tg_op='UPDATE' and old.assigned_to is distinct from new.assigned_to and old.assigned_to is not null then
  perform public.app_emit_notification(old.assigned_to,v_key,'assignment.reassigned','Job Reassigned',coalesce(r.reference,'Request')||': This job has been reassigned.',null,'jobs',null);
 end if;
 return new;
end $$;
revoke all on function public.app_notify_assignment() from public,anon,authenticated;
drop trigger if exists app_notify_assignment_trg on public.lb_assignments;
create trigger app_notify_assignment_trg after insert or update on public.lb_assignments for each row execute function public.app_notify_assignment();

notify pgrst,'reload schema';
