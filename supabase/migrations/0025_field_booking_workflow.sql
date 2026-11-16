begin;

create function public.app_field_booking_event(p_request uuid,p_event text,p_public_note text,p_details jsonb)
returns uuid language plpgsql set search_path=public as $$
declare event_id uuid:=gen_random_uuid();
begin
  insert into public.lb_audit_logs(id,actor_id,actor_name,action,entity_type,entity_id,details)
  values(event_id,auth.uid(),coalesce((select nullif(full_name,'') from public.lb_profiles where id=auth.uid()),'System'),
    p_event,'lb_service_requests',p_request::text,p_details);
  if p_public_note is not null then
    insert into public.lb_request_updates(request_id,actor_id,actor_name,type,remarks)
    values(p_request,auth.uid(),'Scheduling','field_schedule',p_public_note);
  end if;
  return event_id;
end $$;
revoke all on function public.app_field_booking_event(uuid,text,text,jsonb) from public, anon, authenticated;

-- Scheduling timeline events have their own targeted notifications.
drop trigger app_notify_on_update_trg on public.lb_request_updates;
create trigger app_notify_on_update_trg after insert on public.lb_request_updates
  for each row when (new.type <> 'field_schedule') execute function public.app_notify_on_update();

create function public.app_notify_department(
  p_department uuid,p_key text,p_type text,p_title text,p_message text,p_request uuid
) returns void language plpgsql set search_path=public as $$
declare recipient uuid;
begin
  for recipient in select id from public.lb_profiles where role='worker' and worker_function='dispatcher'
    and status='active' and department_id=p_department and id is distinct from auth.uid()
  loop
    perform public.app_emit_notification(recipient,p_key,p_type,p_title,p_message,p_request,'request-detail',p_request);
  end loop;
end $$;
revoke all on function public.app_notify_department(uuid,text,text,text,text,uuid) from public, anon, authenticated;

create function public.app_priority_order(p_priority text)
returns integer language sql immutable set search_path=public as $$
  select case p_priority when 'urgent' then 3 when 'high' then 2 when 'low' then 0 else 1 end
$$;
alter table public.lb_service_requests
  add column dispatch_priority_order integer generated always as (public.app_priority_order(priority)) stored;
create index lb_dispatch_priority_queue_idx on public.lb_service_requests(department_id,dispatch_priority_order desc,created_at desc);

create function public.app_change_request_priority(p_request_id uuid,p_priority text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; reason text:=nullif(btrim(p_reason),''); event_id uuid;
  increased boolean; new_priority text:=case when p_priority='medium' then 'normal' else p_priority end;
begin
  if new_priority is null or new_priority not in ('low','normal','high','urgent') then
    raise exception 'Choose Low, Normal, High, or Urgent';
  end if;
  select * into r from public.lb_service_requests where id=p_request_id for update;
  if not found or not coalesce(public.app_dispatch_access(r.department_id) or (
    public.app_current_role()='barangay_staff' and public.app_current_status()='active'
    and r.barangay_id=public.app_current_barangay()
  ),false) then raise exception 'You cannot set priority for this request'; end if;
  if r.priority=new_priority then return jsonb_build_object('request',to_jsonb(r)); end if;
  if r.status in ('resolved','closed','rejected') then raise exception 'This request is no longer active'; end if;
  increased:=public.app_priority_order(new_priority)>public.app_priority_order(r.priority);
  if increased and reason is null then raise exception 'Enter a reason for increasing priority'; end if;
  event_id:=public.app_field_booking_event(r.id,'request.priority_changed',null,
    jsonb_build_object('previous',r.priority,'new',new_priority,'reason',reason));
  update public.lb_service_requests set priority=new_priority,priority_changed_at=clock_timestamp(),updated_at=now()
    where id=r.id returning * into r;
  if increased and new_priority in ('high','urgent') then
    perform public.app_emit_notification(r.submitted_by,event_id::text,'request.priority','Request priority increased',
      r.reference||': Priority is now '||new_priority||'.',r.id,'request-detail',r.id);
    perform public.app_notify_department(r.department_id,event_id::text,'request.priority','Request priority increased',
      r.reference||': Priority is now '||new_priority||'.',r.id);
  end if;
  if r.assigned_to is not null then
    perform public.app_emit_notification(r.assigned_to,event_id::text,'request.priority','Job priority updated',
      r.reference||': Priority is now '||new_priority||'.',r.id,'request-detail',r.id);
  end if;
  return jsonb_build_object('request',to_jsonb(r));
end $$;
revoke all on function public.app_change_request_priority(uuid,text,text) from public, anon;
grant execute on function public.app_change_request_priority(uuid,text,text) to authenticated;

create or replace function public.app_set_request_priority(p_request_id uuid,p_priority text)
returns jsonb language sql security definer set search_path=public as $$
  select public.app_change_request_priority(p_request_id,p_priority,null)
$$;

create or replace function public.app_escalate_request(p_request_id uuid,p_remarks text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; reason text:=left(nullif(btrim(p_remarks),''),2000);
  raised boolean;
begin
  select * into r from public.lb_service_requests where id=p_request_id for update;
  if not found or not coalesce(public.app_dispatch_access(r.department_id) or (
    public.app_current_role()='barangay_staff' and public.app_current_status()='active'
      and r.barangay_id=public.app_current_barangay()
  ),false) then raise exception 'You cannot escalate this request'; end if;
  if r.status in ('resolved','closed','rejected') then raise exception 'This request is no longer active'; end if;
  raised:=public.app_priority_order(r.priority)<public.app_priority_order('high');
  if raised and reason is null then raise exception 'Enter a reason for increasing priority'; end if;
  if raised then
    perform public.app_field_booking_event(r.id,'request.priority_changed',null,
      jsonb_build_object('previous',r.priority,'new','high','reason',reason));
  end if;
  update public.lb_service_requests set priority=case when raised then 'high' else priority end,
    escalation_count=escalation_count+1,updated_at=now() where id=r.id;
  insert into public.lb_request_updates(request_id,actor_id,actor_name,type,remarks)
    values(r.id,auth.uid(),'Staff','escalation',coalesce(reason,'Request escalated for priority attention'));
  return jsonb_build_object('ok',true);
end $$;

create function public.app_set_completion_estimate(
  p_request_id uuid,p_completion_at timestamptz,p_minutes integer,p_reason text
) returns void language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; event_id uuid; reason text:=nullif(btrim(p_reason),'');
begin
  select * into r from public.lb_service_requests where id=p_request_id for update;
  if not found or not public.app_dispatch_access(r.department_id) then
    raise exception 'You cannot edit this completion estimate';
  end if;
  if r.status in ('resolved','closed','rejected') then raise exception 'This request is no longer active'; end if;
  if r.estimate_recorded_at is not null
    and (r.estimated_completion_at,r.estimated_duration_minutes) is not distinct from (p_completion_at,p_minutes) then return; end if;
  if reason is null then raise exception 'Enter a reason for the estimate change'; end if;
  if p_minutes is not null and (p_minutes<1 or p_completion_at is null) then raise exception 'Enter a positive duration and an estimate'; end if;
  if p_completion_at is not null and (not isfinite(p_completion_at) or p_completion_at<=now()) then
    raise exception 'The completion estimate must be in the future';
  end if;
  if exists (select 1 from public.lb_appointments b where b.request_id=r.id and b.is_field_booking
    and b.status in ('confirmed','rescheduled','in_progress') and b.scheduled_at>=p_completion_at) then
    raise exception 'The estimate must be after the scheduled start';
  end if;
  event_id:=public.app_field_booking_event(r.id,'request.estimate_changed',
    case when p_completion_at is null then 'Awaiting a new completion estimate.'
    else 'Estimated completion updated to '||to_char(p_completion_at at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI')||' (Philippine time).' end,
    jsonb_build_object('previous',r.estimated_completion_at,'completion_at',p_completion_at,'minutes',p_minutes,'reason',reason));
  update public.lb_service_requests set estimated_completion_at=p_completion_at,estimated_duration_minutes=p_minutes,
    estimate_recorded_at=clock_timestamp(),updated_at=now()
    where id=r.id;
  perform public.app_emit_notification(r.submitted_by,event_id::text,'request.estimate','Estimated completion updated',
    r.reference||': '||case when p_completion_at is null then 'Awaiting a new estimate.'
      else 'New estimate: '||to_char(p_completion_at at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI')||' (Philippine time).' end,
    r.id,'request-detail',r.id);
end $$;
revoke all on function public.app_set_completion_estimate(uuid,timestamptz,integer,text) from public, anon;
grant execute on function public.app_set_completion_estimate(uuid,timestamptz,integer,text) to authenticated;

create function public.app_resident_field_slots(p_category uuid,p_day date)
returns setof timestamptz language plpgsql stable security definer set search_path=public as $$
declare category public.lb_service_categories;
begin
  if public.app_current_role() is distinct from 'resident' or public.app_current_status() is distinct from 'active'
    or not public.app_resident_is_verified(auth.uid()) then raise exception 'An approved resident account is required'; end if;
  if p_day<(now() at time zone 'Asia/Manila')::date or p_day>(now() at time zone 'Asia/Manila')::date+90 then return; end if;
  select * into category from public.lb_service_categories where id=p_category and is_active;
  if not found or category.field_appointment_minutes is null or category.department_id is null then return; end if;
  return query
    select slot from generate_series(p_day::timestamp at time zone 'Asia/Manila',
      (p_day+1)::timestamp at time zone 'Asia/Manila'-interval '30 minutes',interval '30 minutes') slot
    where slot>now() and exists (
      select 1 from public.lb_profiles f where f.role='worker' and f.worker_function='field' and f.status='active'
        and f.department_id=category.department_id
        and public.app_field_is_free(f.id,slot,slot+make_interval(mins=>category.field_appointment_minutes),null)
    ) order by slot;
end $$;
revoke all on function public.app_resident_field_slots(uuid,date) from public, anon;
grant execute on function public.app_resident_field_slots(uuid,date) to authenticated;

create function public.app_request_field_appointment(p_request_id uuid,p_preferred_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; category public.lb_service_categories; booking public.lb_appointments;
begin
  select * into r from public.lb_service_requests where id=p_request_id for update;
  if not found or auth.uid() is null or r.submitted_by is distinct from auth.uid()
    or not public.app_resident_is_verified(auth.uid()) then raise exception 'You cannot request an appointment for this request'; end if;
  if r.status not in ('submitted','for_verification','needs_information','verified','assigned') then
    raise exception 'This request is no longer eligible for an appointment request';
  end if;
  select * into category from public.lb_service_categories where id=r.category_id and is_active;
  if not found or category.field_appointment_minutes is null or category.department_id is null
    or (r.department_id is not null and r.department_id<>category.department_id) then
    raise exception 'This service does not offer resident appointment requests in its current department';
  end if;
  select * into booking from public.lb_appointments where is_field_booking and request_id=r.id;
  if booking.status='pending' and booking.preferred_at=p_preferred_at then return; end if;
  if booking.status in ('confirmed','rescheduled','in_progress','completed') then
    raise exception 'Contact dispatch to change a confirmed appointment';
  end if;
  if p_preferred_at is null or not isfinite(p_preferred_at) or not exists (
    select 1 from public.app_resident_field_slots(category.id,(p_preferred_at at time zone 'Asia/Manila')::date) slot
      where slot=p_preferred_at
  ) then raise exception 'That preferred time is no longer offered. Select another time.'; end if;
  update public.lb_service_requests set department_id=category.department_id,updated_at=now() where id=r.id;
  insert into public.lb_appointments(is_field_booking,request_id,resident_id,barangay_id,department_id,
    preferred_at,scheduled_at,purpose,status,created_by)
  values(true,r.id,r.submitted_by,r.barangay_id,category.department_id,p_preferred_at,p_preferred_at,
    'Field service','pending',auth.uid())
  on conflict(request_id) where is_field_booking do update set status='pending', preferred_at=excluded.preferred_at,
    proposed_at=null,scheduled_at=excluded.scheduled_at,department_id=excluded.department_id,field_assignee_id=null,dispatcher_id=null,
    assignment_id=null,end_at=null,change_reason='',updated_at=clock_timestamp();
end $$;
revoke all on function public.app_request_field_appointment(uuid,timestamptz) from public, anon;
grant execute on function public.app_request_field_appointment(uuid,timestamptz) to authenticated;

create function public.app_propose_field_appointment(p_request_id uuid,p_start timestamptz,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; b public.lb_appointments; minutes integer; finish timestamptz;
  reason text:=left(nullif(btrim(p_reason),''),1000);
begin
  select * into r from public.lb_service_requests where id=p_request_id for update;
  if not found or not public.app_dispatch_access(r.department_id) then raise exception 'You cannot propose a time for this request'; end if;
  select * into b from public.lb_appointments where request_id=r.id and is_field_booking and status='pending' for update;
  if not found then raise exception 'Only pending appointment requests can receive an alternate proposal'; end if;
  if (b.proposed_at,b.change_reason) is not distinct from (p_start,reason) then return; end if;
  if reason is null then raise exception 'Enter a reason for the alternate time'; end if;
  if p_start is null or not isfinite(p_start) or p_start<=now()
    or (p_start at time zone 'Asia/Manila')::date>(now() at time zone 'Asia/Manila')::date+90
    or extract(minute from p_start at time zone 'Asia/Manila') not in (0,30) or extract(second from p_start)<>0
    or p_start=b.preferred_at then raise exception 'Choose a different future time on the hour or half hour'; end if;
  select field_appointment_minutes into minutes from public.lb_service_categories
    where id=r.category_id and is_active and department_id=r.department_id;
  finish:=p_start+make_interval(mins=>minutes);
  if minutes is null or not public.app_dispatcher_in_booking_hours(auth.uid(),p_start,finish) or not exists (
    select 1 from public.lb_profiles f where f.role='worker' and f.worker_function='field'
      and f.status='active' and f.department_id=r.department_id
      and public.app_field_is_free(f.id,p_start,finish,r.id)
  ) then raise exception 'That proposed time is outside available hours or is already booked'; end if;
  update public.lb_appointments set proposed_at=p_start,change_reason=reason,dispatcher_id=auth.uid(),updated_at=clock_timestamp()
    where id=b.id;
end $$;
revoke all on function public.app_propose_field_appointment(uuid,timestamptz,text) from public, anon;
grant execute on function public.app_propose_field_appointment(uuid,timestamptz,text) to authenticated;

create function public.app_submit_request_with_field_appointment(
  p_title text,p_description text,p_category_id uuid,p_location text,p_evidence_path text,
  p_is_custom boolean,p_latitude numeric,p_longitude numeric,p_location_details jsonb,p_preferred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  result:=public.app_submit_resident_request_with_evidence_v2(p_title,p_description,p_category_id,p_location,
    p_evidence_path,p_is_custom,p_latitude,p_longitude,p_location_details);
  perform public.app_request_field_appointment((result#>>'{request,id}')::uuid,p_preferred_at);
  return result;
end $$;
revoke all on function public.app_submit_request_with_field_appointment(text,text,uuid,text,text,boolean,numeric,numeric,jsonb,timestamptz) from public, anon;
grant execute on function public.app_submit_request_with_field_appointment(text,text,uuid,text,text,boolean,numeric,numeric,jsonb,timestamptz) to authenticated;

create function public.app_save_field_assignment(
  p_request_id uuid,p_field_user_id uuid,p_start timestamptz,p_minutes integer,
  p_notes text,p_reason text default null,p_priority text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; f public.lb_profiles; previous_job public.lb_assignments;
  booking public.lb_appointments; job_id uuid; finish timestamptz; old_status text;
  reason text:=nullif(btrim(p_reason),''); instructions text:=left(coalesce(btrim(p_notes),''),4000);
  schedule_changed boolean; replaces_worker boolean;
  prior_estimate timestamptz;
begin
  select * into r from public.lb_service_requests where id=p_request_id for update;
  if not found or not public.app_dispatch_access(r.department_id) then raise exception 'You cannot assign this request'; end if;
  if r.status not in ('verified','assigned','in_progress') then raise exception 'The request must be verified and active'; end if;
  select * into previous_job from public.lb_assignments where request_id=r.id and assigned_to=r.assigned_to
    order by created_at desc,id desc limit 1 for update;
  select * into booking from public.lb_appointments where is_field_booking and request_id=r.id for update;
  replaces_worker:=previous_job.id is not null and previous_job.assigned_to<>p_field_user_id;
  if p_field_user_id is null then raise exception 'Select field personnel'; end if;
  if (p_start is null)<>(p_minutes is null) then raise exception 'Enter both the appointment time and its duration'; end if;
  if p_start is null and booking.status in ('pending','confirmed','rescheduled','in_progress') then
    raise exception 'Confirm a time or cancel the existing appointment before assigning without a schedule';
  end if;
  if p_start is not null and (not isfinite(p_start) or p_minutes not between 15 and 480) then
    raise exception 'Appointments must last 15 to 480 minutes';
  end if;
  finish:=p_start+make_interval(mins=>p_minutes);
  schedule_changed:=previous_job.id is null or previous_job.status not in ('pending','accepted','in_progress')
    or (previous_job.schedule_at,previous_job.deadline_at) is distinct from (p_start,finish);
  if (replaces_worker or (schedule_changed and coalesce(previous_job.schedule_at is not null,false))
    or (booking.status='pending' and booking.preferred_at is distinct from p_start)) and reason is null then
    raise exception 'Enter a reason for reassigning or changing the appointment time';
  end if;

  perform public.app_lock_field_schedule(p_field_user_id);
  select * into f from public.lb_profiles where id=p_field_user_id and role='worker' and worker_function='field'
    and status='active' and department_id is not null for share;
  if not found or (r.department_id is not null and r.department_id<>f.department_id) then
    raise exception 'Select active field personnel in the request department';
  end if;
  if p_start is not null and (schedule_changed or replaces_worker) then
    if p_start<=clock_timestamp() then raise exception 'Choose an appointment in the future'; end if;
    if not public.app_dispatcher_in_booking_hours(auth.uid(),p_start,finish) then
      raise exception 'The appointment is outside your saved dispatcher availability';
    end if;
    if not public.app_field_is_free(f.id,p_start,finish,r.id) then
      raise exception 'This time overlaps a booking or falls outside the worker''s availability';
    end if;
  end if;
  if p_priority is not null then
    perform public.app_change_request_priority(r.id,p_priority,p_reason);
    select * into r from public.lb_service_requests where id=r.id;
  end if;
  if previous_job.id is not null and not replaces_worker and previous_job.status in ('pending','accepted','in_progress') then
    job_id:=previous_job.id;
    if not schedule_changed and previous_job.notes=instructions then return jsonb_build_object('assignment_id',job_id); end if;
    update public.lb_assignments set schedule_at=p_start,deadline_at=finish,duration_minutes=p_minutes,
      status=case when schedule_changed and status='in_progress' then 'accepted' else status end,
      notes=instructions,updated_at=clock_timestamp() where id=job_id;
  else
    insert into public.lb_assignments(request_id,assigned_to,assigned_by,department_id,status,schedule_at,deadline_at,
      duration_minutes,appointment_status,notes,created_at)
    values(r.id,f.id,auth.uid(),f.department_id,'pending',p_start,finish,p_minutes,
      case when p_start is null then 'pending' else 'scheduled' end,instructions,clock_timestamp()) returning id into job_id;
  end if;
  old_status:=r.status;
  prior_estimate:=r.estimated_completion_at;
  update public.lb_service_requests set assigned_to=f.id,assigned_by=auth.uid(),department_id=f.department_id,
    status=case when status='in_progress' and not replaces_worker and not schedule_changed then 'in_progress' else 'assigned' end,
    estimated_completion_at=case when p_start is not null and (schedule_changed or replaces_worker)
      then finish else estimated_completion_at end,
    estimated_duration_minutes=case when p_start is not null and (schedule_changed or replaces_worker)
      then p_minutes else estimated_duration_minutes end,
    estimate_recorded_at=case when p_start is not null and (schedule_changed or replaces_worker)
      then clock_timestamp() else estimate_recorded_at end,
    updated_at=clock_timestamp() where id=r.id returning * into r;
  if p_start is not null then
    insert into public.lb_appointments(is_field_booking,request_id,resident_id,barangay_id,department_id,scheduled_at,end_at,
      purpose,status,created_by,dispatcher_id,field_assignee_id,assignment_id,change_reason)
    values(true,r.id,r.submitted_by,r.barangay_id,f.department_id,p_start,finish,'Field service',
      case when r.status='in_progress' then 'in_progress' else 'confirmed' end,auth.uid(),auth.uid(),f.id,job_id,coalesce(reason,''))
    on conflict(request_id) where is_field_booking do update set
      department_id=excluded.department_id,field_assignee_id=excluded.field_assignee_id,assignment_id=excluded.assignment_id,
      dispatcher_id=excluded.dispatcher_id,proposed_at=null,scheduled_at=excluded.scheduled_at,end_at=excluded.end_at,
      status=case when excluded.status='in_progress' then 'in_progress'
        when lb_appointments.status in ('confirmed','rescheduled','in_progress')
          and (lb_appointments.scheduled_at,lb_appointments.end_at,lb_appointments.field_assignee_id)
            is distinct from (excluded.scheduled_at,excluded.end_at,excluded.field_assignee_id) then 'rescheduled'
        when lb_appointments.status='rescheduled' then 'rescheduled' else excluded.status end,
      change_reason=case when schedule_changed or replaces_worker then excluded.change_reason else lb_appointments.change_reason end,
      updated_at=clock_timestamp();
  end if;
  if replaces_worker and previous_job.status in ('pending','accepted','in_progress') then
    update public.lb_assignments set status='cancelled',appointment_status='cancelled',updated_at=clock_timestamp()
      where id=previous_job.id;
  end if;
  perform public.app_field_booking_event(r.id,
    case when replaces_worker then 'assignment.reassigned' when previous_job.id is null then 'assignment.created' else 'assignment.updated' end,
    case when replaces_worker or previous_job.id is null then 'Field personnel assigned.' end,
    jsonb_build_object('assignment_id',job_id,'previous_assignment_id',previous_job.id,
      'assignee',f.id,'from_status',old_status,'start',p_start,'end',finish,'reason',reason,'instructions',instructions,
      'previous_estimate',prior_estimate,'estimate',r.estimated_completion_at));
  if p_start is null and (previous_job.id is null or replaces_worker) then
    perform public.app_emit_notification(r.submitted_by,'field-assigned:'||job_id,'request.assignment','Request assigned',
      r.reference||': Field personnel have been assigned.',r.id,'request-detail',r.id);
  end if;
  return jsonb_build_object('assignment_id',job_id);
end $$;
revoke all on function public.app_save_field_assignment(uuid,uuid,timestamptz,integer,text,text,text) from public, anon;
grant execute on function public.app_save_field_assignment(uuid,uuid,timestamptz,integer,text,text,text) to authenticated;

-- Retain the original entry point for existing unscheduled callers.
create or replace function public.app_assign_field(
  p_request_id uuid,p_field_user_id uuid,p_schedule_at timestamptz default null,
  p_deadline_at timestamptz default null,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if (p_schedule_at is null)<>(p_deadline_at is null) then raise exception 'Provide the scheduled start and end'; end if;
  return public.app_save_field_assignment(p_request_id,p_field_user_id,p_schedule_at,
    ceil(extract(epoch from (p_deadline_at-p_schedule_at))/60)::integer,p_notes);
end $$;

create function public.app_cancel_field_appointment(p_request_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; a public.lb_appointments; reason text:=nullif(btrim(p_reason),'');
begin
  select * into r from public.lb_service_requests where id=p_request_id for update;
  if not found or not public.app_dispatch_access(r.department_id) then raise exception 'You cannot cancel this appointment'; end if;
  select * into a from public.lb_appointments where is_field_booking and request_id=r.id for update;
  if a.status='cancelled' then return; end if;
  if a.id is null or a.status='completed' then raise exception 'No active appointment to cancel'; end if;
  if reason is null then raise exception 'Enter the cancellation reason'; end if;
  update public.lb_appointments set status='cancelled',change_reason=left(reason,1000),updated_at=clock_timestamp() where id=a.id;
  if a.assignment_id is not null then
    update public.lb_assignments set status='cancelled',appointment_status='cancelled',updated_at=clock_timestamp()
      where id=a.assignment_id and status in ('pending','accepted','in_progress');
    update public.lb_service_requests set assigned_to=null,estimated_completion_at=null,
      estimated_duration_minutes=null,estimate_recorded_at=clock_timestamp(),status='assigned',updated_at=clock_timestamp()
      where id=r.id and assigned_to=a.field_assignee_id and status in ('verified','assigned','in_progress');
  end if;
end $$;
revoke all on function public.app_cancel_field_appointment(uuid,text) from public, anon;
grant execute on function public.app_cancel_field_appointment(uuid,text) to authenticated;

commit;
