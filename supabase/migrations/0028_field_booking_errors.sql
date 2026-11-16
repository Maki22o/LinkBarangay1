-- Preserve booking rules and return the exact field availability check that failed.
begin;

create or replace function public.app_save_field_assignment(
  p_request_id uuid,p_field_user_id uuid,p_start timestamptz,p_minutes integer,
  p_notes text,p_reason text default null,p_priority text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; f public.lb_profiles; previous_job public.lb_assignments;
  booking public.lb_appointments; job_id uuid; finish timestamptz; old_status text;
  reason text:=nullif(btrim(p_reason),''); instructions text:=left(coalesce(btrim(p_notes),''),4000);
  schedule_changed boolean; replaces_worker boolean;
  prior_estimate timestamptz;
  work_day date;
  field_start time;
  field_end time;
  block_start timestamptz;
  block_end timestamptz;
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
    if not public.app_field_is_free(f.id, p_start, finish, r.id) then
      work_day := (p_start at time zone 'Asia/Manila')::date;
      if not public.app_field_on_duty(f.id, p_start, finish) then
        select h.start_time, h.end_time into field_start, field_end
        from public.lb_field_working_hours h
        where h.personnel_id = f.id and h.day_of_week = extract(dow from work_day);
        if not found then
          raise exception 'The selected worker has no saved working hours on %. Ask them to save that weekday in My Availability.',
            to_char(work_day, 'FMDay, FMMonth FMDD');
        end if;
        raise exception 'The appointment is outside the worker''s saved hours on %. The full appointment must fit between % and % Philippine time.',
          to_char(work_day, 'FMDay, FMMonth FMDD'),
          to_char(work_day + field_start, 'FMHH12:MI AM'),
          to_char(work_day + field_end, 'FMHH12:MI AM');
      end if;

      select b.starts_at, b.ends_at into block_start, block_end
      from public.lb_field_unavailability b
      where b.personnel_id = f.id and b.starts_at < finish and b.ends_at > p_start
      order by b.starts_at
      limit 1;
      if found then
        raise exception 'This appointment overlaps a blocked availability period from % to % Philippine time.',
          to_char(block_start at time zone 'Asia/Manila', 'FMMonth FMDD, FMHH12:MI AM'),
          to_char(block_end at time zone 'Asia/Manila', 'FMMonth FMDD, FMHH12:MI AM');
      end if;

      raise exception 'This time overlaps a booking for the selected worker. Choose another time or worker.';
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

commit;
