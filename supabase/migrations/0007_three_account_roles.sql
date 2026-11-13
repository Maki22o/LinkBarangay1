-- LinkBarangay migration 0007 — three operational account roles.
-- Legacy staff roles become role='worker' with their old role retained as
-- worker_function so existing least-privilege workflow behavior is preserved.

alter table public.lb_profiles add column if not exists worker_function text;

update public.lb_profiles
set worker_function = case when role in ('secretary','officer','captain','dispatcher','field') then role else null end,
    role = case when role in ('secretary','officer','captain','dispatcher','field') then 'worker' else role end;

alter table public.lb_profiles drop constraint if exists lb_profiles_role_check;
alter table public.lb_profiles drop constraint if exists lb_profiles_worker_function_check;
alter table public.lb_profiles drop constraint if exists lb_profiles_worker_function_role_check;
alter table public.lb_profiles add constraint lb_profiles_role_check
  check (role in ('resident','worker','admin'));
alter table public.lb_profiles add constraint lb_profiles_worker_function_check
  check (worker_function is null or worker_function in ('secretary','officer','captain','dispatcher','field'));
alter table public.lb_profiles add constraint lb_profiles_worker_function_role_check
  check ((role = 'worker' and worker_function is not null) or (role <> 'worker' and worker_function is null));

create index if not exists lb_profiles_worker_function_idx
  on public.lb_profiles (worker_function) where role = 'worker';

-- RLS policies from migration 0004 use this helper to evaluate worker scope.
-- Persisted account roles remain limited to resident, worker, and admin.
create or replace function public.app_current_role()
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(worker_function, role) from public.lb_profiles where id = auth.uid()
$$;

create or replace function public.app_is_active_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lb_profiles
    where id = auth.uid() and status = 'active' and role in ('worker','admin')
  )
$$;

-- Prevent self-promotion, including changing a worker's function. Only admins
-- may change role/function/status/scope for another account.
create or replace function public.app_guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  caller_role text;
  caller_status text;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then return new; end if;
  select role, status into caller_role, caller_status
  from public.lb_profiles where id = v_caller;
  if caller_role is null then raise exception 'Caller has no profile; profile updates denied'; end if;

  if v_caller = new.id then
    if new.role is distinct from old.role
      or new.worker_function is distinct from old.worker_function
      or new.status is distinct from old.status
      or new.barangay_id is distinct from old.barangay_id
      or new.department_id is distinct from old.department_id then
      raise exception 'Users cannot change their own role, worker function, status, barangay, or department';
    end if;
    return new;
  end if;

  if caller_role <> 'admin' or caller_status <> 'active' then
    raise exception 'Only active administrators may modify other accounts';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Track worker-function changes in the same security audit event as role changes.
create or replace function public.app_audit_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role)
    or (new.worker_function is distinct from old.worker_function)
    or (new.status is distinct from old.status)
    or (new.barangay_id is distinct from old.barangay_id)
    or (new.department_id is distinct from old.department_id) then
    insert into public.lb_audit_logs
      (actor_id, actor_name, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      coalesce((select full_name from public.lb_profiles where id = auth.uid()), 'System'),
      'account.update', 'lb_profiles', new.id::text,
      jsonb_build_object(
        'email', new.email,
        'old_role', old.role, 'new_role', new.role,
        'old_worker_function', old.worker_function, 'new_worker_function', new.worker_function,
        'old_status', old.status, 'new_status', new.status,
        'old_barangay', old.barangay_id, 'new_barangay', new.barangay_id,
        'old_department', old.department_id, 'new_department', new.department_id
      )
    );
  end if;
  return new;
end $$;

-- Preserve workflow authorization by reading worker_function for RPCs that
-- historically inspected role directly. Fail migration if a live definition
-- has drifted instead of silently leaving a broken worker endpoint.
do $$
declare
  fn record;
  v_definition text;
  v_updated text;
  v_replacements integer;
  v_function_count integer := 0;
  old_text text;
  new_text text;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_transition_request','app_assign_field','app_add_comment','app_escalate_request','app_decline_assignment')
  loop
    v_function_count := v_function_count + 1;
    v_definition := pg_get_functiondef(fn.oid);
    v_updated := v_definition;
    v_replacements := 0;

    if fn.proname in ('app_transition_request','app_add_comment') then
      old_text := 'select role, status,';
      new_text := 'select coalesce(worker_function, role), status,';
      if position(old_text in v_updated) > 0 then
        v_updated := replace(v_updated, old_text, new_text);
        v_replacements := v_replacements + 1;
      end if;
    elsif fn.proname = 'app_assign_field' then
      old_text := 'select role, status, department_id,';
      new_text := 'select coalesce(worker_function, role), status, department_id,';
      if position(old_text in v_updated) > 0 then
        v_updated := replace(v_updated, old_text, new_text);
        v_replacements := v_replacements + 1;
      end if;
      old_text := 'v_field.role <> ''field''';
      new_text := '(v_field.role <> ''worker'' or v_field.worker_function <> ''field'')';
      if position(old_text in v_updated) > 0 then
        v_updated := replace(v_updated, old_text, new_text);
        v_replacements := v_replacements + 1;
      end if;
    elsif fn.proname = 'app_escalate_request' then
      old_text := 'select role, status, barangay_id, department_id,';
      new_text := 'select coalesce(worker_function, role), status, barangay_id, department_id,';
      if position(old_text in v_updated) > 0 then
        v_updated := replace(v_updated, old_text, new_text);
        v_replacements := v_replacements + 1;
      end if;
    elsif fn.proname = 'app_decline_assignment' then
      old_text := 'where p.role = ''dispatcher'' and p.status = ''active''';
      new_text := 'where p.role = ''worker'' and p.worker_function = ''dispatcher'' and p.status = ''active''';
      if position(old_text in v_updated) > 0 then
        v_updated := replace(v_updated, old_text, new_text);
        v_replacements := v_replacements + 1;
      end if;
    end if;

    if v_replacements = 0 then
      raise exception 'No known role query found in public.%; refusing incomplete role migration', fn.proname;
    end if;
    execute v_updated;
  end loop;
  if v_function_count <> 5 then
    raise exception 'Expected five workflow role functions, found %; refusing incomplete role migration', v_function_count;
  end if;
end $$;

-- Keep the compatibility helpers private to the API roles that need them.
revoke all on function public.app_current_role() from public, anon;
grant execute on function public.app_current_role() to authenticated;
revoke all on function public.app_is_active_staff() from public, anon;
grant execute on function public.app_is_active_staff() to authenticated;

-- These profile/scope helpers are only needed by signed-in RLS policies.
revoke all on function public.app_current_status() from public, anon;
revoke all on function public.app_current_barangay() from public, anon;
revoke all on function public.app_current_department() from public, anon;
revoke all on function public.app_current_full_name() from public, anon;
revoke all on function public.app_is_active() from public, anon;
revoke all on function public.app_is_admin() from public, anon;
revoke all on function public.app_can_access_request(uuid) from public, anon;
grant execute on function public.app_current_status() to authenticated;
grant execute on function public.app_current_barangay() to authenticated;
grant execute on function public.app_current_department() to authenticated;
grant execute on function public.app_current_full_name() to authenticated;
grant execute on function public.app_is_active() to authenticated;
grant execute on function public.app_is_admin() to authenticated;
grant execute on function public.app_can_access_request(uuid) to authenticated;

-- Trigger functions are invoked by their triggers, not by API clients.
revoke all on function public.app_audit_profile_change() from public, anon, authenticated;
revoke all on function public.app_guard_profile_update() from public, anon, authenticated;
revoke all on function public.app_handle_new_user() from public, anon, authenticated;
revoke all on function public.app_log_request_created() from public, anon, authenticated;
revoke all on function public.app_notify_on_update() from public, anon, authenticated;

alter function public.app_guard_request_update() set search_path = public;
