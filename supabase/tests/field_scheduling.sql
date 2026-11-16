-- Run on a disposable database after the full migration sequence.
create schema field_scheduling_tests;
grant usage on schema field_scheduling_tests to authenticated;

create function field_scheduling_tests.id(n integer) returns uuid language sql immutable as $$
  select ('a0240000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid
$$;
create function field_scheduling_tests.slot(n integer default 0) returns timestamptz language sql stable as $$
  select (date_trunc('day', now() at time zone 'Asia/Manila') + interval '3 days 9 hours'
    + make_interval(mins=>n)) at time zone 'Asia/Manila'
$$;
create function field_scheduling_tests.as_user(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub',field_scheduling_tests.id(n)::text,false)::text;
$$;
create function field_scheduling_tests.assert(ok boolean,message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Assertion failed: %',message; end if;
end $$;
create function field_scheduling_tests.reject(sql_text text,expected text) returns void language plpgsql as $$
begin
  begin
    execute sql_text;
  exception when others then
    if position(expected in sqlerrm)>0 then return; end if;
    raise exception 'Expected %, observed %',expected,sqlerrm;
  end;
  raise exception 'Expected % but the operation succeeded',expected;
end $$;

do $$
declare area uuid; first_dep uuid; second_dep uuid; n integer; resident uuid:=field_scheduling_tests.id(1);
begin
  select id into area from public.lb_barangays order by code limit 1;
  select id into first_dep from public.lb_departments order by code limit 1;
  select id into second_dep from public.lb_departments where id<>first_dep order by code limit 1;
  for n in 1..8 loop
    insert into auth.users(id,email,raw_user_meta_data) values(field_scheduling_tests.id(n),
      'scheduling-test-'||n||'@example.test',jsonb_build_object('barangay_id',area));
  end loop;
  update public.lb_profiles set role='worker',worker_function='dispatcher',barangay_id=null,department_id=first_dep
    where id=field_scheduling_tests.id(2);
  update public.lb_profiles set role='worker',worker_function='field',barangay_id=null,department_id=first_dep
    where id in (field_scheduling_tests.id(3),field_scheduling_tests.id(8));
  update public.lb_profiles set role='worker',worker_function='barangay_staff' where id=field_scheduling_tests.id(4);
  update public.lb_profiles set role='admin' where id=field_scheduling_tests.id(5);
  update public.lb_profiles set role='worker',worker_function='dispatcher',barangay_id=null,department_id=second_dep
    where id=field_scheduling_tests.id(6);
  insert into public.lb_resident_verifications(user_id,status)
    values(resident,'approved'),(field_scheduling_tests.id(7),'approved')
    on conflict(user_id) do update set status='approved';
  insert into public.lb_service_categories(id,name,slug,department_id,field_appointment_minutes)
    values(field_scheduling_tests.id(10),'Fixture field service','fixture-field-scheduling',first_dep,60);
  insert into storage.objects(bucket_id,owner,name)
    values('request-attachments',resident,resident||'/staged/fixture.jpg');
  insert into public.lb_attachments(owner_id,kind,storage_path,file_name,mime_type,size_bytes)
    values(resident,'request_evidence',resident||'/staged/fixture.jpg','fixture.jpg','image/jpeg',10);
  insert into storage.objects(bucket_id,owner,name)
    values('request-attachments',resident,resident||'/staged/regular.jpg');
  insert into public.lb_attachments(owner_id,kind,storage_path,file_name,mime_type,size_bytes)
    values(resident,'request_evidence',resident||'/staged/regular.jpg','regular.jpg','image/jpeg',10);
  insert into public.lb_service_requests(id,reference,title,category_id,barangay_id,department_id,submitted_by,status)
    select field_scheduling_tests.id(fixture.number),'SCHED-TEST-'||fixture.number,'Verified scheduling fixture '||fixture.number,
      field_scheduling_tests.id(10),area,first_dep,resident,'verified' from generate_series(11,14) fixture(number);
end $$;

set role authenticated;

select field_scheduling_tests.as_user(3);
select public.app_save_field_hours(
  (select jsonb_agg(jsonb_build_object('day_of_week',day,'start_time','08:00','end_time','17:00'))
    from generate_series(0,6) day)
);
select public.app_set_field_block(field_scheduling_tests.slot(240),field_scheduling_tests.slot(300));

select field_scheduling_tests.as_user(1);
select field_scheduling_tests.assert(exists(select 1 from public.app_resident_field_slots(field_scheduling_tests.id(10),
  (field_scheduling_tests.slot() at time zone 'Asia/Manila')::date) s where s=field_scheduling_tests.slot()),
  'resident sees real hours in Manila');
select field_scheduling_tests.assert(not exists(select 1 from public.app_resident_field_slots(field_scheduling_tests.id(10),
  (field_scheduling_tests.slot() at time zone 'Asia/Manila')::date) s where s=field_scheduling_tests.slot(210)),
  'duration overlaps leave even when the appointment starts before leave');
select field_scheduling_tests.reject(
  'select public.app_request_field_appointment(field_scheduling_tests.id(11),now()-interval ''1 day'')','preferred time');

do $$
declare v_request uuid; regular_request uuid; result jsonb; job_id uuid; payload jsonb;
begin
  result:=public.app_submit_resident_request_with_evidence_v2('Regular test request',
    'This request continues without an appointment.',field_scheduling_tests.id(10),'San Roque, Manila',
    field_scheduling_tests.id(1)||'/staged/regular.jpg',false,null,null,'{"map_url":"https://maps.google.com/?q=Manila"}');
  regular_request:=(result#>>'{request,id}')::uuid;
  perform field_scheduling_tests.assert(public.app_request_schedule(regular_request) is null,'regular requests do not need a preferred time');
  result:=public.app_submit_request_with_field_appointment('Resident test request',
    'Integrated selection and assignment fixture.',field_scheduling_tests.id(10),'San Roque, Manila',
    field_scheduling_tests.id(1)||'/staged/fixture.jpg',false,null,null,
    '{"map_url":"https://maps.google.com/?q=Manila"}',field_scheduling_tests.slot());
  v_request:=(result#>>'{request,id}')::uuid;
  perform field_scheduling_tests.assert(public.app_request_schedule(v_request)->>'status'='pending','resident preference is pending');

  perform field_scheduling_tests.as_user(2);
  perform public.app_propose_field_appointment(v_request,field_scheduling_tests.slot(120),'Propose a later visit');
  perform field_scheduling_tests.as_user(1);
  perform field_scheduling_tests.assert((public.app_request_schedule(v_request)->>'proposed_at')::timestamptz
    =field_scheduling_tests.slot(120),'resident sees alternate proposal');
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_notifications where request_id=v_request and event_type='appointment.proposed'),
    'alternate proposal notifies the resident');
  perform public.app_request_field_appointment(v_request,field_scheduling_tests.slot(120));
  perform field_scheduling_tests.as_user(3);
  perform public.app_set_field_block(field_scheduling_tests.slot(120),field_scheduling_tests.slot(180));

  perform field_scheduling_tests.as_user(4);
  insert into public.lb_appointments(barangay_id,resident_id,request_id,scheduled_at,purpose)
    select barangay_id,submitted_by,id,field_scheduling_tests.slot(),'Front desk appointment' from public.lb_service_requests where id=regular_request;
  perform public.app_transition_request(v_request,'for_verification');
  perform public.app_transition_request(v_request,'verified');

  perform field_scheduling_tests.as_user(6);
  perform field_scheduling_tests.reject(format('select public.app_save_field_assignment(%L,%L,field_scheduling_tests.slot(),60,''x'')',
    v_request,field_scheduling_tests.id(3)),'cannot assign');
  perform field_scheduling_tests.assert(public.app_request_schedule(v_request) is null,'unrelated dispatcher cannot see schedule');

  perform field_scheduling_tests.as_user(2);
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_dispatch_queue where id=v_request
    and appointment_status='pending'),'pending appointment reaches dispatcher queue');
  perform field_scheduling_tests.assert(jsonb_array_length(public.app_field_roster(
    (select department_id from public.lb_service_requests where id=v_request),
    (field_scheduling_tests.slot() at time zone 'Asia/Manila')::date,60,v_request))=2,'dispatcher sees department personnel');
  perform field_scheduling_tests.reject(format('select public.app_change_request_priority(%L,''urgent'')',v_request),'reason');
  perform field_scheduling_tests.reject(format('select public.app_escalate_request(%L)',v_request),'reason');
  perform field_scheduling_tests.reject(
    'select public.app_save_field_assignment(field_scheduling_tests.id(11),field_scheduling_tests.id(8),
      field_scheduling_tests.slot(),60,''x'')',
    'has no saved working hours');
  perform field_scheduling_tests.reject(
    'select public.app_save_field_assignment(field_scheduling_tests.id(11),field_scheduling_tests.id(3),
      field_scheduling_tests.slot(-90),60,''x'')',
    'outside the worker''s saved hours');
  perform field_scheduling_tests.reject(format('select public.app_save_field_assignment(%L,%L,field_scheduling_tests.slot(120),60,''x'')',
    v_request,field_scheduling_tests.id(3)),'blocked availability period');
  result:=public.app_save_field_assignment(v_request,field_scheduling_tests.id(3),field_scheduling_tests.slot(),
    60,'Private dispatcher instructions','Health and safety','urgent');
  job_id:=(result->>'assignment_id')::uuid;
  perform field_scheduling_tests.assert(public.app_request_schedule(v_request)->>'status'='confirmed','dispatch confirms booking');
  perform field_scheduling_tests.assert((public.app_save_field_assignment(v_request,field_scheduling_tests.id(3),field_scheduling_tests.slot(),
    60,'Private dispatcher instructions','Health and safety','urgent')->>'assignment_id')::uuid=job_id,'identical retry uses the assignment');
  perform field_scheduling_tests.reject('select public.app_save_field_assignment(field_scheduling_tests.id(11),field_scheduling_tests.id(3),
    field_scheduling_tests.slot(30),60,''x'')','overlaps');
  perform field_scheduling_tests.reject('select public.app_save_field_assignment(field_scheduling_tests.id(11),field_scheduling_tests.id(3),
    field_scheduling_tests.slot(240),60,''x'')','availability');
  perform field_scheduling_tests.reject('select public.app_save_field_assignment(field_scheduling_tests.id(11),field_scheduling_tests.id(3),
    now()-interval ''1 day'',60,''x'')','future');
  perform field_scheduling_tests.reject(format('update public.lb_service_requests set priority=''low'' where id=%L',v_request),'Restricted request fields');
  perform public.app_set_completion_estimate(v_request,field_scheduling_tests.slot(120),90,'Allow inspection preparation');

  perform field_scheduling_tests.as_user(7);
  perform field_scheduling_tests.assert(public.app_request_schedule(v_request) is null,'another resident sees nothing');
  perform field_scheduling_tests.as_user(1);
  payload:=public.app_request_schedule(v_request);
  perform field_scheduling_tests.assert(payload->>'status'='confirmed' and not (payload ? 'field_assignee_id' or payload ? 'notes'),
    'owner projection does not contain staff identity or instructions');
  perform field_scheduling_tests.assert(not exists(select 1 from public.lb_assignments a where a.id=job_id),'resident cannot read raw assignments');
  perform field_scheduling_tests.assert(not exists(select 1 from public.lb_appointments a where a.request_id=v_request and a.is_field_booking),
    'resident cannot read raw dispatch appointments');
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_service_requests r where r.id=v_request
    and estimated_completion_at=field_scheduling_tests.slot(120) and priority='urgent'),'resident sees the priority and revised estimate');
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_notifications n where n.request_id=v_request
    and n.event_type='request.estimate'),'estimate update notifies resident');

  perform field_scheduling_tests.as_user(8);
  perform field_scheduling_tests.reject(format('select public.app_accept_assignment(%L)',job_id),'no longer actionable');
  perform field_scheduling_tests.as_user(3);
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_assignments a where a.id=job_id
    and a.notes='Private dispatcher instructions' and a.status='pending'),'assigned worker sees the job');
  perform field_scheduling_tests.assert((select count(*)=1 from public.lb_notifications n where n.entity_id=job_id
    and n.event_type='assignment.assigned' and n.title ilike '%urgent%'),'urgent assignment sends one field notification');
  perform field_scheduling_tests.reject('select public.app_set_field_block(field_scheduling_tests.slot(),field_scheduling_tests.slot(60))',
    'overlaps a booked job');
  perform field_scheduling_tests.reject('select public.app_save_field_hours(''[]'')','conflict with a booked job');
  perform public.app_accept_assignment(job_id);
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_assignments a where a.id=job_id and a.status='accepted'),'acceptance does not start work');
  perform public.app_start_field_job(job_id);
  perform public.app_update_job_progress(job_id,'On site and assessing the request.');

  perform field_scheduling_tests.as_user(2);
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_assignments a where a.id=job_id
    and a.status='in_progress' and a.progress_notes='On site and assessing the request.'),'dispatcher sees progress');
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_notifications n where n.request_id=v_request
    and n.event_type='assignment.accepted'),'dispatcher sees acceptance notice');

  perform field_scheduling_tests.as_user(3);
  perform public.app_report_field_job(job_id,'delayed','Waiting for equipment.');
  perform public.app_report_field_job(job_id,'delayed','Waiting for equipment.');
  perform public.app_complete_job(job_id,'Service work is complete.');
  perform field_scheduling_tests.as_user(2);
  perform field_scheduling_tests.assert((select count(*)=1 from public.lb_notifications n where n.request_id=v_request
    and n.event_type='assignment.delayed'),'repeated delay reports do not duplicate notices');
  perform field_scheduling_tests.as_user(1);
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_service_requests r where r.id=v_request and r.status='for_inspection')
    and public.app_request_schedule(v_request)->>'status'='completed','completion waits for request inspection');
  perform field_scheduling_tests.as_user(4);
  perform public.app_transition_request(v_request,'resolved','Inspected.');
  perform field_scheduling_tests.as_user(1);
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_notifications n where n.request_id=v_request
    and n.event_type='request.resolved'),'inspection completion notifies resident');

  perform field_scheduling_tests.as_user(2);
  perform public.app_save_field_assignment(field_scheduling_tests.id(11),field_scheduling_tests.id(3),field_scheduling_tests.slot(),60,'New job');
  perform public.app_save_field_assignment(field_scheduling_tests.id(11),field_scheduling_tests.id(3),field_scheduling_tests.slot(60),60,'New job','Traffic');
  perform field_scheduling_tests.assert(public.app_request_schedule(field_scheduling_tests.id(11))->>'status'='rescheduled','rescheduled time is persisted');
  perform public.app_cancel_field_appointment(field_scheduling_tests.id(11),'Resident requested cancellation');
  perform field_scheduling_tests.assert(public.app_request_schedule(field_scheduling_tests.id(11))->>'status'='cancelled','cancellation is persisted');
  perform public.app_save_field_assignment(field_scheduling_tests.id(12),field_scheduling_tests.id(3),field_scheduling_tests.slot(60),60,'Reused slot');
  perform field_scheduling_tests.assert(public.app_request_schedule(field_scheduling_tests.id(12))->>'status'='confirmed','cancellation releases the slot');
  perform field_scheduling_tests.as_user(8);
  perform public.app_save_field_hours((select jsonb_agg(jsonb_build_object('day_of_week',day,'start_time','08:00','end_time','17:00'))
    from generate_series(0,6) day));
  perform field_scheduling_tests.as_user(2);
  perform public.app_save_field_assignment(field_scheduling_tests.id(12),field_scheduling_tests.id(8),
    field_scheduling_tests.slot(60),60,'Reused slot','Coverage changed.');
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_assignments a where a.request_id=field_scheduling_tests.id(12)
    and a.assigned_to=field_scheduling_tests.id(3) and a.status='cancelled'),'reassignment preserves the former assignment as history');
  perform public.app_set_working_day_estimate(field_scheduling_tests.id(12),2,'Two days for follow-up');
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_service_requests where id=field_scheduling_tests.id(12)
    and (estimated_completion_at at time zone 'Asia/Manila')::time='17:00'
    and estimated_completion_at > field_scheduling_tests.slot()+interval '1 day'),'business-day estimate uses the worker calendar');
  perform public.app_set_completion_estimate(field_scheduling_tests.id(12),null,null,'Awaiting revised scope');
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_dispatch_queue where id=field_scheduling_tests.id(12)
    and estimated_completion_at is null),'explicitly clearing an estimate does not restore the old booking end');

  perform field_scheduling_tests.as_user(5);
  perform field_scheduling_tests.assert((public.app_dispatch_overview()->>'completed')::integer>=1,'admin sees completed work');
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_audit_logs where entity_id=v_request::text
    and action='request.priority_changed' and details->>'reason'='Health and safety'),'priority reason is audited');
  perform field_scheduling_tests.assert(exists(select 1 from public.lb_audit_logs where entity_id=v_request::text
    and action='request.estimate_changed'),'estimate history is audited');
end $$;
reset role;
select set_config('request.jwt.claim.sub','',false);

update public.lb_service_requests set estimated_completion_at=now()-interval '1 day',estimate_recorded_at=now()
  where id=field_scheduling_tests.id(12);
update public.lb_service_requests set priority='urgent' where id=field_scheduling_tests.id(14);
update public.lb_service_requests set priority_changed_at=now()-interval '1 day' where id=field_scheduling_tests.id(14);
insert into public.lb_settings(key,value) values('dispatch_alerts','{"urgent_unassigned_minutes":20}');
select public.app_send_dispatch_reminders();
select public.app_send_dispatch_reminders();
select field_scheduling_tests.assert((select count(*)=1 from public.lb_notifications
  where request_id=field_scheduling_tests.id(12) and event_type='assignment.overdue'),'backend overdue reminder is deduplicated');
select field_scheduling_tests.assert((select count(*)=1 from public.lb_notifications
  where request_id=field_scheduling_tests.id(14) and event_type='request.urgent_unassigned'),'threshold-based urgent reminder is deduplicated');
