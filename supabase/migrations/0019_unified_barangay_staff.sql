-- Consolidate the legacy Secretary, Officer, and Supervisor worker accounts.
-- Original functions are retained in legacy_worker_function for audit/history.
alter table public.lb_profiles add column if not exists legacy_worker_function text;
alter table public.lb_profiles drop constraint if exists lb_profiles_worker_scope_check;
alter table public.lb_profiles drop constraint if exists lb_profiles_worker_function_check;

-- Avoid sending account-change notifications to users during this bulk role migration.
alter table public.lb_profiles disable trigger app_notify_profile_trg;
update public.lb_profiles
set legacy_worker_function = worker_function,
    worker_function = 'barangay_staff',
    updated_at = now()
where role = 'worker' and worker_function in ('secretary','officer','captain');
alter table public.lb_profiles enable trigger app_notify_profile_trg;

alter table public.lb_profiles add constraint lb_profiles_worker_function_check
  check (worker_function is null or worker_function in ('barangay_staff','dispatcher','field'));
alter table public.lb_profiles add constraint lb_profiles_worker_scope_check
  check (role <> 'worker'
    or (worker_function = 'barangay_staff' and barangay_id is not null)
    or (worker_function in ('dispatcher','field') and department_id is not null)) not valid;

create or replace function public.app_can_access_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select r.submitted_by = auth.uid() or public.app_is_admin() or
    (public.app_is_active_staff() and (
      (public.app_current_role() = 'barangay_staff' and r.barangay_id = public.app_current_barangay())
      or (public.app_current_role() = 'dispatcher' and r.department_id = public.app_current_department())
      or (public.app_current_role() = 'field' and r.assigned_to = auth.uid())))
    from public.lb_service_requests r where r.id = p_request_id), false)
$$;

-- All former Secretary/Officer/Supervisor request capabilities belong to the unified staff role.
drop policy if exists lb_profiles_select on public.lb_profiles;
create policy lb_profiles_select on public.lb_profiles for select to authenticated using (
  id=(select auth.uid()) or public.app_is_admin() or (public.app_is_active_staff() and (
    (public.app_current_role()='barangay_staff' and barangay_id=public.app_current_barangay())
    or (public.app_current_role() in ('dispatcher','field') and department_id=public.app_current_department()))));
drop policy if exists lb_requests_insert on public.lb_service_requests;
create policy lb_requests_insert on public.lb_service_requests for insert to authenticated with check (
  public.app_is_active() and ((submitted_by=(select auth.uid()) and is_anonymous=false)
    or (public.app_current_role()='barangay_staff' and public.app_current_status()='active'
      and submitted_by is null and barangay_id=public.app_current_barangay()) or public.app_is_admin()));
drop policy if exists lb_assignments_select on public.lb_assignments;
create policy lb_assignments_select on public.lb_assignments for select to authenticated using (
  assigned_to=(select auth.uid()) or public.app_is_admin()
  or (public.app_current_role()='dispatcher' and public.app_current_status()='active' and department_id=public.app_current_department())
  or (public.app_current_role()='barangay_staff' and public.app_current_status()='active'
    and exists(select 1 from public.lb_service_requests r where r.id=request_id and r.barangay_id=public.app_current_barangay())));
drop policy if exists lb_appointments_select on public.lb_appointments;
create policy lb_appointments_select on public.lb_appointments for select to authenticated using (
  resident_id=(select auth.uid()) or public.app_is_admin()
  or (public.app_current_role()='barangay_staff' and public.app_current_status()='active' and barangay_id=public.app_current_barangay()));
drop policy if exists lb_appointments_write on public.lb_appointments;
create policy lb_appointments_write on public.lb_appointments for all to authenticated
  using (public.app_is_admin() or (public.app_current_role()='barangay_staff' and public.app_current_status()='active' and barangay_id=public.app_current_barangay()))
  with check (public.app_is_admin() or (public.app_current_role()='barangay_staff' and public.app_current_status()='active' and barangay_id=public.app_current_barangay()));

-- Safely patch role checks in existing workflow functions while preserving their full audited behavior.
do $migrate$ declare fn record; definition text; begin
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('app_transition_request','app_escalate_request')
  loop
    definition := pg_get_functiondef(fn.oid);
    definition := replace(definition,$old$'secretary'$old$,$new$'barangay_staff'$new$);
    definition := replace(definition,$old$'officer'$old$,$new$'barangay_staff'$new$);
    definition := replace(definition,$old$'captain'$old$,$new$'barangay_staff'$new$);
    execute definition;
  end loop;
end $migrate$;

create or replace function public.app_notification_can_access_request(p_user_id uuid,p_request_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.lb_profiles p join public.lb_service_requests r on r.id=p_request_id
  where p.id=p_user_id and p.status='active' and (p.id=r.submitted_by or p.role='admin' or (p.role='worker' and (
   (p.worker_function='barangay_staff' and p.barangay_id=r.barangay_id)
   or (p.worker_function='dispatcher' and p.department_id=r.department_id)
   or (p.worker_function='field' and p.id=r.assigned_to)))))
$$;

-- Unified staff receives all intake, verification, escalation, and approval events formerly split across three roles.
create or replace function public.app_notify_on_update()
returns trigger language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; p public.lb_profiles; v_created boolean; v_type text; v_title text; v_message text; v_staff boolean; v_job_id uuid;
begin
 select * into r from public.lb_service_requests where id=new.request_id;
 if not found then return new; end if;
 v_created:=new.type='status_change' and new.previous_status is null and new.new_status='submitted';
 v_type:=case when v_created then 'request.received' when new.type='status_change' then 'request.'||coalesce(new.new_status,'updated') else 'request.'||new.type end;
 v_title:=case when v_created then 'New Request Received' when new.type='info_reply' then 'Requested Information Received'
  when new.type='assignment' then 'Request Assigned' when new.type='reassign' then 'Assignment Declined — Reassignment Needed'
  when new.type='escalation' then 'Request Escalated' when new.type='reopen' then 'Request Reopened'
  when new.type='comment' then 'Request Update' when new.new_status='for_verification' then 'Request Awaiting Verification'
  when new.new_status='needs_information' then 'Additional Information Required' when new.new_status='verified' then 'Request Verified'
  when new.new_status='assigned' then 'Request Forwarded for Processing' when new.new_status='in_progress' then 'Work Started'
  when new.new_status='for_inspection' then 'Work Completed — Review Required' when new.new_status='resolved' then 'Request Resolved'
  when new.new_status='closed' then 'Request Closed' when new.new_status='rejected' then 'Request Rejected' else 'Request Updated' end;
 v_message:=coalesce(r.reference,'Request')||': '||case when v_created then 'A new resident request needs intake review.'
  else v_title||case when nullif(new.remarks,'') is not null then '. '||left(new.remarks,300) else '.' end end;
 for p in select * from public.lb_profiles where status='active' and (id in (r.submitted_by,r.assigned_to,r.needs_info_by)
   or (role='worker' and (barangay_id=r.barangay_id or department_id=r.department_id)) or (role='admin' and (new.type='escalation' or v_created))) loop
  v_staff:=false;
  if p.role='worker' then
   v_staff:=(p.worker_function='barangay_staff' and p.barangay_id=r.barangay_id
      and (v_created or new.new_status in ('for_verification','needs_information','verified','for_inspection','resolved','rejected')
        or new.type in ('reopen','escalation','info_reply')
        or (new.type='comment' and r.status in ('submitted','for_verification','needs_information','for_inspection'))))
     or (p.worker_function='dispatcher' and p.department_id=r.department_id
      and (new.new_status in ('verified','assigned','in_progress','for_inspection','resolved','closed','rejected') or new.type in ('reassign','escalation')))
     or (p.worker_function='field' and p.id=r.assigned_to and not v_created and new.type<>'assignment');
  elsif p.role='admin' then v_staff:=new.type='escalation' or v_created; end if;
  if (p.id=r.submitted_by or coalesce(v_staff,false)) and p.id is distinct from coalesce(new.actor_id,auth.uid())
    and public.app_notification_can_access_request(p.id,r.id) then
    v_job_id:=null;
    if p.worker_function='field' then select a.id into v_job_id from public.lb_assignments a where a.request_id=r.id and a.assigned_to=p.id order by a.created_at desc,a.id desc limit 1; end if;
    perform public.app_emit_notification(p.id,'request-update:'||new.id,v_type,v_title,v_message,r.id,
      case when v_job_id is not null then 'job-detail' else 'request-detail' end,coalesce(v_job_id,r.id));
  end if;
 end loop;
 return new;
end $$;
revoke all on function public.app_notify_on_update() from public,anon,authenticated;

-- New requests are surfaced to the unified staff queue and existing appointment notifications.
create or replace function public.app_notify_appointment()
returns trigger language plpgsql security definer set search_path=public as $$
declare a public.lb_appointments; p public.lb_profiles; v_key text:='appointment:'||gen_random_uuid(); v_title text; v_request uuid;
begin
 if tg_op='DELETE' then a:=old; v_title:='Appointment Cancelled'; else a:=new;
  if tg_op='INSERT' then v_title:='Appointment Scheduled';
  elsif (new.scheduled_at,new.status,new.resident_id,new.request_id,new.barangay_id,new.purpose,new.notes) is not distinct from (old.scheduled_at,old.status,old.resident_id,old.request_id,old.barangay_id,old.purpose,old.notes) then return new;
  elsif new.status='completed' then v_title:='Appointment Completed'; elsif new.status='cancelled' then v_title:='Appointment Cancelled'; else v_title:='Appointment Updated'; end if;
 end if;
 for p in select * from public.lb_profiles where status='active' and ((id=a.resident_id and barangay_id=a.barangay_id)
   or (role='worker' and worker_function='barangay_staff' and barangay_id=a.barangay_id)) loop
  if p.id is distinct from auth.uid() then
   v_request:=null; if a.request_id is not null and public.app_notification_can_access_request(p.id,a.request_id) then v_request:=a.request_id; end if;
   perform public.app_emit_notification(p.id,v_key,'appointment.'||case when tg_op='DELETE' then 'cancelled' when tg_op='INSERT' then 'scheduled' else a.status end,
    v_title,v_title||'. Scheduled for '||to_char(a.scheduled_at at time zone 'Asia/Manila','Mon DD, YYYY HH24:MI')||' (Philippine time).',v_request,'appointments',a.id);
  end if;
 end loop;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.app_notify_appointment() from public,anon,authenticated;

create or replace function public.app_notify_attachment()
returns trigger language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; p public.lb_profiles; begin
 select * into r from public.lb_service_requests where id=new.request_id; if not found then return new; end if;
 for p in select * from public.lb_profiles where status='active' and role='worker' and (
   (new.owner_id=r.submitted_by and new.kind in ('supporting_doc','reply_doc','request_evidence') and worker_function='barangay_staff' and barangay_id=r.barangay_id)
   or (new.owner_id=r.assigned_to and new.kind='completion_doc' and worker_function='dispatcher' and department_id=r.department_id)) loop
  if p.id is distinct from new.owner_id and public.app_notification_can_access_request(p.id,r.id) then
   perform public.app_emit_notification(p.id,'attachment:'||new.id,'request.document_added','Request Document Added',
    coalesce(r.reference,'Request')||': A supporting document is available for review.',r.id,'request-detail',r.id);
  end if;
 end loop; return new;
end $$;
revoke all on function public.app_notify_attachment() from public,anon,authenticated;
notify pgrst,'reload schema';
