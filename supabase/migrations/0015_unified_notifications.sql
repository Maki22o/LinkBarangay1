-- LinkBarangay 0015: one transactional notification stream. Apply after 0014.
-- Existing notifications, request history, roles, audit logging and workflow
-- permissions are preserved. No browser is trusted to generate notifications.
begin;

alter table public.lb_notifications
  add column if not exists event_type text,
  add column if not exists destination_view text,
  add column if not exists entity_id uuid,
  add column if not exists event_key text;

create unique index if not exists lb_notifications_event_recipient_key
  on public.lb_notifications(user_id, event_key) where event_key is not null;
create index if not exists lb_notifications_unread_idx
  on public.lb_notifications(user_id) where is_read = false;
create index if not exists lb_notifications_history_idx
  on public.lb_notifications(user_id, created_at desc, id desc);
create index if not exists lb_assignments_latest_responsibility_idx
  on public.lb_assignments(request_id, assigned_to, created_at desc, id desc);

-- Preserve history when a trusted operator deletes the related request. This
-- changes only the notification FK's delete action, never deletes/backfills rows.
do $$ declare c record; begin
  for c in select conname from pg_constraint
    where conrelid = 'public.lb_notifications'::regclass and contype = 'f'
      and confrelid = 'public.lb_service_requests'::regclass
  loop
    execute format('alter table public.lb_notifications drop constraint %I', c.conname);
  end loop;
  alter table public.lb_notifications add constraint lb_notifications_request_id_fkey
    foreign key(request_id) references public.lb_service_requests(id) on delete set null;
end $$;

-- Private helper: recipients are resolved by the trigger, never supplied by an
-- API caller. Event keys identify a committed source row/event, not its wording.
create or replace function public.app_emit_notification(
  p_user_id uuid, p_event_key text, p_event_type text, p_title text,
  p_message text, p_request_id uuid default null,
  p_destination_view text default null, p_entity_id uuid default null,
  p_include_inactive boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return; end if;
  if not exists (select 1 from public.lb_profiles p where p.id = p_user_id
    and (p.status = 'active' or p_include_inactive)) then return; end if;
  insert into public.lb_notifications
    (user_id,event_key,event_type,title,message,request_id,destination_view,entity_id,is_read)
  values (p_user_id,p_event_key,p_event_type,left(p_title,150),left(p_message,600),
    p_request_id,p_destination_view,p_entity_id,false)
  on conflict(user_id,event_key) where event_key is not null do nothing;
end $$;
revoke all on function public.app_emit_notification(uuid,text,text,text,text,uuid,text,uuid,boolean)
  from public, anon, authenticated;

-- Current database scope, independent of the actor's JWT or browser role.
create or replace function public.app_notification_can_access_request(p_user_id uuid,p_request_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.lb_profiles p
    join public.lb_service_requests r on r.id = p_request_id
    where p.id = p_user_id and p.status = 'active' and (
      p.id = r.submitted_by or p.role = 'admin' or (p.role = 'worker' and (
        (p.worker_function in ('secretary','officer','captain') and p.barangay_id = r.barangay_id)
        or (p.worker_function = 'dispatcher' and p.department_id = r.department_id)
        or (p.worker_function = 'field' and p.id = r.assigned_to)
      ))));
$$;
revoke all on function public.app_notification_can_access_request(uuid,uuid) from public,anon,authenticated;

-- Replace, rather than overlap, the legacy request-update notification trigger.
-- All existing submit/transition/comment/reply/escalate/job RPCs write this trail.
create or replace function public.app_notify_on_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.lb_service_requests;
  p public.lb_profiles;
  v_created boolean;
  v_type text;
  v_title text;
  v_message text;
  v_staff boolean;
  v_job_id uuid;
begin
  select * into r from public.lb_service_requests where id = new.request_id;
  if not found then return new; end if;
  v_created := new.type = 'status_change' and new.previous_status is null and new.new_status = 'submitted';
  v_type := case when v_created then 'request.received'
    when new.type = 'status_change' then 'request.' || coalesce(new.new_status,'updated')
    else 'request.' || new.type end;
  v_title := case when v_created then 'New Request Received'
    when new.type = 'info_reply' then 'Requested Information Received'
    when new.type = 'assignment' then 'Request Assigned'
    when new.type = 'reassign' then 'Assignment Declined — Reassignment Needed'
    when new.type = 'escalation' then 'Request Escalated'
    when new.type = 'reopen' then 'Request Reopened'
    when new.type = 'comment' then 'Request Update'
    when new.new_status = 'for_verification' then 'Request Awaiting Verification'
    when new.new_status = 'needs_information' then 'Additional Information Required'
    when new.new_status = 'verified' then 'Request Verified'
    when new.new_status = 'assigned' then 'Request Forwarded for Processing'
    when new.new_status = 'in_progress' then 'Work Started'
    when new.new_status = 'for_inspection' then 'Work Completed — Review Required'
    when new.new_status = 'resolved' then 'Request Resolved'
    when new.new_status = 'closed' then 'Request Closed'
    when new.new_status = 'rejected' then 'Request Rejected'
    else 'Request Updated' end;
  v_message := coalesce(r.reference,'Request') || ': ' || case when v_created
    then 'Your request has been received. The intake team will review it.'
    else v_title || case when nullif(new.remarks,'') is not null then '. ' || left(new.remarks,300) else '.' end end;

  for p in select * from public.lb_profiles where status = 'active' and (
    id in (r.submitted_by,r.assigned_to,r.needs_info_by)
    or (role = 'worker' and (barangay_id = r.barangay_id or department_id = r.department_id))
    or (role = 'admin' and (new.type = 'escalation' or v_created)))
  loop
    v_staff := false;
    if p.role = 'worker' then
      v_staff := (
        (p.worker_function in ('secretary','officer') and p.barangay_id = r.barangay_id and v_created)
        or (p.worker_function in ('officer','captain') and p.barangay_id = r.barangay_id
          and (new.new_status in ('for_verification','for_inspection') or new.type in ('reopen','escalation')))
        or (p.worker_function = 'secretary' and p.barangay_id = r.barangay_id and new.type = 'info_reply')
        or (p.worker_function = 'captain' and p.barangay_id = r.barangay_id and new.new_status in ('resolved','rejected'))
        or (p.worker_function = 'officer' and p.barangay_id = r.barangay_id and new.new_status = 'verified' and r.department_id is null)
        or (p.worker_function = 'dispatcher' and p.department_id = r.department_id
          and (new.new_status in ('verified','assigned','in_progress','for_inspection','resolved','closed','rejected')
            or new.type in ('reassign','escalation')
            or (new.type = 'comment' and new.actor_id in (r.assigned_to,r.submitted_by))))
        or (new.type = 'comment' and new.actor_id = r.submitted_by and p.barangay_id = r.barangay_id
          and ((p.worker_function in ('secretary','officer') and r.status in ('submitted','for_verification','needs_information'))
            or (p.worker_function in ('officer','captain') and r.status = 'for_inspection')))
        or (p.id = r.needs_info_by and new.type in ('info_reply','comment'))
        or (p.worker_function = 'field' and p.id = r.assigned_to
          and not v_created and new.type <> 'assignment')
      );
    elsif p.role = 'admin' then
      -- Admin is globally authorized in existing RLS. Only interventions, not
      -- every routine barangay/department action, reach that global queue.
      v_staff := new.type = 'escalation' or (v_created and (r.barangay_id is null or not exists(
        select 1 from public.lb_profiles intake where intake.role = 'worker'
          and intake.worker_function in ('secretary','officer') and intake.status = 'active'
          and intake.barangay_id = r.barangay_id)));
    end if;
    if (p.id = r.submitted_by or coalesce(v_staff,false))
      and (p.id is distinct from coalesce(new.actor_id,auth.uid()) or (v_created and p.id = r.submitted_by))
      and public.app_notification_can_access_request(p.id,r.id) then
      v_job_id := null;
      if p.worker_function = 'field' then
        select a.id into v_job_id from public.lb_assignments a
          where a.request_id = r.id and a.assigned_to = p.id
          order by a.created_at desc,a.id desc limit 1;
      end if;
      perform public.app_emit_notification(p.id,'request-update:' || new.id,v_type,v_title,
        case when v_created and p.id is distinct from r.submitted_by
          then coalesce(r.reference,'Request') || ': A new request requires intake review.' else v_message end,
        r.id,case when v_job_id is not null then 'job-detail' else 'request-detail' end,
        coalesce(v_job_id,r.id));
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.app_notify_on_update() from public,anon,authenticated;

-- Assignment insertion owns the field recipient; the request activity owns
-- the resident recipient. Progress/decline/completion use the request trail.
create or replace function public.app_notify_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_key text := 'assignment:' || gen_random_uuid();
  v_ref text;
  v_title text;
  v_previous_assignee uuid;
begin
  select reference,assigned_to into v_ref,v_previous_assignee from public.lb_service_requests where id = new.request_id;
  if tg_op = 'INSERT' then
    -- The assignment RPC inserts before changing request.assigned_to. This is
    -- the previous worker even though the old assignment row is historical.
    if v_previous_assignee is not null and v_previous_assignee <> new.assigned_to then
      perform public.app_emit_notification(v_previous_assignee,v_key,'assignment.reassigned',
        'Job Reassigned',coalesce(v_ref,'Request') || ': This job has been reassigned.',null,'jobs',null);
    end if;
    v_title := 'New Job Assigned';
  elsif new.assigned_to is distinct from old.assigned_to then
    perform public.app_emit_notification(old.assigned_to,v_key,'assignment.reassigned',
      'Job Reassigned',coalesce(v_ref,'Request') || ': This job has been reassigned.',
      null,'jobs',null);
    v_title := 'New Job Assigned';
  elsif (new.schedule_at,new.deadline_at) is distinct from (old.schedule_at,old.deadline_at) then
    v_title := 'Job Schedule Updated';
  elsif new.notes is distinct from old.notes and auth.uid() is distinct from new.assigned_to then
    v_title := 'Job Instructions Updated';
  else return new;
  end if;
  -- Actual assignment relationship grants job visibility; require a live field
  -- account in its assignment's department, even for trusted backend changes.
  if exists(select 1 from public.lb_profiles p where p.id = new.assigned_to
    and p.role = 'worker' and p.worker_function = 'field' and p.status = 'active'
    and p.department_id = new.department_id) then
    perform public.app_emit_notification(new.assigned_to,v_key,
      case when v_title = 'New Job Assigned' then 'assignment.assigned' else 'assignment.updated' end,
      v_title,coalesce(v_ref,'Request') || ': ' || v_title || '. Open the job for instructions and schedule.',
      null,'job-detail',new.id);
  end if;
  return new;
end $$;
revoke all on function public.app_notify_assignment() from public,anon,authenticated;
create trigger app_notify_assignment_trg after insert or update on public.lb_assignments
  for each row execute function public.app_notify_assignment();

-- Lock by request first in every assignment RPC. A former worker must not act
-- through an older assignment after another worker has been assigned, or after
-- their role/status/department was changed by an administrator.
create or replace function public.app_require_current_assignment(p_assignment_id uuid)
returns public.lb_assignments language plpgsql security definer set search_path = public as $$
declare a public.lb_assignments; r public.lb_service_requests; p public.lb_profiles; v_req uuid; begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into p from public.lb_profiles where id = auth.uid();
  if not found or p.role <> 'worker' or p.worker_function <> 'field' or p.status <> 'active' then
    raise exception 'An active field account is required';
  end if;
  select request_id into v_req from public.lb_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  select * into r from public.lb_service_requests where id = v_req for update;
  select * into a from public.lb_assignments where id = p_assignment_id for update;
  if a.assigned_to is distinct from p.id or r.assigned_to is distinct from p.id
    or a.department_id is distinct from p.department_id
    or r.department_id is distinct from a.department_id
    or a.status not in ('pending','accepted','in_progress')
    or r.status not in ('verified','assigned','in_progress')
    or a.id is distinct from (select current_job.id from public.lb_assignments current_job
      where current_job.request_id = v_req and current_job.assigned_to = p.id
      order by current_job.created_at desc,current_job.id desc limit 1) then
    raise exception 'This assignment is no longer actionable. Refresh your jobs.';
  end if;
  return a;
end $$;
revoke all on function public.app_require_current_assignment(uuid) from public,anon,authenticated;

create or replace function public.app_assign_field(
  p_request_id uuid,p_field_user_id uuid,p_schedule_at timestamptz default null,
  p_deadline_at timestamptz default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.lb_service_requests; f public.lb_profiles; p public.lb_profiles; a public.lb_assignments; v_id uuid; begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into p from public.lb_profiles where id = auth.uid();
  if not found or p.status <> 'active' or not (p.role = 'admin' or (p.role = 'worker' and p.worker_function = 'dispatcher')) then
    raise exception 'Only dispatchers and administrators can assign field personnel';
  end if;
  select * into r from public.lb_service_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if p.role <> 'admin' and r.department_id is distinct from p.department_id then
    raise exception 'This request belongs to another department';
  end if;
  if r.status not in ('verified','assigned') then raise exception 'The request must be verified before field assignment'; end if;
  select * into f from public.lb_profiles where id = p_field_user_id;
  if not found or f.role <> 'worker' or f.worker_function <> 'field' or f.status <> 'active' then
    raise exception 'Selected user is not active field personnel';
  end if;
  if (p.role <> 'admin' and f.department_id is distinct from p.department_id)
    or (r.department_id is not null and f.department_id is distinct from r.department_id) then
    raise exception 'Field personnel belongs to another department';
  end if;
  if r.assigned_to = f.id then
    select * into a from public.lb_assignments where request_id = r.id and assigned_to = f.id
      order by created_at desc,id desc limit 1 for update;
    if found and a.status in ('pending','accepted','in_progress') then
      -- A retry returns the same persisted assignment without another event.
      -- Changed schedule/instructions update that actual assignment instead.
      if (a.schedule_at,a.deadline_at,a.notes) is distinct from (p_schedule_at,p_deadline_at,coalesce(p_notes,'')) then
        update public.lb_assignments set schedule_at = p_schedule_at,deadline_at = p_deadline_at,
          notes = coalesce(p_notes,''),updated_at = now() where id = a.id;
      end if;
      return jsonb_build_object('assignment_id',a.id);
    end if;
  end if;
  insert into public.lb_assignments(request_id,assigned_to,assigned_by,department_id,status,schedule_at,deadline_at,notes,created_at)
    values(r.id,f.id,p.id,f.department_id,'pending',p_schedule_at,p_deadline_at,coalesce(p_notes,''),clock_timestamp()) returning id into v_id;
  update public.lb_service_requests set assigned_to = f.id,assigned_by = p.id,
    department_id = coalesce(department_id,f.department_id),updated_at = now() where id = r.id;
  insert into public.lb_request_updates(request_id,actor_id,actor_name,type,previous_status,new_status,remarks)
    values(r.id,p.id,coalesce(nullif(p.full_name,''),'Staff'),'assignment',r.status,r.status,
      'Assigned to ' || coalesce(nullif(f.full_name,''),'field personnel') ||
      case when coalesce(p_notes,'') <> '' then ' — ' || left(p_notes,200) else '' end);
  return jsonb_build_object('assignment_id',v_id);
end $$;
revoke all on function public.app_assign_field(uuid,uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.app_assign_field(uuid,uuid,timestamptz,timestamptz,text) to authenticated;

-- Serialize transitions before reading their previous status. A retried status
-- change returns the committed result without a second activity/notification.
-- Routing to another department and reopening release the former field job;
-- historical assignment rows are retained, but can no longer authorize work.
do $$
declare definition text; before_read text; before_matrix text; update_fields text;
begin
  definition := pg_get_functiondef('public.app_transition_request(uuid,text,text,jsonb)'::regprocedure);
  before_read := 'select * into v_req from public.lb_service_requests where id = p_request_id;';
  before_matrix := '  -- Transition matrix (deny-by-default; admin allowed with scope checks above)';
  update_fields := '    department_id      = coalesce(v_dept_id, department_id),';
  if position(before_read in definition)=0 or position(before_matrix in definition)=0
    or position(update_fields in definition)=0 then
    raise exception 'Unknown transition definition; review migration against deployed function';
  end if;
  definition := replace(definition,before_read,
    'select * into v_req from public.lb_service_requests where id = p_request_id for update;');
  definition := replace(definition,before_matrix,$patch$
  if p_new_status = v_req.status and
    coalesce(nullif(p_extra->>'department_id','')::uuid,v_req.department_id) is not distinct from v_req.department_id then
    return jsonb_build_object('request',to_jsonb(v_req));
  end if;

  -- Transition matrix (deny-by-default; admin allowed with scope checks above)$patch$);
  definition := replace(definition,'  update public.lb_service_requests set', $patch$
  if v_reopen or coalesce(v_dept_id,v_req.department_id) is distinct from v_req.department_id then
    if v_req.assigned_to is not null then
      perform public.app_emit_notification(v_req.assigned_to,
        'request-responsibility:' || gen_random_uuid(),'assignment.ended',
        'Assignment No Longer Active',coalesce(v_req.reference,'Request') ||
        ': This job has been returned for review or routed elsewhere.',null,'jobs',null);
    end if;
    if coalesce(v_dept_id,v_req.department_id) is distinct from v_req.department_id then
      perform public.app_emit_notification(p.id,
        'request-department:' || gen_random_uuid(),'request.rerouted',
        'Request Routed Elsewhere',coalesce(v_req.reference,'Request') ||
        ': This request no longer belongs to your department.',null,'assignments',null)
      from public.lb_profiles p where p.role='worker' and p.worker_function='dispatcher'
        and p.status='active' and p.department_id=v_req.department_id and p.id is distinct from v_uid;
    end if;
  end if;
  update public.lb_service_requests set$patch$);
  definition := replace(definition,update_fields,update_fields || $patch$
    assigned_to        = case when v_reopen or coalesce(v_dept_id,department_id) is distinct from department_id then null else assigned_to end,
    assigned_by        = case when v_reopen or coalesce(v_dept_id,department_id) is distinct from department_id then null else assigned_by end,$patch$);
  execute definition;
end $$;

-- Keep the established progress/accept/completion implementations and their
-- activity trail; route their assignment read through the common authority
-- guard. Refuse a drifted definition rather than silently omitting a guard.
do $$ declare fn record; v_definition text; v_old text;
begin
  v_old := 'select * into v_asg from public.lb_assignments where id = p_assignment_id;';
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('app_accept_assignment','app_update_job_progress','app_complete_job')
  loop
    v_definition := pg_get_functiondef(fn.oid);
    if position(v_old in v_definition) = 0 then
      raise exception 'Unknown assignment read in public.%; review migration against deployed function',fn.proname;
    end if;
    execute replace(v_definition,v_old,'select * into v_asg from public.app_require_current_assignment(p_assignment_id);');
  end loop;
end $$;

-- Historical assignment ownership is useful for job history, but must not
-- authorize posting new activity to a request after reassignment. Existing
-- app_can_access_request already covers the currently assigned field worker.
do $$ declare v_definition text; v_old text; begin
  v_definition := pg_get_functiondef('public.app_add_comment(uuid,text)'::regprocedure);
  v_old := 'v_can := public.app_can_access_request(p_request_id)
    or (v_role = ''field'' and exists (
      select 1 from public.lb_assignments a where a.request_id = p_request_id and a.assigned_to = v_uid));';
  if position(v_old in v_definition) = 0 then
    raise exception 'Unknown comment authorization definition; review migration against deployed function';
  end if;
  execute replace(v_definition,v_old,'v_can := public.app_can_access_request(p_request_id);');
end $$;

-- Remove the older inline decline fan-out, preserving the RPC and its audit
-- trail. The unified request-update trigger now owns dispatcher delivery.
create or replace function public.app_decline_assignment(p_assignment_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_asg public.lb_assignments;
  v_req public.lb_service_requests;
  v_uid uuid := auth.uid();
  v_name text;
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not public.app_is_active() then raise exception 'Your account is not active'; end if;
  if v_reason is null then raise exception 'A decline reason is required'; end if;
  v_asg := public.app_require_current_assignment(p_assignment_id);
  if v_asg.assigned_to is distinct from v_uid then raise exception 'You can only manage your own assignments'; end if;
  if v_asg.status not in ('pending','in_progress') then raise exception 'This assignment cannot be declined'; end if;
  select coalesce(nullif(full_name,''),'Field personnel') into v_name from public.lb_profiles where id = v_uid;
  select * into v_req from public.lb_service_requests where id = v_asg.request_id for update;
  update public.lb_assignments set status = 'declined',decline_reason = v_reason,updated_at = now() where id = p_assignment_id;
  update public.lb_service_requests set assigned_to = null,
    status = case when status = 'in_progress' then 'assigned' else status end,updated_at = now()
    where id = v_asg.request_id and assigned_to = v_uid;
  insert into public.lb_request_updates(request_id,actor_id,actor_name,type,previous_status,new_status,remarks)
    values(v_asg.request_id,v_uid,v_name,'reassign',v_req.status,v_req.status,'Assignment declined — ' || left(v_reason,1000));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.app_decline_assignment(uuid,text) from public,anon;
grant execute on function public.app_decline_assignment(uuid,text) to authenticated;

-- An appointment's resident/request must belong to its actual barangay. RLS
-- guards the office the actor manages; this guard closes forged foreign-key
-- associations that would otherwise turn scheduling into cross-scope delivery.
create or replace function public.app_guard_appointment_relationships()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.lb_service_requests; begin
  if tg_op = 'UPDATE' and (new.resident_id,new.request_id,new.barangay_id)
    is not distinct from (old.resident_id,old.request_id,old.barangay_id) then return new; end if;
  if new.resident_id is not null and not exists(select 1 from public.lb_profiles p
    where p.id = new.resident_id and p.role = 'resident' and p.barangay_id = new.barangay_id) then
    raise exception 'The appointment resident must belong to this barangay';
  end if;
  if new.request_id is not null then
    select * into r from public.lb_service_requests where id = new.request_id;
    if not found or r.barangay_id is distinct from new.barangay_id then
      raise exception 'The appointment request must belong to this barangay';
    end if;
    if new.resident_id is not null and r.submitted_by is not null and r.submitted_by <> new.resident_id then
      raise exception 'The appointment resident does not own the linked request';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.app_guard_appointment_relationships() from public,anon,authenticated;
create trigger app_guard_appointment_relationships_trg before insert or update on public.lb_appointments
  for each row execute function public.app_guard_appointment_relationships();

create or replace function public.app_notify_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a public.lb_appointments;
  p public.lb_profiles;
  v_key text := 'appointment:' || gen_random_uuid();
  v_title text;
  v_request uuid;
  v_view text;
begin
  if tg_op = 'DELETE' then a := old; v_title := 'Appointment Cancelled';
  else
    a := new;
    if tg_op = 'INSERT' then v_title := 'Appointment Scheduled';
    elsif (new.scheduled_at,new.status,new.resident_id,new.request_id,new.barangay_id,new.purpose,new.notes)
      is not distinct from (old.scheduled_at,old.status,old.resident_id,old.request_id,old.barangay_id,old.purpose,old.notes)
      then return new;
    elsif new.status = 'completed' then v_title := 'Appointment Completed';
    elsif new.status = 'cancelled' then v_title := 'Appointment Cancelled';
    elsif new.status = 'no_show' then v_title := 'Appointment Attendance Updated';
    else v_title := 'Appointment Updated'; end if;
  end if;
  for p in select * from public.lb_profiles where status = 'active' and (
    (id = a.resident_id and barangay_id = a.barangay_id)
    or (role = 'worker' and worker_function = 'secretary' and barangay_id = a.barangay_id))
  loop
    if p.id is not distinct from auth.uid() then continue; end if;
    v_request := null; v_view := 'appointments';
    if a.request_id is not null and public.app_notification_can_access_request(p.id,a.request_id) then
      v_request := a.request_id;
    end if;
    perform public.app_emit_notification(p.id,v_key,'appointment.' ||
      case when tg_op = 'DELETE' then 'cancelled' when tg_op = 'INSERT' then 'scheduled' else a.status end,
      v_title,v_title || '. Scheduled for ' || to_char(a.scheduled_at at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI') || ' (Philippine time).',
      v_request,v_view,a.id);
  end loop;
  -- A reassigned/rescoped appointment also informs its previous resident using
  -- a generic cancellation with no new resident/schedule/scope details.
  if tg_op = 'UPDATE' and old.resident_id is distinct from new.resident_id then
    if exists(select 1 from public.lb_profiles previous_resident
      where previous_resident.id = old.resident_id and previous_resident.barangay_id = old.barangay_id) then
      perform public.app_emit_notification(old.resident_id,v_key,'appointment.cancelled',
        'Appointment Updated','Your previous appointment has been changed. Contact the barangay office for details.');
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.app_notify_appointment() from public,anon,authenticated;
create trigger app_notify_appointment_trg after insert or update or delete on public.lb_appointments
  for each row execute function public.app_notify_appointment();

create or replace function public.app_notify_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.lb_profiles;
  v_key text := 'account:' || gen_random_uuid();
  v_title text;
  v_message text;
begin
  if tg_op = 'INSERT' then
    v_title := 'Account Created';
    v_message := 'Your LinkBarangay account has been created.';
  elsif (new.role,new.worker_function,new.status,new.barangay_id,new.department_id)
    is not distinct from (old.role,old.worker_function,old.status,old.barangay_id,old.department_id)
    then return new;
  else
    v_title := case when new.status is distinct from old.status then 'Account Status Updated' else 'Account Access Updated' end;
    v_message := case when new.status is distinct from old.status
      then 'Your account status is now ' || new.status || '.'
      else 'An administrator updated your account role, function, or assigned scope. Review your profile.' end;
  end if;
  -- Persist a suspension/inactive notice, but RLS blocks reading while inactive.
  perform public.app_emit_notification(new.id,v_key,'account.' ||
    case when tg_op = 'INSERT' then 'created' else 'updated' end,v_title,v_message,null,'profile',new.id,true);
  if new.status = 'pending' or tg_op = 'UPDATE' then
    for p in select * from public.lb_profiles where role = 'admin' and status = 'active'
      and id is distinct from auth.uid() and id <> new.id
    loop
      perform public.app_emit_notification(p.id,v_key,'account.review',
        case when new.status = 'pending' then 'Account Approval Required' else 'Account Access Changed' end,
        case when new.status = 'pending' then 'A new account is awaiting administrative approval.'
          else 'Account access was changed. Review User Management if follow-up is required.' end,
        null,'users',new.id);
    end loop;
  end if;
  -- Availability or scope changes of assigned field personnel are actionable
  -- for dispatchers of the OLD assignment department. Never disclose the new
  -- department or account details to those dispatchers.
  if tg_op = 'UPDATE' and old.role = 'worker' and old.worker_function = 'field'
    and (new.role,new.worker_function,new.status,new.department_id)
      is distinct from (old.role,old.worker_function,old.status,old.department_id) then
    for p in select distinct dispatcher.* from public.lb_profiles dispatcher
      join public.lb_assignments assignment on assignment.department_id = dispatcher.department_id
      where dispatcher.role = 'worker' and dispatcher.worker_function = 'dispatcher'
        and dispatcher.status = 'active' and dispatcher.id is distinct from auth.uid()
        and assignment.assigned_to = new.id and assignment.status in ('pending','accepted','in_progress')
    loop
      perform public.app_emit_notification(p.id,v_key,'personnel.availability',
        'Assigned Personnel Access Changed','Access or availability changed for personnel with active assignments. Review assignments for any required reassignment.',
        null,'assignments',null);
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.app_notify_profile() from public,anon,authenticated;
create trigger app_notify_profile_trg after insert or update on public.lb_profiles
  for each row execute function public.app_notify_profile();

-- Significant routing/SLA/availability changes require peer-admin awareness.
-- Display labels and cosmetic description edits do not create notifications.
create or replace function public.app_notify_configuration()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_key text := 'configuration:' || gen_random_uuid();
  v_view text;
  v_important boolean := tg_op in ('INSERT','DELETE');
  p public.lb_profiles;
begin
  if tg_table_name = 'lb_settings' then
    v_view := case when coalesce(v_new->>'key',v_old->>'key') = 'sla' then 'sla-settings' else 'routing' end;
    v_important := v_important or (v_old->'value' is distinct from v_new->'value');
  elsif tg_table_name = 'lb_service_categories' then
    v_view := 'categories';
    v_important := v_important or (v_old->'department_id',v_old->'sla_hours',v_old->'is_active',v_old->'required_documents')
      is distinct from (v_new->'department_id',v_new->'sla_hours',v_new->'is_active',v_new->'required_documents');
  else
    v_view := case when tg_table_name = 'lb_barangays' then 'barangays' else 'departments' end;
    v_important := v_important or v_old->'is_active' is distinct from v_new->'is_active';
  end if;
  if v_important then
    for p in select * from public.lb_profiles where role = 'admin' and status = 'active' and id is distinct from auth.uid()
    loop
      perform public.app_emit_notification(p.id,v_key,'configuration.updated','System Configuration Updated',
        'An important availability, routing, or service configuration changed. Review the relevant configuration.',
        null,v_view,null);
    end loop;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.app_notify_configuration() from public,anon,authenticated;
create trigger app_notify_configuration_trg after insert or update or delete on public.lb_settings
  for each row execute function public.app_notify_configuration();
create trigger app_notify_configuration_trg after insert or update or delete on public.lb_barangays
  for each row execute function public.app_notify_configuration();
create trigger app_notify_configuration_trg after insert or update or delete on public.lb_departments
  for each row execute function public.app_notify_configuration();
create trigger app_notify_configuration_trg after insert or update or delete on public.lb_service_categories
  for each row execute function public.app_notify_configuration();

create or replace function public.app_notify_attachment()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.lb_service_requests; p public.lb_profiles; begin
  select * into r from public.lb_service_requests where id = new.request_id;
  if not found then return new; end if;
  for p in select * from public.lb_profiles where status = 'active' and role = 'worker' and (
    (new.owner_id = r.submitted_by and new.kind in ('supporting_doc','reply_doc')
      and worker_function in ('secretary','officer') and barangay_id = r.barangay_id)
    or (new.owner_id = r.assigned_to and new.kind = 'completion_doc'
      and worker_function = 'dispatcher' and department_id = r.department_id))
  loop
    if p.id is distinct from new.owner_id and public.app_notification_can_access_request(p.id,r.id) then
      perform public.app_emit_notification(p.id,'attachment:' || new.id,'request.document_added',
        'Request Document Added',coalesce(r.reference,'Request') || ': A supporting document is available for review.',r.id,'request-detail',r.id);
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.app_notify_attachment() from public,anon,authenticated;
create trigger app_notify_attachment_trg after insert on public.lb_attachments
  for each row execute function public.app_notify_attachment();

-- Only an active recipient can read their rows. Read mutations go through a
-- narrow server-time RPC; ownership, title, contents and destinations are never
-- client writable. Keep service-role/table-owner operations for trusted tasks.
drop policy if exists lb_notifications_select on public.lb_notifications;
create policy lb_notifications_select on public.lb_notifications for select to authenticated
  using(user_id = (select auth.uid()) and (select public.app_is_active()));
-- An older custom permissive policy must not widen the recipient boundary.
create policy lb_notifications_recipient_guard on public.lb_notifications as restrictive
  for select to authenticated
  using(user_id = (select auth.uid()) and (select public.app_is_active()));
drop policy if exists lb_notifications_update on public.lb_notifications;
revoke select on public.lb_notifications from public,anon;
revoke insert,update,delete,truncate,references,trigger on public.lb_notifications from public,anon,authenticated;
do $$ declare c record; begin
  for c in select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'lb_notifications'
  loop
    execute format('revoke update(%I),insert(%I) on public.lb_notifications from public,anon,authenticated',c.column_name,c.column_name);
    execute format('revoke select(%I) on public.lb_notifications from public,anon',c.column_name);
  end loop;
end $$;
grant select on public.lb_notifications to authenticated;

create or replace function public.app_mark_notifications_read(
  p_notification_id uuid default null,p_expected_user_id uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_count bigint; begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_expected_user_id is not null and p_expected_user_id is distinct from v_uid then
    raise exception 'The signed-in account changed. Retry from the current account.';
  end if;
  if not public.app_is_active() then raise exception 'Your account is not active'; end if;
  update public.lb_notifications set is_read = true,read_at = now()
    where user_id = v_uid and is_read = false
      and (p_notification_id is null or id = p_notification_id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.app_mark_notifications_read(uuid,uuid) from public,anon;
grant execute on function public.app_mark_notifications_read(uuid,uuid) to authenticated;

-- Primary keys identify updates. Both INSERT and UPDATE must be published for
-- new messages and cross-session read-state synchronization. No FULL identity
-- (which would retain unnecessary sensitive message text in old-row payloads).
do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'lb_notifications') then
      alter publication supabase_realtime add table public.lb_notifications;
    end if;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
