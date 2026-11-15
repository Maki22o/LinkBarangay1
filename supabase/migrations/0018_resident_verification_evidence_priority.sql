-- Resident ID approval, mandatory request evidence, and intake priority.
-- Existing resident accounts are grandfathered as approved; new resident
-- verification rows start pending and require an administrator decision.

alter table public.lb_service_requests add column if not exists priority_rank smallint
  generated always as (case priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end) stored;
create index if not exists lb_requests_priority_rank_idx on public.lb_service_requests(priority_rank, created_at desc);

create table if not exists public.lb_resident_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.lb_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lb_resident_verification_file_check check (
    status = 'approved' or (storage_path is not null and submitted_at is not null)
  ),
  constraint lb_resident_verification_mime_check check (
    mime_type is null or mime_type in ('image/jpeg','image/png','image/webp','application/pdf')
  ),
  constraint lb_resident_verification_size_check check (size_bytes is null or size_bytes between 1 and 10485760)
);

alter table public.lb_resident_verifications enable row level security;
revoke all on public.lb_resident_verifications from public, anon;
grant select on public.lb_resident_verifications to authenticated;
drop policy if exists lb_resident_verifications_read on public.lb_resident_verifications;
create policy lb_resident_verifications_read on public.lb_resident_verifications
  for select to authenticated
  using (user_id = (select auth.uid()) or public.app_is_admin());

-- Do not force existing resident accounts to re-verify. New signups are
-- guarded by the request RPC until they submit an ID and an admin approves it.
insert into public.lb_resident_verifications (user_id, status)
select p.id, 'approved' from public.lb_profiles p
where p.role = 'resident'
on conflict (user_id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resident-verification-ids','resident-verification-ids',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists lb_resident_id_upload on storage.objects;
drop policy if exists lb_resident_id_admin_read on storage.objects;
create policy lb_resident_id_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resident-verification-ids'
    and owner = (select auth.uid())
    and name like ((select auth.uid())::text || '/%')
    and exists (select 1 from public.lb_profiles p
      where p.id = (select auth.uid()) and p.role = 'resident' and p.status = 'active')
  );
create policy lb_resident_id_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'resident-verification-ids' and public.app_is_admin());

create or replace function public.app_submit_resident_verification(
  p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_uid uuid := auth.uid();
  v_verification public.lb_resident_verifications;
  v_admin public.lb_profiles;
begin
  if v_uid is null then raise exception 'Sign in before submitting your ID'; end if;
  if not exists (select 1 from public.lb_profiles where id = v_uid and role = 'resident' and status = 'active') then
    raise exception 'Only active resident accounts may submit an ID';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || v_uid::text || '/[A-Za-z0-9_.() -]+$') then
    raise exception 'Invalid ID storage path';
  end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf')
     or p_size_bytes < 1 or p_size_bytes > 10485760 then
    raise exception 'Upload a JPG, PNG, WebP, or PDF ID file up to 10 MB';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'resident-verification-ids'
      and name = p_storage_path and owner = v_uid) then
    raise exception 'The uploaded ID file could not be verified';
  end if;
  if exists (select 1 from public.lb_resident_verifications where user_id = v_uid and status = 'approved') then
    raise exception 'This resident account is already approved';
  end if;
  insert into public.lb_resident_verifications
    (user_id,status,storage_path,file_name,mime_type,size_bytes,rejection_reason,submitted_at,reviewed_at,reviewed_by,updated_at)
  values (v_uid,'pending',p_storage_path,left(coalesce(p_file_name,'ID document'),180),p_mime_type,p_size_bytes,
    null,now(),null,null,now())
  on conflict (user_id) do update set
    status='pending',storage_path=excluded.storage_path,file_name=excluded.file_name,
    mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,rejection_reason=null,
    submitted_at=now(),reviewed_at=null,reviewed_by=null,updated_at=now()
  returning * into v_verification;
  update public.lb_profiles set updated_at=now() where id=v_uid;
  for v_admin in select * from public.lb_profiles where role='admin' and status='active' loop
    perform public.app_emit_notification(v_admin.id,'resident-verification-submitted:'||v_verification.id,
      'resident.verification.review','Resident ID Review Required',
      'A resident submitted an identification document for address verification.',null,'users',v_uid);
  end loop;
  return jsonb_build_object('status',v_verification.status);
end $$;
revoke all on function public.app_submit_resident_verification(text,text,text,bigint) from public,anon;
grant execute on function public.app_submit_resident_verification(text,text,text,bigint) to authenticated;

create or replace function public.app_review_resident_verification(
  p_user_id uuid, p_decision text, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.lb_resident_verifications;
  v_name text;
begin
  if v_actor is null or not exists (select 1 from public.lb_profiles
    where id=v_actor and role='admin' and status='active') then
    raise exception 'Only active administrators can review resident IDs';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  if p_decision='rejected' and length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Provide a clear reason for rejection';
  end if;
  select * into v_row from public.lb_resident_verifications where user_id=p_user_id for update;
  if not found or v_row.status <> 'pending' or v_row.storage_path is null then
    raise exception 'No pending ID submission is available for this resident';
  end if;
  select coalesce(nullif(full_name,''),'Resident') into v_name from public.lb_profiles where id=p_user_id;
  update public.lb_resident_verifications set status=p_decision,
    rejection_reason=case when p_decision='rejected' then left(trim(p_reason),600) else null end,
    reviewed_at=now(),reviewed_by=v_actor,updated_at=now()
    where user_id=p_user_id returning * into v_row;
  update public.lb_profiles set updated_at=now() where id=p_user_id;
  perform public.app_emit_notification(p_user_id,
    'resident-verification-decision:'||v_row.id||':'||v_row.status,
    'resident.verification.'||v_row.status,
    case when p_decision='approved' then 'Resident Account Approved' else 'ID Verification Needs Correction' end,
    case when p_decision='approved' then 'Your address and ID were approved. You can now submit service requests.'
      else 'Your ID verification was rejected. '||left(trim(p_reason),500)||' Please submit a corrected document from My Profile.' end,
    null,'profile',p_user_id);
  return jsonb_build_object('status',v_row.status);
end $$;
revoke all on function public.app_review_resident_verification(uuid,text,text) from public,anon;
grant execute on function public.app_review_resident_verification(uuid,text,text) to authenticated;

create or replace function public.app_resident_is_verified(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lb_profiles p
    join public.lb_resident_verifications v on v.user_id=p.id
    where p.id=p_user_id and p.role='resident' and p.status='active' and v.status='approved')
$$;
revoke all on function public.app_resident_is_verified(uuid) from public,anon;
grant execute on function public.app_resident_is_verified(uuid) to authenticated;

-- Supporting evidence is staged before the request transaction, then claimed
-- by the security-definer RPC. A request row is never created without it.
alter table public.lb_attachments drop constraint if exists lb_attachments_kind_check;
alter table public.lb_attachments add constraint lb_attachments_kind_check
  check (kind in ('supporting_doc','before_photo','after_photo','reply_doc','completion_doc','request_evidence'));
drop policy if exists lb_attachments_insert on public.lb_attachments;
create policy lb_attachments_insert on public.lb_attachments for insert to authenticated
  with check (
    owner_id=(select auth.uid()) and public.app_is_active()
    and ((request_id is null and kind='request_evidence' and public.app_resident_is_verified())
      or (request_id is not null and exists (select 1 from public.lb_service_requests r
        where r.id=request_id and public.app_can_access_request(r.id))))
  );
drop policy if exists lb_attachments_delete_staged on public.lb_attachments;
create policy lb_attachments_delete_staged on public.lb_attachments for delete to authenticated
  using (owner_id=(select auth.uid()) and request_id is null and kind='request_evidence');
drop policy if exists lb_request_evidence_storage_delete on storage.objects;
create policy lb_request_evidence_storage_delete on storage.objects for delete to authenticated
  using (bucket_id='request-attachments' and owner=(select auth.uid())
    and name like ('staged/'||(select auth.uid())::text||'/%'));

update storage.buckets set file_size_limit=52428800,
  allowed_mime_types=array['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif',
    'application/pdf','video/mp4','video/webm','video/quicktime']
where id='request-attachments';

create or replace function public.app_submit_resident_request_with_evidence(
  p_title text, p_description text, p_category_id uuid, p_location text, p_evidence_path text
) returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
  v_barangay uuid;
  v_name text;
  v_title text := nullif(trim(coalesce(p_title,'')),'');
  v_description text := nullif(trim(coalesce(p_description,'')),'');
  v_location text := nullif(trim(coalesce(p_location,'')),'');
  v_request public.lb_service_requests;
  v_attempt integer := 0;
  v_reference text;
  v_tracking text;
  v_attachment uuid;
begin
  if v_uid is null then raise exception 'Sign in to submit a resident request'; end if;
  select role,status,barangay_id,coalesce(nullif(full_name,''),'Resident')
    into v_role,v_status,v_barangay,v_name from public.lb_profiles where id=v_uid;
  if not found or v_role<>'resident' or v_status<>'active' then raise exception 'Only active residents can submit requests'; end if;
  if not public.app_resident_is_verified(v_uid) then raise exception 'Your resident account must be approved before submitting requests'; end if;
  if v_barangay is null or not exists(select 1 from public.lb_barangays where id=v_barangay and is_active) then
    raise exception 'Your account needs an active barangay assignment'; end if;
  if v_title is null or length(v_title)<4 or length(v_title)>150 then raise exception 'Enter a request title between 4 and 150 characters'; end if;
  if v_description is null or length(v_description)<10 or length(v_description)>4000 then raise exception 'Enter a description between 10 and 4000 characters'; end if;
  if v_location is null or length(v_location)>300 then raise exception 'Enter a request location'; end if;
  if not exists(select 1 from public.lb_service_categories where id=p_category_id and is_active) then raise exception 'Select an active service category'; end if;
  select id into v_attachment from public.lb_attachments where owner_id=v_uid and request_id is null
    and kind='request_evidence' and storage_path=p_evidence_path for update;
  if not found or not exists(select 1 from storage.objects where bucket_id='request-attachments'
      and name=p_evidence_path and owner=v_uid) then
    raise exception 'Upload valid photo or video evidence before submitting';
  end if;
  loop
    v_attempt:=v_attempt+1;
    v_reference:='LB-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*9000)+1000)::text,4,'0');
    v_tracking:=upper(substring(md5(random()::text) from 1 for 6));
    begin
      insert into public.lb_service_requests(title,description,category_id,location,barangay_id,
        submitted_by,status,priority,is_anonymous,reference,tracking_code)
      values(v_title,v_description,p_category_id,v_location,v_barangay,v_uid,'submitted','normal',false,v_reference,v_tracking)
      returning * into v_request;
      exit;
    exception when unique_violation then if v_attempt>=5 then raise; end if;
    end;
  end loop;
  update public.lb_attachments set request_id=v_request.id where id=v_attachment;
  insert into public.lb_request_updates(request_id,actor_id,actor_name,type,previous_status,new_status,remarks)
    values(v_request.id,v_uid,v_name,'status_change',null,'submitted','Request submitted with required photo/video evidence.');
  return jsonb_build_object('request',to_jsonb(v_request));
end $$;
revoke all on function public.app_submit_resident_request_with_evidence(text,text,uuid,text,text) from public,anon;
grant execute on function public.app_submit_resident_request_with_evidence(text,text,uuid,text,text) to authenticated;
revoke all on function public.app_submit_resident_request(text,text,uuid,text) from public,anon,authenticated;

create or replace function public.app_set_request_priority(p_request_id uuid,p_priority text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid:=auth.uid(); v_role text; v_status text; v_barangay uuid; v_name text;
  v_request public.lb_service_requests;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_priority not in ('high','medium','low') then raise exception 'Priority must be high, medium, or low'; end if;
  select coalesce(worker_function,role),status,barangay_id,coalesce(nullif(full_name,''),'Staff')
    into v_role,v_status,v_barangay,v_name from public.lb_profiles where id=v_uid;
  if v_status<>'active' or v_role not in ('secretary','officer','captain','barangay_staff','admin') then
    raise exception 'Only active barangay staff and administrators can set request priority'; end if;
  select * into v_request from public.lb_service_requests where id=p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.priority=p_priority then return jsonb_build_object('request',to_jsonb(v_request)); end if;
  if v_role<>'admin' and v_request.barangay_id is distinct from v_barangay then raise exception 'This request belongs to another barangay'; end if;
  update public.lb_service_requests set priority=p_priority,updated_at=now() where id=p_request_id returning * into v_request;
  insert into public.lb_request_updates(request_id,actor_id,actor_name,type,remarks)
    values(p_request_id,v_uid,v_name,'priority_change','Priority set to '||p_priority||'.');
  if v_request.submitted_by is not null then
    perform public.app_emit_notification(v_request.submitted_by,'request-priority:'||v_request.id||':'||v_request.updated_at,
      'request.priority','Request Priority Updated','Your request was marked '||p_priority||' priority.',v_request.id,'request-detail',v_request.id);
  end if;
  return jsonb_build_object('request',to_jsonb(v_request));
end $$;
revoke all on function public.app_set_request_priority(uuid,text) from public,anon;
grant execute on function public.app_set_request_priority(uuid,text) to authenticated;

notify pgrst,'reload schema';
alter table public.lb_service_requests add column if not exists priority_rank smallint
  generated always as (case priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end) stored;
create index if not exists lb_requests_priority_rank_idx on public.lb_service_requests(priority_rank, created_at desc);
