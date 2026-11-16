begin;

create or replace function public.app_guard_appointment_relationships()
returns trigger language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests;
begin
  if tg_op='UPDATE' and (new.is_field_booking,new.resident_id,new.request_id,new.barangay_id)
    is not distinct from (old.is_field_booking,old.resident_id,old.request_id,old.barangay_id) then return new; end if;
  if new.is_field_booking then
    select * into r from public.lb_service_requests where id=new.request_id;
    if not found or (r.submitted_by,r.barangay_id) is distinct from (new.resident_id,new.barangay_id) then
      raise exception 'The field appointment must belong to its request and resident';
    end if;
    return new;
  end if;
  if new.resident_id is not null and not exists (select 1 from public.lb_profiles p
    where p.id=new.resident_id and p.role='resident' and p.barangay_id=new.barangay_id) then
    raise exception 'The appointment resident must belong to this barangay';
  end if;
  if new.request_id is not null then
    select * into r from public.lb_service_requests where id=new.request_id;
    if not found or r.barangay_id is distinct from new.barangay_id then
      raise exception 'The appointment request must belong to this barangay';
    end if;
    if new.resident_id is not null and r.submitted_by is not null and r.submitted_by<>new.resident_id then
      raise exception 'The appointment resident does not own the linked request';
    end if;
  end if;
  return new;
end $$;

-- The original desk appointment trigger continues to handle desk bookings.
create or replace function public.app_notify_appointment()
returns trigger language plpgsql security definer set search_path=public as $$
declare a public.lb_appointments; p public.lb_profiles; v_key text:='appointment:'||gen_random_uuid();
  v_title text; v_request uuid; r public.lb_service_requests; public_message text; event_id uuid;
  field_event text;
begin
  if tg_op='DELETE' then a:=old; else a:=new; end if;
  if a.is_field_booking then
    if tg_op='DELETE' then return old; end if;
    if tg_op='UPDATE' and (new.status,new.scheduled_at,new.end_at,new.field_assignee_id,new.preferred_at,new.proposed_at)
      is not distinct from (old.status,old.scheduled_at,old.end_at,old.field_assignee_id,old.preferred_at,old.proposed_at) then return new; end if;
    select * into r from public.lb_service_requests where id=a.request_id;
    if not found then return new; end if;
    field_event:=case when a.status='pending' and a.proposed_at is not null then 'proposed' else a.status end;
    v_title:=case field_event when 'pending' then 'Appointment request submitted'
      when 'proposed' then 'Alternate appointment time proposed'
      when 'confirmed' then 'Appointment confirmed' when 'rescheduled' then 'Appointment rescheduled'
      when 'cancelled' then 'Appointment cancelled' when 'in_progress' then 'Appointment in progress'
      else 'Appointment completed' end;
    public_message:=v_title||case when field_event in ('pending','proposed','confirmed','rescheduled')
      then ' for '||to_char(coalesce(a.proposed_at,a.scheduled_at) at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI')||' (Philippine time)'
      else '' end||'.';
    event_id:=public.app_field_booking_event(r.id,'appointment.'||field_event,
      case when a.status not in ('in_progress','completed') then public_message end,
      jsonb_build_object('appointment_id',a.id,'status',a.status,'preferred_at',a.preferred_at,'proposed_at',a.proposed_at,
        'scheduled_at',a.scheduled_at,'end_at',a.end_at,'assignment_id',a.assignment_id,'reason',a.change_reason,
        'request_estimate',r.estimated_completion_at));
    if a.status in ('pending','confirmed','rescheduled','cancelled') then
      perform public.app_emit_notification(r.submitted_by,event_id::text,'appointment.'||field_event,v_title,
        r.reference||': '||public_message,r.id,'request-detail',r.id);
    end if;
    if field_event='pending' then
      perform public.app_notify_department(a.department_id,event_id::text,'appointment.pending','Appointment needs review',
        r.reference||': A resident requested an appointment.',r.id);
    end if;
    update public.lb_service_requests set updated_at=clock_timestamp() where id=r.id;
    return new;
  end if;

  if tg_op='DELETE' then v_title:='Appointment Cancelled';
  elsif tg_op='INSERT' then v_title:='Appointment Scheduled';
  elsif (new.scheduled_at,new.status,new.resident_id,new.request_id,new.barangay_id,new.purpose,new.notes)
    is not distinct from (old.scheduled_at,old.status,old.resident_id,old.request_id,old.barangay_id,old.purpose,old.notes) then return new;
  elsif new.status='completed' then v_title:='Appointment Completed';
  elsif new.status='cancelled' then v_title:='Appointment Cancelled';
  else v_title:='Appointment Updated'; end if;
  for p in select * from public.lb_profiles where status='active' and ((id=a.resident_id and barangay_id=a.barangay_id)
    or (role='worker' and worker_function='barangay_staff' and barangay_id=a.barangay_id)) loop
    if p.id is distinct from auth.uid() then
      v_request:=null;
      if a.request_id is not null and public.app_notification_can_access_request(p.id,a.request_id) then v_request:=a.request_id; end if;
      perform public.app_emit_notification(p.id,v_key,
        'appointment.'||case when tg_op='DELETE' then 'cancelled' when tg_op='INSERT' then 'scheduled' else a.status end,
        v_title,v_title||'. Scheduled for '||to_char(a.scheduled_at at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI')||
        ' (Philippine time).',v_request,'appointments',a.id);
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.app_notify_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; title text; event_type text; destination text:='job-detail';
begin
  select * into r from public.lb_service_requests where id=new.request_id;
  if tg_op='INSERT' then
    title:=case when r.priority='urgent' then 'Urgent job assigned' else 'New job assigned' end;
    event_type:='assignment.assigned';
  elsif new.status='cancelled' and old.status<>'cancelled' then
    title:='Assignment cancelled'; event_type:='assignment.cancelled'; destination:='jobs';
  elsif (new.schedule_at,new.deadline_at) is distinct from (old.schedule_at,old.deadline_at) then
    title:='Job schedule updated'; event_type:='assignment.updated';
  elsif new.notes is distinct from old.notes then
    title:='Job instructions updated'; event_type:='assignment.updated';
  else return new;
  end if;
  if exists (select 1 from public.lb_profiles p where p.id=new.assigned_to and p.role='worker'
    and p.worker_function='field' and p.status='active' and p.department_id=new.department_id) then
    perform public.app_emit_notification(new.assigned_to,'assignment:'||gen_random_uuid(),event_type,title,
      coalesce(r.reference,'Request')||': '||title||'.',null,destination,
      case when destination='job-detail' then new.id end);
  end if;
  return new;
end $$;

create or replace function public.app_sync_assignment_appointment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('completed','verified') then new.appointment_status:='completed';
  elsif new.status in ('cancelled','declined','unable_to_complete','needs_rescheduling') then new.appointment_status:='cancelled';
  elsif (new.schedule_at,new.deadline_at) is distinct from (old.schedule_at,old.deadline_at) then
    new.appointment_status:=case when new.schedule_at is null then 'pending' when old.schedule_at is null then 'scheduled' else 'rescheduled' end;
  end if;
  return new;
end $$;

create function public.app_sync_managed_appointment()
returns trigger language plpgsql security definer set search_path=public as $$
declare next_status text;
begin
  if new.status=old.status then return new; end if;
  next_status:=case when new.status='in_progress' then 'in_progress'
    when new.status in ('completed','verified') then 'completed'
    when new.status in ('declined','unable_to_complete','needs_rescheduling','cancelled') then 'cancelled' end;
  if next_status is not null then
    update public.lb_appointments set status=next_status,updated_at=clock_timestamp(),
      change_reason=case when next_status='cancelled' then
        case when new.status='needs_rescheduling' then 'Field personnel requested rescheduling.'
          else 'Field personnel are no longer assigned to this appointment.' end
        else change_reason end
      where is_field_booking and assignment_id=new.id and status in ('confirmed','rescheduled','in_progress');
  end if;
  return new;
end $$;
revoke all on function public.app_sync_managed_appointment() from public, anon, authenticated;
create trigger app_sync_managed_appointment_trg after update of status on public.lb_assignments
  for each row execute function public.app_sync_managed_appointment();

create function public.app_release_invalid_field_booking()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (new.status<>old.status and new.status in ('closed','rejected','resolved'))
    or (old.assigned_to is not null and new.assigned_to is null)
    or (old.department_id is not null and new.department_id is distinct from old.department_id) then
    update public.lb_appointments set status='cancelled',updated_at=clock_timestamp(),
      change_reason='The request status or department changed.'
      where request_id=new.id and is_field_booking and status in ('pending','confirmed','rescheduled','in_progress');
    update public.lb_assignments set status='cancelled',appointment_status='cancelled',updated_at=clock_timestamp()
      where request_id=new.id and status in ('pending','accepted','in_progress')
        and (new.status in ('closed','rejected','resolved') or department_id is distinct from new.department_id or new.assigned_to is null);
  end if;
  return new;
end $$;
revoke all on function public.app_release_invalid_field_booking() from public, anon, authenticated;
create trigger app_release_invalid_field_booking_trg after update of status,assigned_to,department_id on public.lb_service_requests
  for each row execute function public.app_release_invalid_field_booking();

create or replace function public.app_accept_assignment(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.lb_assignments; r public.lb_service_requests; event_id uuid;
begin
  a:=public.app_require_current_assignment(p_assignment_id);
  if a.status='accepted' or (a.status='in_progress' and a.accepted_at is not null) then return jsonb_build_object('ok',true); end if;
  if a.status<>'pending' then raise exception 'This assignment is no longer pending'; end if;
  update public.lb_assignments set status='accepted',accepted_at=now(),updated_at=now() where id=a.id;
  select * into r from public.lb_service_requests where id=a.request_id;
  event_id:=public.app_field_booking_event(r.id,'assignment.accepted',null,jsonb_build_object('assignment_id',a.id));
  perform public.app_notify_department(r.department_id,event_id::text,'assignment.accepted','Field assignment accepted',
    r.reference||': Field personnel accepted the job.',r.id);
  return jsonb_build_object('ok',true);
end $$;

create function public.app_start_field_job(p_assignment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare a public.lb_assignments; r public.lb_service_requests;
begin
  a:=public.app_require_current_assignment(p_assignment_id);
  if a.status='in_progress' then return; end if;
  if a.status<>'accepted' then raise exception 'Accept the assignment before starting work'; end if;
  select * into r from public.lb_service_requests where id=a.request_id;
  update public.lb_assignments set status='in_progress',updated_at=now() where id=a.id;
  update public.lb_service_requests set status='in_progress',updated_at=now() where id=r.id;
  insert into public.lb_request_updates(request_id,actor_id,actor_name,type,previous_status,new_status,remarks)
  values(r.id,auth.uid(),'Field personnel','status_change',r.status,'in_progress','Work started.');
end $$;
revoke all on function public.app_start_field_job(uuid) from public, anon;
grant execute on function public.app_start_field_job(uuid) to authenticated;

create or replace function public.app_update_job_progress(p_assignment_id uuid,p_remarks text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.lb_assignments; note text:=left(nullif(btrim(p_remarks),''),2000);
begin
  a:=public.app_require_current_assignment(p_assignment_id);
  if a.status<>'in_progress' or note is null then raise exception 'Start work and enter a progress update'; end if;
  if a.progress_notes=note then return jsonb_build_object('ok',true); end if;
  update public.lb_assignments set progress_notes=note,updated_at=now() where id=a.id;
  insert into public.lb_request_updates(request_id,actor_id,actor_name,type,remarks)
  values(a.request_id,auth.uid(),'Field personnel','comment',note);
  update public.lb_service_requests set updated_at=clock_timestamp() where id=a.request_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.app_complete_job(p_assignment_id uuid,p_remarks text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.lb_assignments; r public.lb_service_requests; note text:=left(nullif(btrim(p_remarks),''),2000);
begin
  a:=public.app_require_current_assignment(p_assignment_id);
  if a.status<>'in_progress' then raise exception 'Start the job before submitting completion'; end if;
  select * into r from public.lb_service_requests where id=a.request_id;
  update public.lb_assignments set status='completed',completed_at=now(),completion_remarks=coalesce(note,''),updated_at=now() where id=a.id;
  update public.lb_service_requests set status='for_inspection',updated_at=now() where id=r.id;
  insert into public.lb_request_updates(request_id,actor_id,actor_name,type,previous_status,new_status,remarks)
  values(r.id,auth.uid(),'Field personnel','status_change',r.status,'for_inspection',
    'Work completed and sent for inspection.'||coalesce(' '||note,''));
  return jsonb_build_object('ok',true);
end $$;

create function public.app_report_field_job(p_assignment_id uuid,p_outcome text,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare a public.lb_assignments; r public.lb_service_requests; event_id uuid;
  reason text:=left(nullif(btrim(p_reason),''),2000); title text;
begin
  if reason is null or p_outcome is null or p_outcome not in ('delayed','declined','unable_to_complete','needs_rescheduling') then
    raise exception 'Select an outcome and enter a reason';
  end if;
  a:=public.app_require_current_assignment(p_assignment_id);
  select * into r from public.lb_service_requests where id=a.request_id;
  if p_outcome='delayed' then
    if a.delay_reason=reason then return; end if;
    update public.lb_assignments set delay_reason=reason,updated_at=clock_timestamp() where id=a.id;
    update public.lb_service_requests set updated_at=clock_timestamp() where id=r.id;
  else
    update public.lb_assignments set status=p_outcome,decline_reason=reason,updated_at=now() where id=a.id;
    update public.lb_service_requests set assigned_to=null,status='assigned',estimated_completion_at=null,
      estimated_duration_minutes=null,estimate_recorded_at=clock_timestamp(),updated_at=now() where id=r.id;
  end if;
  title:=case p_outcome when 'delayed' then 'Field job delayed' when 'needs_rescheduling' then 'Field job needs rescheduling'
    when 'declined' then 'Field assignment declined' else 'Field job could not be completed' end;
  event_id:=public.app_field_booking_event(r.id,'assignment.'||p_outcome,title||'.',
    jsonb_build_object('assignment_id',a.id,'reason',reason));
  perform public.app_notify_department(r.department_id,event_id::text,'assignment.'||p_outcome,title,r.reference||': '||reason,r.id);
end $$;
revoke all on function public.app_report_field_job(uuid,text,text) from public, anon;
grant execute on function public.app_report_field_job(uuid,text,text) to authenticated;

create or replace function public.app_decline_assignment(p_assignment_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.app_report_field_job(p_assignment_id,'declined',p_reason);
  return jsonb_build_object('ok',true);
end $$;

-- Request owners access only display fields, never assignment notes or identities.
create function public.app_request_schedule(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.lb_service_requests; b public.lb_appointments; a public.lb_assignments;
begin
  select * into r from public.lb_service_requests where id=p_request_id;
  if not found or not coalesce(public.app_can_access_request(r.id),false) then return null; end if;
  select * into b from public.lb_appointments where is_field_booking and request_id=r.id;
  if b.id is not null then
    return jsonb_build_object('status',b.status,'preferred_at',b.preferred_at,'proposed_at',case when b.status='pending' then b.proposed_at end,
      'scheduled_at',case when b.status<>'pending' then b.scheduled_at end,'end_at',b.end_at,'change_reason',b.change_reason);
  end if;
  select * into a from public.lb_assignments where request_id=r.id and assigned_to=r.assigned_to and schedule_at is not null
    order by created_at desc,id desc limit 1;
  if a.id is null then return null; end if;
  return jsonb_build_object('status',case when a.appointment_status='scheduled' then 'confirmed' else a.appointment_status end,
    'scheduled_at',a.schedule_at,'end_at',a.deadline_at,'preferred_at',null,'proposed_at',null,'change_reason','');
end $$;
revoke all on function public.app_request_schedule(uuid) from public, anon;
grant execute on function public.app_request_schedule(uuid) to authenticated;

create function public.app_field_roster(p_department uuid,p_day date,p_minutes integer,p_request_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.app_dispatch_access(p_department) then raise exception 'You cannot view this department'; end if;
  if p_day is null or not isfinite(p_day) or p_minutes is null or p_minutes not between 15 and 480
    or p_day>(now() at time zone 'Asia/Manila')::date+366 then raise exception 'Choose a valid scheduling date and duration'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'name',f.full_name,'workload',jobs.total,
    'status',case when public.app_field_has_booking(f.id,now(),now()+interval '1 second',null)
      or exists (select 1 from public.lb_service_requests r where r.assigned_to=f.id and r.department_id=p_department
        and r.status='in_progress') then 'Busy'
      when not public.app_field_on_duty(f.id,now(),now()+interval '1 second') then 'Off duty'
      when not public.app_field_is_free(f.id,now(),now()+interval '1 second',null) then 'Unavailable' else 'Available' end,
    'slots',coalesce(slots.available,'[]'::jsonb),'next_at',next_slot.start_at,
    'blocks',coalesce(blocks.periods,'[]'::jsonb),'bookings',coalesce(booked.periods,'[]'::jsonb)
  ) order by f.full_name),'[]'::jsonb) into result
  from public.lb_profiles f
  cross join lateral (
    select count(*) total from public.lb_service_requests r where r.assigned_to=f.id
      and r.department_id=p_department and r.status in ('verified','assigned','in_progress')
  ) jobs
  cross join lateral (
    select jsonb_agg(slot order by slot) available from generate_series(p_day::timestamp at time zone 'Asia/Manila',
      ((p_day+1)::timestamp at time zone 'Asia/Manila')-interval '30 minutes',interval '30 minutes') slot
    where slot>now() and public.app_field_is_free(f.id,slot,slot+make_interval(mins=>p_minutes),p_request_id)
      and public.app_dispatcher_in_booking_hours(auth.uid(),slot,slot+make_interval(mins=>p_minutes))
  ) slots
  left join lateral (
    select slot start_at from generate_series(greatest(p_day,(now() at time zone 'Asia/Manila')::date)::timestamp at time zone 'Asia/Manila',
      ((greatest(p_day,(now() at time zone 'Asia/Manila')::date)+7)::timestamp at time zone 'Asia/Manila')-interval '30 minutes',
      interval '30 minutes') slot
    where slot>now() and public.app_field_is_free(f.id,slot,slot+make_interval(mins=>p_minutes),p_request_id)
      and public.app_dispatcher_in_booking_hours(auth.uid(),slot,slot+make_interval(mins=>p_minutes))
    order by slot limit 1
  ) next_slot on true
  cross join lateral (
    select jsonb_agg(jsonb_build_object('starts_at',b.starts_at,'ends_at',b.ends_at) order by b.starts_at) periods
    from public.lb_field_unavailability b where b.personnel_id=f.id
      and b.starts_at<((p_day+1)::timestamp at time zone 'Asia/Manila')
      and b.ends_at>(p_day::timestamp at time zone 'Asia/Manila')
  ) blocks
  cross join lateral (
    select jsonb_agg(jsonb_build_object('starts_at',a.schedule_at,'ends_at',a.deadline_at,
      'reference',r.reference,'title',r.title) order by a.schedule_at) periods
    from public.lb_assignments a join public.lb_service_requests r on r.id=a.request_id
      and r.assigned_to=a.assigned_to and r.department_id=a.department_id
      and r.status in ('verified','assigned','in_progress')
    where a.assigned_to=f.id and a.status in ('pending','accepted','in_progress')
      and a.appointment_status in ('scheduled','rescheduled')
      and a.schedule_at<((p_day+1)::timestamp at time zone 'Asia/Manila')
      and a.deadline_at>(p_day::timestamp at time zone 'Asia/Manila')
      and a.id=(select last_job.id from public.lb_assignments last_job
        where last_job.request_id=r.id and last_job.assigned_to=f.id
        order by last_job.created_at desc,last_job.id desc limit 1)
  ) booked
  where f.role='worker' and f.worker_function='field' and f.status='active' and f.department_id=p_department;
  return result;
end $$;
revoke all on function public.app_field_roster(uuid,date,integer,uuid) from public, anon;
grant execute on function public.app_field_roster(uuid,date,integer,uuid) to authenticated;

-- Add the new tables to Realtime where the project already uses a publication.
do $$
declare table_name text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach table_name in array array['lb_assignments','lb_appointments'] loop
      if not exists (select 1 from pg_publication_tables p where p.pubname='supabase_realtime'
        and p.schemaname='public' and p.tablename=table_name) then
        execute format('alter publication supabase_realtime add table public.%I',table_name);
      end if;
    end loop;
  end if;
end $$;

-- Run from an optional backend schedule. Event keys deduplicate repeated runs.
create function public.app_send_dispatch_reminders()
returns void language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; threshold integer;
begin
  for r in select * from public.lb_service_requests where status in ('verified','assigned','in_progress')
    and assigned_to is not null and (case when estimate_recorded_at is not null then estimated_completion_at else
      (select a.deadline_at from public.lb_assignments a where a.request_id=lb_service_requests.id
        and a.assigned_to=lb_service_requests.assigned_to and a.status in ('pending','accepted','in_progress')
        order by a.created_at desc,a.id desc limit 1) end)<now()
  loop
    perform public.app_notify_department(r.department_id,'dispatch-overdue:'||r.id||':'||
      coalesce(extract(epoch from r.estimated_completion_at)::text,'legacy'),
      'assignment.overdue','Field job overdue',r.reference||': Estimated completion has passed.',r.id);
  end loop;
  select case when value->>'urgent_unassigned_minutes' ~ '^[0-9]{1,5}$'
    then (value->>'urgent_unassigned_minutes')::integer end into threshold
    from public.lb_settings where key='dispatch_alerts';
  if threshold is null or threshold<1 then return; end if;
  for r in select * from public.lb_service_requests where priority='urgent' and assigned_to is null
    and status in ('submitted','for_verification','needs_information','verified','assigned')
    and coalesce(priority_changed_at,created_at)<now()-make_interval(mins=>threshold)
  loop
    perform public.app_notify_department(r.department_id,'dispatch-urgent:'||r.id||':'||
      extract(epoch from coalesce(r.priority_changed_at,r.created_at))::text,
      'request.urgent_unassigned','Urgent request needs assignment',r.reference||': This urgent request is still unassigned.',r.id);
  end loop;
end $$;
revoke all on function public.app_send_dispatch_reminders() from public, anon, authenticated;

notify pgrst,'reload schema';
commit;
