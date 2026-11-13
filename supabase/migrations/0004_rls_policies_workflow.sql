-- ============================================================================
-- LinkBarangay migration 0004 — Row Level Security (deny-by-default),
-- workflow RPCs, notifications, realtime.
--
-- NOTE: this script drops and recreates ALL policies on the lb_* tables
-- listed below so no legacy permissive policy can widen access. It does not
-- touch any table data. Run the whole script in the Supabase SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extra request column (escalations) + notifications table alignment
-- ---------------------------------------------------------------------------
alter table public.lb_service_requests add column if not exists escalation_count integer not null default 0;
update public.lb_service_requests set escalation_count = coalesce(escalation_count, 0);

create table if not exists public.lb_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  title      text not null default '',
  message    text not null default '',
  request_id uuid references public.lb_service_requests(id) on delete cascade,
  is_read    boolean not null default false,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

alter table public.lb_notifications add column if not exists user_id    uuid;
alter table public.lb_notifications add column if not exists title      text;
alter table public.lb_notifications add column if not exists message    text;
alter table public.lb_notifications add column if not exists request_id uuid;
alter table public.lb_notifications add column if not exists is_read    boolean;
alter table public.lb_notifications add column if not exists read_at    timestamptz;
alter table public.lb_notifications add column if not exists created_at timestamptz not null default now();

update public.lb_notifications set title = coalesce(title, '')      where title is null;
update public.lb_notifications set message = coalesce(message, '')  where message is null;
update public.lb_notifications set is_read = coalesce(is_read, false) where is_read is null;
update public.lb_notifications set created_at = coalesce(created_at, now()) where created_at is null;

alter table public.lb_notifications alter column title   set not null;
alter table public.lb_notifications alter column message set not null;
alter table public.lb_notifications alter column is_read set not null;
alter table public.lb_notifications alter column created_at set not null;

create index if not exists lb_notifications_user_idx on public.lb_notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 1. Replace all legacy policies on LinkBarangay tables (deny-by-default)
-- ---------------------------------------------------------------------------
do $$
declare pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'lb_profiles','lb_service_requests','lb_request_updates','lb_notifications',
        'lb_assignments','lb_appointments','lb_attachments','lb_audit_logs'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

alter table public.lb_profiles         enable row level security;
alter table public.lb_service_requests enable row level security;
alter table public.lb_request_updates  enable row level security;
alter table public.lb_notifications    enable row level security;
alter table public.lb_assignments      enable row level security;
alter table public.lb_appointments     enable row level security;
alter table public.lb_attachments      enable row level security;
alter table public.lb_audit_logs       enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Access helper — who can see/act on a request
-- ---------------------------------------------------------------------------
create or replace function public.app_can_access_request(p_request_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select
      r.submitted_by = auth.uid()
      or public.app_is_admin()
      or (
        public.app_is_active_staff()
        and (
          (public.app_current_role() in ('secretary','officer','captain') and r.barangay_id = public.app_current_barangay())
          or (public.app_current_role() = 'dispatcher' and r.department_id = public.app_current_department())
          or (public.app_current_role() = 'field' and r.assigned_to = auth.uid())
        )
      )
  ), false)
  from public.lb_service_requests r
  where r.id = p_request_id
$$;

-- ---------------------------------------------------------------------------
-- 3. Client-side update guard on requests:
--    - status may ONLY change through the SECURITY DEFINER workflow RPCs
--      (which run as the table owner; direct browser updates run as
--      'authenticated' and are blocked)
--    - identity/audit columns are immutable from the client
-- ---------------------------------------------------------------------------
create or replace function public.app_guard_request_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres','service_role','supabase_admin') then
    return new;  -- trusted server context (workflow RPCs, Edge Function)
  end if;

  if new.status is distinct from old.status then
    raise exception 'Status changes must go through the workflow RPC (app_transition_request)';
  end if;

  if (new.id            is distinct from old.id)
    or (new.reference   is distinct from old.reference)
    or (new.tracking_code is distinct from old.tracking_code)
    or (new.submitted_by is distinct from old.submitted_by)
    or (new.is_anonymous is distinct from old.is_anonymous)
    or (new.created_at  is distinct from old.created_at) then
    raise exception 'Request identity/audit columns cannot be modified';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists app_guard_request_update_trg on public.lb_service_requests;
create trigger app_guard_request_update_trg
  before update on public.lb_service_requests
  for each row execute function public.app_guard_request_update();

-- ---------------------------------------------------------------------------
-- 4. Notification fan-out: every request update notifies the owner and the
--    assigned field personnel (never the actor themselves)
-- ---------------------------------------------------------------------------
create or replace function public.app_notify_on_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner    uuid;
  v_assignee uuid;
  v_ref      text;
  v_title    text;
  v_msg      text;
begin
  select submitted_by, assigned_to, reference, title
  into v_owner, v_assignee, v_ref, v_title
  from public.lb_service_requests where id = new.request_id;

  v_msg := case
    when new.new_status is not null and new.new_status is distinct from new.previous_status
      then 'Status: ' || replace(coalesce(new.previous_status, '(none)'), '_', ' ')
           || ' → ' || replace(new.new_status, '_', ' ')
           || case when coalesce(new.remarks, '') <> '' then ' — ' || left(new.remarks, 200) else '' end
    else left(coalesce(nullif(new.remarks, ''), 'New activity on your request'), 400)
  end;

  if v_owner is not null and v_owner is distinct from new.actor_id then
    insert into public.lb_notifications (user_id, title, message, request_id, is_read)
    values (v_owner, left('[' || coalesce(v_ref, 'Request') || '] ' || v_title, 150), v_msg, new.request_id, false);
  end if;

  if v_assignee is not null and v_assignee is distinct from new.actor_id
     and new.type in ('assignment','status_change','comment','escalation') then
    insert into public.lb_notifications (user_id, title, message, request_id, is_read)
    values (v_assignee, left('[' || coalesce(v_ref, 'Request') || '] ' || v_title, 150), v_msg, new.request_id, false);
  end if;

  return new;
end $$;

drop trigger if exists app_notify_on_update_trg on public.lb_request_updates;
create trigger app_notify_on_update_trg
  after insert on public.lb_request_updates
  for each row execute function public.app_notify_on_update();

-- ---------------------------------------------------------------------------
-- 5. RLS policies
-- ---------------------------------------------------------------------------
-- Profiles: see self; admins see all; staff see colleagues in scope
create policy lb_profiles_select on public.lb_profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.app_is_admin()
    or (
      public.app_is_active_staff()
      and (
        (public.app_current_role() in ('secretary','officer','captain') and barangay_id = public.app_current_barangay())
        or (public.app_current_role() in ('dispatcher','field') and department_id = public.app_current_department())
      )
    )
  );

-- Profile updates: self-service free-text only (trigger 0001 blocks
-- self role/status changes) or an active administrator (trigger audits it)
create policy lb_profiles_update on public.lb_profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.app_is_admin())
  with check (id = (select auth.uid()) or public.app_is_admin());
-- No insert/delete policies for profiles: creation only via the signup trigger
-- or the service-role Edge Function; deletion only via cascades/service role.

-- Requests
create policy lb_requests_select on public.lb_service_requests
  for select to authenticated
  using (public.app_can_access_request(id));

create policy lb_requests_insert on public.lb_service_requests
  for insert to authenticated
  with check (
    public.app_is_active()
    and (
      (submitted_by = (select auth.uid()) and is_anonymous = false)
      or (
        public.app_current_role() = 'secretary'
        and public.app_current_status() = 'active'
        and submitted_by is null
        and barangay_id = public.app_current_barangay()
      )
      or public.app_is_admin()
    )
  );

create policy lb_requests_update on public.lb_service_requests
  for update to authenticated
  using (public.app_is_active_staff() and public.app_can_access_request(id))
  with check (public.app_is_active_staff() and public.app_can_access_request(id));
-- No delete policy: requests are never deleted by clients.

-- Request updates (activity trail): readable by request participants
create policy lb_updates_select on public.lb_request_updates
  for select to authenticated
  using (public.app_can_access_request(request_id));
-- Inserts happen only through the SECURITY DEFINER RPCs below.

-- Assignments: assignee, department dispatcher, barangay staff, admin
create policy lb_assignments_select on public.lb_assignments
  for select to authenticated
  using (
    assigned_to = (select auth.uid())
    or public.app_is_admin()
    or (
      public.app_current_role() = 'dispatcher'
      and public.app_current_status() = 'active'
      and department_id = public.app_current_department()
    )
    or (
      public.app_current_role() in ('officer','captain','secretary')
      and public.app_current_status() = 'active'
      and exists (
        select 1 from public.lb_service_requests r
        where r.id = request_id and r.barangay_id = public.app_current_barangay()
      )
    )
  );
-- Assignment state changes happen only through the RPCs below.

-- Appointments: secretaries/captains per barangay; residents see their own
create policy lb_appointments_select on public.lb_appointments
  for select to authenticated
  using (
    resident_id = (select auth.uid())
    or public.app_is_admin()
    or (
      public.app_current_role() in ('secretary','captain')
      and public.app_current_status() = 'active'
      and barangay_id = public.app_current_barangay()
    )
  );

create policy lb_appointments_write on public.lb_appointments
  for all to authenticated
  using (
    public.app_is_admin()
    or (
      public.app_current_role() in ('secretary','captain')
      and public.app_current_status() = 'active'
      and barangay_id = public.app_current_barangay()
    )
  )
  with check (
    public.app_is_admin()
    or (
      public.app_current_role() = 'secretary'
      and public.app_current_status() = 'active'
      and barangay_id = public.app_current_barangay()
    )
  );

-- Attachments: request participants
create policy lb_attachments_select on public.lb_attachments
  for select to authenticated
  using (
    exists (
      select 1 from public.lb_service_requests r
      where r.id = request_id and public.app_can_access_request(r.id)
    )
  );

create policy lb_attachments_insert on public.lb_attachments
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.app_is_active()
    and exists (
      select 1 from public.lb_service_requests r
      where r.id = request_id and public.app_can_access_request(r.id)
    )
  );

create policy lb_attachments_owner_delete on public.lb_attachments
  for delete to authenticated
  using (owner_id = (select auth.uid()) or public.app_is_admin());

-- Audit logs: admin read-only
create policy lb_audit_select on public.lb_audit_logs
  for select to authenticated
  using (public.app_is_admin());
-- Audit rows are written only by SECURITY DEFINER triggers/RPCs.

-- Notifications: own rows only
create policy lb_notifications_select on public.lb_notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy lb_notifications_update on public.lb_notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- Notifications are created server-side (trigger/RPCs), never by clients.

-- ---------------------------------------------------------------------------
-- 6. Workflow RPC: controlled status transitions
-- ---------------------------------------------------------------------------
create or replace function public.app_transition_request(
  p_request_id uuid,
  p_new_status text,
  p_remarks text default null,
  p_extra jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req     public.lb_service_requests;
  v_prev    text;
  v_uid     uuid := auth.uid();
  v_role    text;
  v_status  text;
  v_brgy    uuid;
  v_dept    uuid;
  v_name    text;
  v_ok      boolean := false;
  v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
  v_dept_id uuid;
  v_reopen  boolean := false;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_new_status not in ('submitted','for_verification','needs_information','verified',
                          'assigned','in_progress','for_inspection','resolved','closed','rejected') then
    raise exception 'Unknown status "%"', p_new_status;
  end if;

  select * into v_req from public.lb_service_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;

  select coalesce(worker_function, role), status, barangay_id, department_id,
         coalesce(nullif(full_name, ''), 'Staff')
  into v_role, v_status, v_brgy, v_dept, v_name
  from public.lb_profiles where id = v_uid;
  if not found or v_status <> 'active' then raise exception 'Your account is not active'; end if;

  -- Scope enforcement
  if v_role = 'resident' then
    if v_req.submitted_by is distinct from v_uid then
      raise exception 'You can only manage your own requests';
    end if;
  elsif v_role in ('secretary','officer','captain') then
    if v_req.barangay_id is distinct from v_brgy then
      raise exception 'This request belongs to another barangay';
    end if;
  elsif v_role = 'dispatcher' then
    if v_req.department_id is distinct from v_dept then
      raise exception 'This request belongs to another department';
    end if;
  elsif v_role = 'field' then
    raise exception 'Field personnel update jobs through assignments, not statuses';
  end if;

  -- Transition matrix (deny-by-default; admin allowed with scope checks above)
  if v_role = 'admin' then
    v_ok := true;
  else
    v_ok := case
      when v_req.status = 'submitted'         and p_new_status = 'for_verification' then v_role in ('secretary','officer')
      when v_req.status = 'submitted'         and p_new_status = 'rejected'         then v_role in ('secretary','officer')
      when v_req.status = 'for_verification'  and p_new_status = 'needs_information' then v_role in ('officer','captain')
      when v_req.status = 'for_verification'  and p_new_status = 'verified'          then v_role in ('officer','captain')
      when v_req.status = 'for_verification'  and p_new_status = 'rejected'          then v_role in ('officer','captain')
      when v_req.status = 'needs_information' and p_new_status = 'for_verification'  then v_role in ('officer','captain')
      when v_req.status = 'verified'          and p_new_status = 'assigned'          then v_role in ('officer','dispatcher')
      when v_req.status = 'assigned'          and p_new_status = 'in_progress'       then v_role = 'dispatcher'
      when v_req.status = 'in_progress'       and p_new_status = 'for_inspection'    then v_role = 'dispatcher'
      when v_req.status = 'for_inspection'    and p_new_status = 'resolved'          then v_role in ('officer','captain')
      when v_req.status = 'resolved'          and p_new_status = 'closed'            then v_role in ('resident','officer','captain')
      when v_req.status = 'rejected'          and p_new_status = 'closed'            then v_role in ('officer','captain')
      when p_new_status = 'for_verification' and v_req.status in ('rejected','resolved','closed') then
        (v_role = 'resident'
         and coalesce(v_req.closed_at, v_req.resolved_at) > now() - make_interval(days => coalesce(
               (select nullif(value->>'reopen_days', '')::int from public.lb_settings where key = 'sla'), 7)))
        or v_role in ('officer','captain')
      else false
    end;
  end if;

  if not v_ok then
    raise exception 'Transition % → % is not allowed for your role', v_req.status, p_new_status;
  end if;

  v_prev   := v_req.status;
  v_reopen := (p_new_status = 'for_verification' and v_prev in ('rejected','resolved','closed'));
  v_dept_id := nullif(p_extra->>'department_id', '')::uuid;

  if p_new_status = 'assigned' and v_dept_id is null and v_req.department_id is null then
    raise exception 'A department must be provided when routing a request';
  end if;
  if p_new_status = 'rejected' and v_remarks is null then
    raise exception 'A rejection explanation is required';
  end if;
  if p_new_status = 'needs_information' and v_remarks is null then
    raise exception 'Describe what information is needed';
  end if;

  update public.lb_service_requests set
    status             = p_new_status,
    department_id      = coalesce(v_dept_id, department_id),
    needs_info_message = case when p_new_status = 'needs_information' then coalesce(v_remarks, '') else needs_info_message end,
    needs_info_by      = case when p_new_status = 'needs_information' then v_uid else needs_info_by end,
    rejection_reason   = case when p_new_status = 'rejected' then coalesce(v_remarks, '') else rejection_reason end,
    resolved_at        = case when p_new_status = 'resolved' then now() else resolved_at end,
    closed_at          = case when p_new_status = 'closed'   then now() else closed_at end,
    reopened_count     = reopened_count + case when v_reopen then 1 else 0 end,
    due_at             = case
                           when p_new_status = 'assigned' or v_reopen then
                             now() + make_interval(hours => coalesce(
                               (select sla_hours from public.lb_service_categories where id = v_req.category_id), 72))
                           else due_at
                         end,
    updated_at         = now()
  where id = p_request_id
  returning * into v_req;

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, previous_status, new_status, remarks)
  values
    (p_request_id, v_uid, v_name,
     case when v_reopen then 'reopen' else 'status_change' end,
     v_prev, p_new_status, coalesce(v_remarks, ''));

  if v_role = 'admin' then
    insert into public.lb_audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
    values (v_uid, v_name, 'request.transition', 'lb_service_requests', p_request_id::text,
            jsonb_build_object('from', v_prev, 'to', p_new_status, 'remarks', v_remarks));
  end if;

  return jsonb_build_object('request', to_jsonb(v_req));
end $$;

-- ---------------------------------------------------------------------------
-- 7. Public RPCs: anonymous reporting + tracking (no login required)
-- ---------------------------------------------------------------------------
create or replace function public.app_submit_anonymous_report(
  p_title text,
  p_description text,
  p_category_id uuid default null,
  p_location text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_ref   text;
  v_code  text;
  v_tries integer := 0;
begin
  p_title := nullif(trim(coalesce(p_title, '')), '');
  p_description := nullif(trim(coalesce(p_description, '')), '');
  p_location := nullif(trim(coalesce(p_location, '')), '');

  if p_title is null or length(p_title) < 4 or length(p_title) > 150 then
    raise exception 'A title between 4 and 150 characters is required';
  end if;
  if p_description is null or length(p_description) < 10 or length(p_description) > 4000 then
    raise exception 'A description between 10 and 4000 characters is required';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.lb_service_categories where id = p_category_id and is_active
  ) then
    p_category_id := null;
  end if;

  loop
    v_tries := v_tries + 1;
    v_ref  := 'LB-' || to_char(now(), 'YYYY') || '-' || lpad((floor(random() * 9000) + 1000)::text, 4, '0');
    v_code := upper(substring(md5(random()::text) from 1 for 6));
    begin
      insert into public.lb_service_requests
        (title, description, category_id, location, status, priority,
         is_anonymous, submitter_name, reference, tracking_code)
      values
        (p_title, p_description, p_category_id, coalesce(p_location, ''), 'submitted', 'normal',
         true, 'Anonymous', v_ref, v_code)
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_tries >= 5 then raise; end if;
    end;
  end loop;

  return jsonb_build_object('id', v_id, 'reference', v_ref, 'tracking_code', v_code);
end $$;

create or replace function public.app_track_request(p_reference text, p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req     public.lb_service_requests;
  v_updates jsonb;
begin
  select * into v_req
  from public.lb_service_requests
  where upper(reference) = upper(trim(coalesce(p_reference, '')))
    and tracking_code = upper(trim(coalesce(p_code, '')));

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
             'type', type, 'previous_status', previous_status, 'new_status', new_status,
             'remarks', remarks, 'actor', actor_name, 'at', created_at
           ) order by created_at), '[]'::jsonb)
  into v_updates
  from public.lb_request_updates
  where request_id = v_req.id;

  return jsonb_build_object('found', true, 'request', to_jsonb(v_req), 'updates', v_updates);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Assignment RPCs (dispatcher workflow + field personnel actions)
-- ---------------------------------------------------------------------------
create or replace function public.app_assign_field(
  p_request_id   uuid,
  p_field_user_id uuid,
  p_schedule_at  timestamptz default null,
  p_deadline_at  timestamptz default null,
  p_notes        text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req    public.lb_service_requests;
  v_field  public.lb_profiles;
  v_uid    uuid := auth.uid();
  v_role   text;
  v_status text;
  v_dept   uuid;
  v_name   text;
  v_assignment_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select coalesce(worker_function, role), status, department_id, coalesce(nullif(full_name, ''), 'Staff')
  into v_role, v_status, v_dept, v_name
  from public.lb_profiles where id = v_uid;
  if v_role not in ('dispatcher','admin') or v_status <> 'active' then
    raise exception 'Only dispatchers and administrators can assign field personnel';
  end if;

  select * into v_req from public.lb_service_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;
  if v_role = 'dispatcher' and v_req.department_id is distinct from v_dept then
    raise exception 'This request belongs to another department';
  end if;
  if v_req.status not in ('verified','assigned') then
    raise exception 'The request must be verified before field assignment';
  end if;

  select * into v_field from public.lb_profiles where id = p_field_user_id;
  if not found or v_field.role <> 'worker' or v_field.worker_function <> 'field' or v_field.status <> 'active' then
    raise exception 'Selected user is not active field personnel';
  end if;
  if v_role = 'dispatcher' and v_field.department_id is distinct from v_dept then
    raise exception 'Field personnel belongs to another department';
  end if;

  insert into public.lb_assignments
    (request_id, assigned_to, assigned_by, department_id, status, schedule_at, deadline_at, notes)
  values
    (p_request_id, p_field_user_id, v_uid, coalesce(v_field.department_id, v_req.department_id),
     'pending', p_schedule_at, p_deadline_at, coalesce(p_notes, ''))
  returning id into v_assignment_id;

  update public.lb_service_requests
  set assigned_to = p_field_user_id,
      assigned_by = v_uid,
      department_id = coalesce(department_id, v_field.department_id),
      updated_at = now()
  where id = p_request_id;

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, previous_status, new_status, remarks)
  values
    (p_request_id, v_uid, v_name, 'assignment', v_req.status, v_req.status,
     'Assigned to ' || coalesce(v_field.full_name, 'field personnel')
     || case when coalesce(p_notes, '') <> '' then ' — ' || left(p_notes, 200) else '' end);

  return jsonb_build_object('assignment_id', v_assignment_id);
end $$;

create or replace function public.app_accept_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_asg public.lb_assignments;
  v_req public.lb_service_requests;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_asg from public.lb_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if v_asg.assigned_to is distinct from v_uid then
    raise exception 'You can only manage your own assignments';
  end if;
  if v_asg.status not in ('pending') then
    raise exception 'This assignment is no longer pending';
  end if;

  select * into v_req from public.lb_service_requests where id = v_asg.request_id;

  update public.lb_assignments
  set status = 'in_progress', accepted_at = now(), updated_at = now()
  where id = p_assignment_id;

  update public.lb_service_requests
  set status = 'in_progress', updated_at = now()
  where id = v_asg.request_id and status in ('verified','assigned');

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, previous_status, new_status, remarks)
  values
    (v_asg.request_id, v_uid, coalesce(nullif((select full_name from public.lb_profiles where id = v_uid), ''), 'Field personnel'),
     'status_change', v_req.status, 'in_progress', 'Assignment accepted — work started');

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_decline_assignment(p_assignment_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_asg  public.lb_assignments;
  v_req  public.lb_service_requests;
  v_uid  uuid := auth.uid();
  v_name text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_reason is null then raise exception 'A decline reason is required'; end if;

  select * into v_asg from public.lb_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if v_asg.assigned_to is distinct from v_uid then
    raise exception 'You can only manage your own assignments';
  end if;
  if v_asg.status not in ('pending','in_progress') then
    raise exception 'This assignment cannot be declined';
  end if;

  select coalesce(nullif(full_name, ''), 'Field personnel') into v_name
  from public.lb_profiles where id = v_uid;

  select * into v_req from public.lb_service_requests where id = v_asg.request_id;

  update public.lb_assignments
  set status = 'declined', decline_reason = v_reason, updated_at = now()
  where id = p_assignment_id;

  update public.lb_service_requests
  set assigned_to = null,
      status = case when status = 'in_progress' then 'assigned' else status end,
      updated_at = now()
  where id = v_asg.request_id;

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, previous_status, new_status, remarks)
  values
    (v_asg.request_id, v_uid, v_name, 'reassign', v_req.status, v_req.status,
     'Assignment declined — ' || v_reason);

  -- Notify active dispatchers of the department so they can reassign
  insert into public.lb_notifications (user_id, title, message, request_id, is_read)
  select p.id,
         left('[' || coalesce(v_req.reference, 'Request') || '] ' || v_req.title, 150),
         'Field personnel declined the assignment: ' || left(v_reason, 200),
         v_req.id, false
  from public.lb_profiles p
  where p.role = 'worker' and p.worker_function = 'dispatcher' and p.status = 'active' and p.department_id = v_req.department_id;

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_update_job_progress(p_assignment_id uuid, p_remarks text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_asg  public.lb_assignments;
  v_uid  uuid := auth.uid();
  v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_remarks is null then raise exception 'Progress notes are required'; end if;

  select * into v_asg from public.lb_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if v_asg.assigned_to is distinct from v_uid then
    raise exception 'You can only update your own assignments';
  end if;
  if v_asg.status not in ('pending','accepted','in_progress') then
    raise exception 'This assignment is no longer active';
  end if;

  update public.lb_assignments
  set status = case when status = 'pending' then 'in_progress' else status end,
      notes = left(coalesce(notes, '') || case when coalesce(notes, '') <> '' then E'\n' else '' end || v_remarks, 2000),
      updated_at = now()
  where id = p_assignment_id;

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, remarks)
  values
    (v_asg.request_id, v_uid, coalesce(nullif((select full_name from public.lb_profiles where id = v_uid), ''), 'Field personnel'),
     'comment', v_remarks);

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_complete_job(p_assignment_id uuid, p_remarks text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_asg  public.lb_assignments;
  v_req  public.lb_service_requests;
  v_uid  uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_asg from public.lb_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if v_asg.assigned_to is distinct from v_uid then
    raise exception 'You can only complete your own assignments';
  end if;
  if v_asg.status not in ('pending','accepted','in_progress') then
    raise exception 'This assignment is no longer active';
  end if;

  select coalesce(nullif(full_name, ''), 'Field personnel') into v_name
  from public.lb_profiles where id = v_uid;

  select * into v_req from public.lb_service_requests where id = v_asg.request_id;

  update public.lb_assignments
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = p_assignment_id;

  update public.lb_service_requests
  set status = 'for_inspection', updated_at = now()
  where id = v_asg.request_id;

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, previous_status, new_status, remarks)
  values
    (v_asg.request_id, v_uid, v_name, 'status_change', v_req.status, 'for_inspection',
     'Work completed — ready for inspection' || case when coalesce(p_remarks, '') <> '' then ' — ' || left(p_remarks, 300) else '' end);

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Participant RPCs: comments, info replies, escalation
-- ---------------------------------------------------------------------------
create or replace function public.app_add_comment(p_request_id uuid, p_remarks text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_status text;
  v_name  text;
  v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
  v_req   public.lb_service_requests;
  v_can   boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_remarks is null or length(v_remarks) > 2000 then raise exception 'A comment (max 2000 chars) is required'; end if;

  select coalesce(worker_function, role), status, coalesce(nullif(full_name, ''), 'User') into v_role, v_status, v_name
  from public.lb_profiles where id = v_uid;
  if not found or v_status <> 'active' then raise exception 'Your account is not active'; end if;

  select * into v_req from public.lb_service_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;

  v_can := public.app_can_access_request(p_request_id)
    or (v_role = 'field' and exists (
      select 1 from public.lb_assignments a where a.request_id = p_request_id and a.assigned_to = v_uid));

  if not v_can then raise exception 'You cannot comment on this request'; end if;

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, remarks)
  values (p_request_id, v_uid, v_name, 'comment', v_remarks);

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_reply_info_request(p_request_id uuid, p_remarks text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text;
  v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
  v_req     public.lb_service_requests;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_remarks is null then raise exception 'A reply is required'; end if;

  select coalesce(nullif(full_name, ''), 'Resident') into v_name
  from public.lb_profiles where id = v_uid;

  select * into v_req from public.lb_service_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;
  if v_req.submitted_by is distinct from v_uid then
    raise exception 'You can only reply to your own requests';
  end if;
  if v_req.status <> 'needs_information' then
    raise exception 'This request is not waiting for information';
  end if;

  update public.lb_service_requests
  set status = 'for_verification', updated_at = now()
  where id = p_request_id;

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, previous_status, new_status, remarks)
  values
    (p_request_id, v_uid, v_name, 'info_reply', 'needs_information', 'for_verification', v_remarks);

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_escalate_request(p_request_id uuid, p_remarks text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_status  text;
  v_brgy    uuid;
  v_dept    uuid;
  v_name    text;
  v_req     public.lb_service_requests;
  v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select coalesce(worker_function, role), status, barangay_id, department_id, coalesce(nullif(full_name, ''), 'Staff')
  into v_role, v_status, v_brgy, v_dept, v_name
  from public.lb_profiles where id = v_uid;
  if v_role not in ('officer','captain','dispatcher','admin') or v_status <> 'active' then
    raise exception 'Only staff can escalate requests';
  end if;

  select * into v_req from public.lb_service_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;

  if v_role in ('officer','captain') and v_req.barangay_id is distinct from v_brgy then
    raise exception 'This request belongs to another barangay';
  end if;
  if v_role = 'dispatcher' and v_req.department_id is distinct from v_dept then
    raise exception 'This request belongs to another department';
  end if;

  update public.lb_service_requests
  set priority = case when priority in ('normal','low') then 'high' else priority end,
      escalation_count = escalation_count + 1,
      updated_at = now()
  where id = p_request_id;

  insert into public.lb_request_updates
    (request_id, actor_id, actor_name, type, remarks)
  values
    (p_request_id, v_uid, v_name, 'escalation', coalesce(v_remarks, 'Request escalated for priority attention'));

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Execution grants
-- ---------------------------------------------------------------------------
revoke all on function public.app_transition_request(uuid, text, text, jsonb) from public, anon;
revoke all on function public.app_assign_field(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.app_accept_assignment(uuid) from public, anon;
revoke all on function public.app_decline_assignment(uuid, text) from public, anon;
revoke all on function public.app_update_job_progress(uuid, text) from public, anon;
revoke all on function public.app_complete_job(uuid, text) from public, anon;
revoke all on function public.app_add_comment(uuid, text) from public, anon;
revoke all on function public.app_reply_info_request(uuid, text) from public, anon;
revoke all on function public.app_escalate_request(uuid, text) from public, anon;
revoke all on function public.app_submit_anonymous_report(text, text, uuid, text) from public;
revoke all on function public.app_track_request(text, text) from public;

grant execute on function public.app_transition_request(uuid, text, text, jsonb) to authenticated;
grant execute on function public.app_assign_field(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.app_accept_assignment(uuid) to authenticated;
grant execute on function public.app_decline_assignment(uuid, text) to authenticated;
grant execute on function public.app_update_job_progress(uuid, text) to authenticated;
grant execute on function public.app_complete_job(uuid, text) to authenticated;
grant execute on function public.app_add_comment(uuid, text) to authenticated;
grant execute on function public.app_reply_info_request(uuid, text) to authenticated;
grant execute on function public.app_escalate_request(uuid, text) to authenticated;
grant execute on function public.app_submit_anonymous_report(text, text, uuid, text) to anon, authenticated;
grant execute on function public.app_track_request(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Realtime (safe if the publication is absent)
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.lb_notifications;
exception when duplicate_object then null; when undefined_object then null; when insufficient_privilege then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.lb_service_requests;
exception when duplicate_object then null; when undefined_object then null; when insufficient_privilege then null;
end $$;
