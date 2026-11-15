-- Runs only in scripts/test-notifications-db.sh's disposable PostgreSQL DB.
\set QUIET 1
\o /dev/null
create schema notification_tests;
create function notification_tests.assert(ok boolean, label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function notification_tests.expect_denied(command text, label text) returns void
language plpgsql as $$ begin
  begin
    execute command;
  exception when insufficient_privilege or raise_exception then
    raise notice 'PASS: %', label;
    return;
  end;
  raise exception 'FAIL: % (operation was allowed)', label;
end $$;
grant usage on schema notification_tests to authenticated, anon;
grant execute on all functions in schema notification_tests to authenticated, anon;
select notification_tests.assert(exists(select 1 from public.lb_notifications
 where id='50000000-0000-0000-0000-000000000001' and title='Legacy notification'
 and message='Saved before migration 0015' and is_read=false and event_type is null),
 '0015 preserves legacy notification contents and read state');

insert into public.lb_barangays(id,name,code) values
 ('10000000-0000-0000-0000-000000000001','Notification Test A','NTA'),
 ('10000000-0000-0000-0000-000000000002','Notification Test B','NTB');
insert into public.lb_departments(id,name,code) values
 ('20000000-0000-0000-0000-000000000001','Notification Department A','NDA'),
 ('20000000-0000-0000-0000-000000000002','Notification Department B','NDB');
insert into public.lb_service_categories(id,name,slug,department_id) values
 ('30000000-0000-0000-0000-000000000001','Notification Category','notification-test',
  '20000000-0000-0000-0000-000000000001');
insert into auth.users(id,email,raw_user_meta_data)
select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  'notifications-' || n || '@example.test',
  jsonb_build_object('full_name','Test ' || n,'barangay_id',
    case when n in (103,202,212,222,503) then '10000000-0000-0000-0000-000000000002'
    else '10000000-0000-0000-0000-000000000001' end)
from unnest(array[101,102,103,201,202,211,212,221,222,301,302,401,402,403,404,501,502,503]) n;
update public.lb_profiles set role='worker', worker_function=case
  when id::text like '%000201' or id::text like '%000202' then 'secretary'
  when id::text like '%000211' or id::text like '%000212' then 'officer'
  when id::text like '%000221' or id::text like '%000222' then 'captain'
  when id::text like '%000301' or id::text like '%000302' then 'dispatcher'
  else 'field' end,
  department_id=case when id::text like '%000302' or id::text like '%000403'
    then '20000000-0000-0000-0000-000000000002'::uuid
    else '20000000-0000-0000-0000-000000000001'::uuid end
where id::text between '00000000-0000-0000-0000-000000000201' and '00000000-0000-0000-0000-000000000404';
update public.lb_profiles set role='admin' where id::text like '%000501' or id::text like '%000502' or id::text like '%000503';
update public.lb_profiles set barangay_id=null where id::text like '%000502';
update public.lb_profiles set status='inactive' where id::text like '%000404';
-- Clear seed-generated events only in this disposable fixture DB.
truncate public.lb_notifications;
create table notification_tests.before_event as select id,user_id from public.lb_notifications;
create function notification_tests.snapshot() returns void language sql as $$
  truncate notification_tests.before_event;
  insert into notification_tests.before_event select id,user_id from public.lb_notifications;
$$;
create function notification_tests.new_count(recipient integer) returns bigint language sql as $$
  select count(*) from public.lb_notifications n where
    n.user_id=('00000000-0000-0000-0000-' || lpad(recipient::text,12,'0'))::uuid
    and not exists (select 1 from notification_tests.before_event b where b.id=n.id)
$$;

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select (public.app_submit_resident_request('Road repair test','A sufficiently detailed road repair request',
 '30000000-0000-0000-0000-000000000001','Test location')->'request'->>'id') as id \gset request_
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'submission acknowledged exactly once to resident');
select notification_tests.assert(notification_tests.new_count(201)=1,'new request reaches same-barangay secretary');
select notification_tests.assert(notification_tests.new_count(202)=0,'new request excludes other-barangay secretary');
select notification_tests.assert(notification_tests.new_count(102)=0 and notification_tests.new_count(103)=0,'submission excludes unrelated residents');
select notification_tests.assert(notification_tests.new_count(401)=0 and notification_tests.new_count(403)=0,'unassigned field workers receive no intake event');
select notification_tests.assert(notification_tests.new_count(503)=0,'other-barangay admin receives no scoped intake');

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
select public.app_transition_request(:'request_id','for_verification');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives verification queue status');
select notification_tests.assert(notification_tests.new_count(211)=1,'barangay officer receives verification task');
select notification_tests.assert(notification_tests.new_count(212)=0 and notification_tests.new_count(202)=0,'verification excludes unrelated barangay staff');

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000211',false);
select public.app_transition_request(:'request_id','needs_information','Please supply a document');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives additional information request');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select public.app_reply_info_request(:'request_id','I have provided the requested details');
reset role;
select notification_tests.assert(notification_tests.new_count(201)=1 and notification_tests.new_count(211)=1,'information reply reaches intake and review staff once each');
select notification_tests.assert(notification_tests.new_count(202)=0 and notification_tests.new_count(212)=0,'information reply excludes other barangay');

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000211',false);
select public.app_transition_request(:'request_id','verified');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives verified event exactly once');
select notification_tests.assert(notification_tests.new_count(301)=0,'unrouted verified request sends no department notification');
select notification_tests.assert(notification_tests.new_count(302)=0,'verified request excludes other-department dispatcher');

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000211',false);
select public.app_transition_request(:'request_id','assigned',null,
 '{"department_id":"20000000-0000-0000-0000-000000000001"}');
reset role;
select notification_tests.assert(notification_tests.new_count(301)=1,'routed request reaches selected department dispatcher');
select notification_tests.assert(notification_tests.new_count(302)=0,'routed request excludes unrelated department dispatcher');

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);
select (public.app_assign_field(:'request_id','00000000-0000-0000-0000-000000000401',now()+interval '1 day',now()+interval '2 days','Bring tools')->>'assignment_id') as id \gset assignment_
reset role;
select notification_tests.assert(notification_tests.new_count(401)=1,'assigned field worker receives exactly one job event');
select notification_tests.assert(notification_tests.new_count(402)=0 and notification_tests.new_count(403)=0 and notification_tests.new_count(404)=0,'assignment excludes unrelated and inactive field workers');
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives assignment progress');
select notification_tests.assert(exists(select 1 from public.lb_notifications where user_id='00000000-0000-0000-0000-000000000401' and destination_view='job-detail' and entity_id=:'assignment_id'::uuid),'assignment notification points to actual job');

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select public.app_accept_assignment(:'assignment_id');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives accepted/in-progress once');
select notification_tests.assert(notification_tests.new_count(301)=1,'dispatcher receives accepted work once');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select public.app_update_job_progress(:'assignment_id','Repairs are halfway complete');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1 and notification_tests.new_count(301)=1,'field progress reaches resident and department dispatcher once');
select notification_tests.assert(notification_tests.new_count(302)=0 and notification_tests.new_count(102)=0,'field progress excludes unrelated users');

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select public.app_complete_job(:'assignment_id','Work completed');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1 and notification_tests.new_count(301)=1,'completion reaches resident and dispatcher once');
select notification_tests.assert(notification_tests.new_count(211)=1 and notification_tests.new_count(221)=1,'inspection reaches appropriate officer and captain');
select notification_tests.assert(notification_tests.new_count(212)=0 and notification_tests.new_count(222)=0,'inspection excludes unrelated barangay');

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000211',false);
select public.app_escalate_request(:'request_id','Needs priority intervention');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1 and notification_tests.new_count(221)=1,'escalation reaches owner and captain');
select notification_tests.assert(notification_tests.new_count(503)=1,'escalation reaches existing globally authorized administrator');
select notification_tests.assert(notification_tests.new_count(301)=1 and notification_tests.new_count(302)=0,'escalation respects dispatcher department');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000211',false);
select public.app_transition_request(:'request_id','resolved');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives resolution');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select public.app_transition_request(:'request_id','for_verification','Reopening for follow-up');
reset role;
select notification_tests.assert(notification_tests.new_count(211)=1,'reopened request returns to review');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000211',false);
select public.app_transition_request(:'request_id','rejected','Unsupported request after review');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives rejection');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000211',false);
select public.app_add_comment(:'request_id','A repeated but legitimate update');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'first legitimate comment persists once');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000211',false);
select public.app_add_comment(:'request_id','A repeated but legitimate update');
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'identical later comment is a distinct event, not suppressed');

-- Appointment create, reschedule, status and no-op update.
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
insert into public.lb_appointments(barangay_id,resident_id,request_id,scheduled_at,purpose,created_by)
values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101',:'request_id',now()+interval '3 days','Request consultation',auth.uid()) returning id \gset appointment_
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives appointment creation');
select notification_tests.assert(notification_tests.new_count(102)=0 and notification_tests.new_count(202)=0,'appointment excludes unrelated accounts');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
update public.lb_appointments set scheduled_at=scheduled_at+interval '1 day' where id=:'appointment_id';
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives rescheduled appointment');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
update public.lb_appointments set status='cancelled' where id=:'appointment_id';
reset role;
select notification_tests.assert(notification_tests.new_count(101)=1,'resident receives cancelled appointment');
select notification_tests.snapshot();
update public.lb_appointments set status=status where id=:'appointment_id';
select notification_tests.assert(not exists(select 1 from public.lb_notifications n where not exists(select 1 from notification_tests.before_event b where b.id=n.id)),'no-op appointment update sends nothing');

-- Account updates persist for suspended users, but suspended users cannot read.
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
update public.lb_profiles set status='suspended' where id='00000000-0000-0000-0000-000000000102';
reset role;
select notification_tests.assert(notification_tests.new_count(102)=1,'suspension event persists for affected account');
select notification_tests.assert(exists(select 1 from public.lb_audit_logs where entity_id='00000000-0000-0000-0000-000000000102' and action='account.update'),'account notification preserves audit logging');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',false);
select notification_tests.assert((select count(*)=0 from public.lb_notifications),'suspended user cannot read notification history');
select notification_tests.expect_denied('select public.app_mark_notifications_read()', 'suspended user cannot mark notifications read');
reset role;
select set_config('request.jwt.claim.sub','',false);
update public.lb_profiles set status='active' where id='00000000-0000-0000-0000-000000000102';

select notification_tests.snapshot();
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000601','pending-notifications@example.test',
 '{"full_name":"Pending Worker","requested_role":"worker","barangay_id":"10000000-0000-0000-0000-000000000001"}');
select notification_tests.assert(notification_tests.new_count(501)=1,'pending registration reaches responsible admin');
select notification_tests.assert(notification_tests.new_count(503)=1,'account review reaches existing globally authorized administrator');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
update public.lb_profiles set role='worker',worker_function='secretary',status='active'
 where id='00000000-0000-0000-0000-000000000601';
reset role;
select notification_tests.assert(notification_tests.new_count(601)=1,'account approval and role change reach affected account once');

select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
update public.lb_settings set value=jsonb_set(value,'{verification_hours}','25') where key='sla';
reset role;
select notification_tests.assert(notification_tests.new_count(101)=0 and notification_tests.new_count(401)=0,'configuration change excludes residents and field personnel');
select notification_tests.assert(notification_tests.new_count(502)=1,'system configuration change reaches another system administrator');

-- Requested documents are scoped to the existing request relationship.
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
insert into public.lb_attachments(request_id,owner_id,storage_path,file_name,mime_type,kind)
values(:'request_id',auth.uid(),'test/document.pdf','document.pdf','application/pdf','reply_doc');
reset role;
select notification_tests.assert(notification_tests.new_count(201)=1 and notification_tests.new_count(211)=1,'resident document upload reaches intake and reviewer');
select notification_tests.assert(notification_tests.new_count(202)=0 and notification_tests.new_count(212)=0,'document upload excludes another barangay');

-- Decline/reassignment uses the unified trail instead of legacy double fanout.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select (public.app_submit_resident_request('Assignment decline test','Request requiring field personnel assignment',
 '30000000-0000-0000-0000-000000000001','Test location')->'request'->>'id') as id \gset decline_request_
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
select public.app_transition_request(:'decline_request_id','verified',null,
 '{"department_id":"20000000-0000-0000-0000-000000000001"}');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);
select (public.app_assign_field(:'decline_request_id','00000000-0000-0000-0000-000000000402')->>'assignment_id') as id \gset decline_assignment_
reset role;
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',false);
select public.app_decline_assignment(:'decline_assignment_id','Equipment is unavailable');
reset role;
select notification_tests.assert(notification_tests.new_count(301)=1,'decline creates one dispatcher reassignment notification');
select notification_tests.assert(notification_tests.new_count(101)=1,'decline creates one resident update');
select notification_tests.assert(notification_tests.new_count(302)=0 and notification_tests.new_count(403)=0,'decline excludes unrelated department');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);
select (public.app_assign_field(:'decline_request_id','00000000-0000-0000-0000-000000000401')->>'assignment_id') as id \gset replacement_assignment_
reset role;
select notification_tests.assert(notification_tests.new_count(401)=1,'replacement field worker receives reassignment');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);
select notification_tests.assert((public.app_assign_field(:'decline_request_id','00000000-0000-0000-0000-000000000401')->>'assignment_id')=:'replacement_assignment_id','repeated assignment returns same persisted job');
reset role;
select notification_tests.assert(not exists(select 1 from public.lb_notifications n where not exists(select 1 from notification_tests.before_event b where b.id=n.id)),'assignment retry produces no duplicate notifications');
select notification_tests.snapshot();
select set_config('request.jwt.claim.sub','',false);
update public.lb_assignments set schedule_at=now()+interval '4 days',deadline_at=now()+interval '5 days'
 where id=:'replacement_assignment_id';
select notification_tests.assert(notification_tests.new_count(401)=1,'trusted schedule/deadline change reaches assigned field worker');
select notification_tests.snapshot();
update public.lb_assignments set notes='Dispatcher instruction: use the back entrance' where id=:'replacement_assignment_id';
select notification_tests.assert(notification_tests.new_count(401)=1,'dispatcher instructions reach assigned field worker');
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);
select (public.app_assign_field(:'decline_request_id','00000000-0000-0000-0000-000000000402')->>'assignment_id') as id \gset reassigned_assignment_
reset role;
select notification_tests.assert(notification_tests.new_count(401)=1,'previous field worker receives assignment change notice');
select notification_tests.assert(notification_tests.new_count(402)=1,'new field worker receives one reassigned job notice');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select notification_tests.expect_denied(format('select public.app_accept_assignment(%L)',:'replacement_assignment_id'),'previous field worker cannot accept old job');
select notification_tests.expect_denied(format('select public.app_update_job_progress(%L,%L)',:'replacement_assignment_id','Forged progress'),'previous field worker cannot update old job');
select notification_tests.expect_denied(format('select public.app_complete_job(%L)',:'replacement_assignment_id'),'previous field worker cannot complete old job');
select notification_tests.expect_denied(format('select public.app_decline_assignment(%L,%L)',:'replacement_assignment_id','Forged decline'),'previous field worker cannot decline old job');
select notification_tests.expect_denied(format('select public.app_add_comment(%L,%L)',:'decline_request_id','Forged old participant comment'),'previous field worker cannot comment through historical assignment');
reset role;
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
update public.lb_profiles set status='suspended' where id='00000000-0000-0000-0000-000000000402';
reset role;
select notification_tests.assert(notification_tests.new_count(301)=1 and notification_tests.new_count(302)=0,'field availability loss reaches active-assignment department dispatcher');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',false);
select notification_tests.expect_denied(format('select public.app_accept_assignment(%L)',:'reassigned_assignment_id'),'suspended field worker cannot accept current job');
reset role;
select set_config('request.jwt.claim.sub','',false);
update public.lb_profiles set status='active' where id='00000000-0000-0000-0000-000000000402';

-- Appointment mutation cannot create notification leaks through forged links.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
select notification_tests.expect_denied(
 'insert into public.lb_appointments(barangay_id,resident_id,scheduled_at,purpose) values(''10000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000103'',now(),''Forged cross-scope appointment'')',
 'secretary cannot schedule appointment for another-barangay resident');
select notification_tests.expect_denied(
 format('insert into public.lb_appointments(barangay_id,resident_id,request_id,scheduled_at,purpose) values(%L,%L,%L,now(),%L)',
 '10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102',:'request_id','Wrong resident owner'),
 'secretary cannot attach unrelated resident to request appointment');
select notification_tests.expect_denied(
 'select public.app_emit_notification(''00000000-0000-0000-0000-000000000102'',''forged-event'',''forged'',''Forged'',''Forged'')',
 'private delivery helper cannot be invoked by API user');
reset role;

-- History survives removal of a related request with a safe null relationship.
select set_config('request.jwt.claim.sub','',false);
insert into public.lb_service_requests(id,title,description,barangay_id,submitted_by)
values('40000000-0000-0000-0000-000000000098','Deleted request test','Notification history should remain',
 '10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101');
select id as id from public.lb_notifications
 where request_id='40000000-0000-0000-0000-000000000098' and user_id='00000000-0000-0000-0000-000000000101' \gset deleted_request_notification_
delete from public.lb_service_requests where id='40000000-0000-0000-0000-000000000098';
select notification_tests.assert(exists(select 1 from public.lb_notifications where id=:'deleted_request_notification_id' and request_id is null),'deleting related request preserves notification history');

-- Persisted history, exact counts >99, and read isolation.
insert into public.lb_notifications(user_id,title,message)
select '00000000-0000-0000-0000-000000000101','Persisted history ' || n,'Database fixture for counting'
from generate_series(1,105) n;
select id as id from public.lb_notifications where user_id='00000000-0000-0000-0000-000000000101' and not is_read limit 1 \gset own_
select id as id from public.lb_notifications where user_id='00000000-0000-0000-0000-000000000102' and not is_read limit 1 \gset other_
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select notification_tests.assert((select count(*)>100 from public.lb_notifications where not is_read),'unread SQL count includes entire history beyond page limit');
select notification_tests.assert((select count(*)=0 from public.lb_notifications where user_id<>'00000000-0000-0000-0000-000000000101'),'resident sees only own notifications');
select notification_tests.expect_denied('insert into public.lb_notifications(user_id,title,message) values(''00000000-0000-0000-0000-000000000102'',''Forged'',''Forged'')','resident cannot forge notifications');
select notification_tests.expect_denied('update public.lb_notifications set title=''Forged''','resident cannot edit notification contents');
select notification_tests.expect_denied('update public.lb_notifications set user_id=''00000000-0000-0000-0000-000000000102''','resident cannot change notification owner');
select notification_tests.expect_denied('select public.app_mark_notifications_read(null,''00000000-0000-0000-0000-000000000102'')','stale expected identity rejects mark-all');
select notification_tests.assert(public.app_mark_notifications_read(:'other_id')=0,'read RPC cannot mark another user notification');
select notification_tests.assert(public.app_mark_notifications_read(:'own_id')=1,'individual read RPC changes own row once');
select notification_tests.assert(exists(select 1 from public.lb_notifications where id=:'own_id' and is_read and read_at is not null and read_at<=now()),'individual read persists a server timestamp');
select notification_tests.assert(public.app_mark_notifications_read(:'own_id')=0,'individual read is idempotent');
select public.app_mark_notifications_read();
select notification_tests.assert((select count(*)=0 from public.lb_notifications where not is_read),'mark-all clears actual unread history beyond page limit');
reset role;
select notification_tests.assert(exists(select 1 from public.lb_notifications where id=:'other_id' and not is_read),'mark-all preserves unrelated user read states');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select notification_tests.assert((select count(*)>100 from public.lb_notifications),'history persists across role/session reset');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
select notification_tests.assert((select count(*)=0 from public.lb_notifications where user_id='00000000-0000-0000-0000-000000000101'),'administrator cannot read resident notification history');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',false);
select notification_tests.assert((select count(*)=0 from public.lb_notifications where user_id='00000000-0000-0000-0000-000000000101'),'other-barangay staff cannot read resident notification history');
reset role;

-- Workflow and notification insert roll back together.
select set_config('request.jwt.claim.sub','',false);
select count(*) as count from public.lb_notifications \gset rollback_
begin;
insert into public.lb_service_requests(id,title,description,barangay_id,submitted_by)
values('40000000-0000-0000-0000-000000000099','Rolled back request','Must not persist',
'10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101');
rollback;
select notification_tests.assert((select count(*)=:'rollback_count'::bigint from public.lb_notifications),'rolled-back workflow leaves no notification');
select notification_tests.assert(not exists(select 1 from public.lb_service_requests where id='40000000-0000-0000-0000-000000000099'),'rolled-back workflow leaves no request');
select notification_tests.assert(not exists(select 1 from public.lb_notifications group by user_id,event_key having event_key is not null and count(*)>1),'one notification per recipient/event key');
select notification_tests.assert(exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='lb_notifications'),'notifications table belongs to Realtime publication');
select notification_tests.assert(exists(select 1 from pg_publication where pubname='supabase_realtime' and pubinsert and pubupdate),'Realtime publication includes insert and read-state updates');
set role anon;
select notification_tests.expect_denied('select public.app_mark_notifications_read()','unauthenticated users cannot invoke read RPC');
select notification_tests.expect_denied('select count(*) from public.lb_notifications','unauthenticated role cannot select notifications despite legacy grant');
reset role;
\o
\echo 'Database notification integration checks completed.'
