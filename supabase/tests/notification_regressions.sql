-- Continued regression checks in the disposable database, after notifications.sql.
\set QUIET 1
\o /dev/null
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select (public.app_submit_resident_request('Reopened assignment regression',
 'Verify historical assignments are never revived by a reopened request',
 '30000000-0000-0000-0000-000000000001','Test location')->'request'->>'id') as id \gset cycle_request_
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
select public.app_transition_request(:'cycle_request_id','verified',null,
 '{"department_id":"20000000-0000-0000-0000-000000000001"}');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);
select (public.app_assign_field(:'cycle_request_id','00000000-0000-0000-0000-000000000401')->>'assignment_id') as id \gset cycle_first_
select public.app_assign_field(:'cycle_request_id','00000000-0000-0000-0000-000000000402');
select (public.app_assign_field(:'cycle_request_id','00000000-0000-0000-0000-000000000401')->>'assignment_id') as id \gset cycle_completed_
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select public.app_complete_job(:'cycle_completed_id');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
select public.app_transition_request(:'cycle_request_id','resolved');
select public.app_transition_request(:'cycle_request_id','for_verification');
select notification_tests.assert((select assigned_to is null from public.lb_service_requests where id=:'cycle_request_id'),
 'reopening releases the former field responsibility');
select public.app_transition_request(:'cycle_request_id','verified');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);
select (public.app_assign_field(:'cycle_request_id','00000000-0000-0000-0000-000000000401')->>'assignment_id') as id \gset cycle_next_
select notification_tests.assert(:'cycle_next_id'<>:'cycle_first_id' and :'cycle_next_id'<>:'cycle_completed_id',
 'reopened A to B to A request receives a new actual assignment');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select notification_tests.expect_denied(format('select public.app_accept_assignment(%L)',:'cycle_first_id'),
 'old pending assignment cannot revive after same worker is assigned again');
select public.app_accept_assignment(:'cycle_next_id');
reset role;
select notification_tests.assert((select status='in_progress' from public.lb_assignments where id=:'cycle_next_id'),
 'newest assignment remains actionable after reopened cycle');

-- Rerouting invalidates the old responsibility and sends generic old-scope notices.
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
select public.app_transition_request(:'cycle_request_id','assigned',null,
 '{"department_id":"20000000-0000-0000-0000-000000000002"}');
reset role;
select notification_tests.assert((select assigned_to is null and assigned_by is null
 from public.lb_service_requests where id=:'cycle_request_id'), 'department reroute releases previous assignment');
select notification_tests.assert(notification_tests.new_count(401)=1,'previous field worker receives one generic reroute notice');
select notification_tests.assert(notification_tests.new_count(301)=1,'previous department dispatcher receives a generic scope-change notice');
select notification_tests.assert(notification_tests.new_count(302)=1,'new department receives its routed workflow event');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select notification_tests.expect_denied(format('select public.app_update_job_progress(%L,%L)',:'cycle_next_id','Wrong department update'),
 'field progress is denied after request department changes');
reset role;
select notification_tests.snapshot();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
select public.app_transition_request(:'cycle_request_id','assigned',null,
 '{"department_id":"20000000-0000-0000-0000-000000000002"}');
reset role;
select notification_tests.assert(not exists(select 1 from public.lb_notifications n
 where not exists(select 1 from notification_tests.before_event b where b.id=n.id)),
 'same-status same-department retry creates no notification');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',false);
select public.app_transition_request(:'cycle_request_id','assigned',null,
 '{"department_id":"20000000-0000-0000-0000-000000000001"}');
reset role;
select notification_tests.assert(notification_tests.new_count(301)=1,
 'same-status real department change still creates a routed event');
select notification_tests.assert(exists(select 1 from pg_policies where schemaname='public'
 and tablename='lb_notifications' and policyname='lb_notifications_recipient_guard' and permissive='RESTRICTIVE'),
 'recipient boundary also restricts unknown legacy permissive policies');
select notification_tests.assert(not has_table_privilege('anon','public.lb_notifications','SELECT'),
 'legacy anonymous SELECT privilege is removed');
select notification_tests.assert(not has_column_privilege('anon','public.lb_notifications','title','SELECT'),
 'legacy anonymous column SELECT privilege is also removed');

-- Fixed request for the separate concurrent-client regression in the harness.
select set_config('request.jwt.claim.sub','',false);
insert into public.lb_service_requests(id,title,description,submitted_by,barangay_id)
values('40000000-0000-0000-0000-000000000077','Concurrent status regression',
 'Two simultaneous transitions must commit one event','00000000-0000-0000-0000-000000000101',
 '10000000-0000-0000-0000-000000000001');
\o
\echo 'Additional notification regression checks completed.'
