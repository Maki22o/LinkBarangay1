-- Read-only checks for an existing LinkBarangay project BEFORE applying 0015.
-- Run the whole file in SQL Editor. Do not run bootstrap/test fixtures on live data.
begin read only;

do $$
declare
  v_table text;
  signature text;
  definition text;
  field_read text := 'select * into v_asg from public.lb_assignments where id = p_assignment_id;';
  comment_access text := 'v_can := public.app_can_access_request(p_request_id)
    or (v_role = ''field'' and exists (
      select 1 from public.lb_assignments a where a.request_id = p_request_id and a.assigned_to = v_uid));';
begin
  if to_regprocedure('public.app_mark_notifications_read(uuid,uuid)') is not null then
    raise exception 'The 0015 read RPC already exists. Verify migration history before rerunning 0015.';
  end if;
  foreach v_table in array array[
    'lb_profiles','lb_service_requests','lb_request_updates','lb_assignments',
    'lb_appointments','lb_attachments','lb_notifications','lb_settings',
    'lb_barangays','lb_departments','lb_service_categories'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Missing public.%. Reconcile migrations 0001-0014 before applying 0015.', v_table;
    end if;
  end loop;
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='lb_profiles' and column_name='worker_function') then
    raise exception 'Missing canonical worker_function. Reconcile migration 0007 first.';
  end if;
  if exists(select 1 from public.lb_profiles where role not in ('resident','worker','admin')) then
    raise exception 'Legacy account roles remain. Reconcile the role migration first.';
  end if;
  if exists(select 1 from pg_attribute where attrelid='public.lb_notifications'::regclass
    and attname='request_id' and attnotnull and not attisdropped) then
    raise exception 'Notification request_id must allow NULL to preserve history when requests are deleted.';
  end if;
  foreach signature in array array[
    'public.app_accept_assignment(uuid)', 'public.app_update_job_progress(uuid,text)',
    'public.app_complete_job(uuid,text)', 'public.app_add_comment(uuid,text)',
    'public.app_transition_request(uuid,text,text,jsonb)',
    'public.app_assign_field(uuid,uuid,timestamp with time zone,timestamp with time zone,text)',
    'public.app_is_active()', 'auth.uid()'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'Missing required workflow function %. Inspect the deployed schema before applying 0015.', signature;
    end if;
  end loop;
  foreach signature in array array[
    'public.app_accept_assignment(uuid)', 'public.app_update_job_progress(uuid,text)',
    'public.app_complete_job(uuid,text)'
  ] loop
    definition := pg_get_functiondef(to_regprocedure(signature));
    if position(field_read in definition)=0 then
      raise exception 'Workflow function % has an unexpected definition. Review 0015 against this deployed version.', signature;
    end if;
  end loop;
  definition := pg_get_functiondef('public.app_add_comment(uuid,text)'::regprocedure);
  if position(comment_access in definition)=0 then
    raise exception 'Comment authorization differs from the expected baseline. Review 0015 before applying it.';
  end if;
  raise notice 'Required pre-0015 tables, roles, and workflow functions are present.';
end $$;

-- Review any additional policies; 0015 retains stricter custom policies and
-- enforces its own recipient boundary even alongside permissive policies.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename='lb_notifications'
order by policyname;

select pubname, pubinsert, pubupdate,
  exists(select 1 from pg_publication_tables p where p.pubname=pub.pubname
    and p.schemaname='public' and p.tablename='lb_notifications') as includes_notifications
from pg_publication pub where pubname='supabase_realtime';
-- If absent or INSERT/UPDATE are disabled, configure Realtime before verification.

commit;
