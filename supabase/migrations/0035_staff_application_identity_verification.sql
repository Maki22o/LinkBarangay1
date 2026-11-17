-- Public staff applicants must provide the same identity/address evidence as
-- residents. They remain role='resident', status='pending' until an admin has
-- reviewed the document and explicitly assigns an active worker role/scope.

begin;

-- A pending profile only occurs for a public staff-access application. Allow
-- that authenticated applicant to place their private evidence in their own
-- folder; no other account can read it, and admins retain review-only access.
drop policy if exists lb_resident_id_upload on storage.objects;
create policy lb_resident_id_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resident-verification-ids'
    and owner = (select auth.uid())
    and name like ((select auth.uid())::text || '/%')
    and exists (
      select 1 from public.lb_profiles p
      where p.id = (select auth.uid())
        and p.role = 'resident'
        and p.status in ('active', 'pending')
    )
  );

create or replace function public.app_submit_resident_verification(
  p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_uid uuid := auth.uid();
  v_verification public.lb_resident_verifications;
  v_admin public.lb_profiles;
begin
  if v_uid is null then raise exception 'Sign in before submitting your ID'; end if;
  if not exists (
    select 1 from public.lb_profiles
    where id = v_uid and role = 'resident' and status in ('active', 'pending')
  ) then
    raise exception 'Only resident or pending staff applications may submit an ID';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || v_uid::text || '/[A-Za-z0-9_.() -]+$') then
    raise exception 'Invalid ID storage path';
  end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf')
     or p_size_bytes < 1 or p_size_bytes > 10485760 then
    raise exception 'Upload a JPG, PNG, WebP, or PDF ID file up to 10 MB';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'resident-verification-ids' and name = p_storage_path and owner = v_uid
  ) then
    raise exception 'The uploaded ID file could not be verified';
  end if;
  if exists (select 1 from public.lb_resident_verifications where user_id = v_uid and status = 'approved') then
    raise exception 'This identity document is already approved';
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
      'resident.verification.review','Identity and Address Review Required',
      'A resident or staff applicant submitted an identity document for address verification.',null,'users',v_uid);
  end loop;
  return jsonb_build_object('status',v_verification.status);
end $$;
revoke all on function public.app_submit_resident_verification(text,text,text,bigint) from public,anon;
grant execute on function public.app_submit_resident_verification(text,text,text,bigint) to authenticated;

-- Reviewing evidence is privileged administration and must have a current
-- AAL2 session after Phase 1 MFA hardening.
create or replace function public.app_review_resident_verification(
  p_user_id uuid, p_decision text, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_row public.lb_resident_verifications;
  v_name text;
begin
  if v_actor is null or not public.app_is_admin() then
    raise exception 'Only MFA-verified active administrators can review identity documents';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  if p_decision='rejected' and length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Provide a clear reason for rejection';
  end if;
  select * into v_row from public.lb_resident_verifications where user_id=p_user_id for update;
  if not found or v_row.status <> 'pending' or v_row.storage_path is null then
    raise exception 'No pending ID submission is available for this account';
  end if;
  select coalesce(nullif(full_name,''),'Applicant') into v_name from public.lb_profiles where id=p_user_id;
  update public.lb_resident_verifications set status=p_decision,
    rejection_reason=case when p_decision='rejected' then left(trim(p_reason),600) else null end,
    reviewed_at=now(),reviewed_by=v_actor,updated_at=now()
    where user_id=p_user_id returning * into v_row;
  update public.lb_profiles set updated_at=now() where id=p_user_id;
  perform public.app_emit_notification(p_user_id,
    'resident-verification-decision:'||v_row.id||':'||v_row.status,
    'resident.verification.'||v_row.status,
    case when p_decision='approved' then 'Identity Document Approved' else 'Identity Document Needs Correction' end,
    case when p_decision='approved' then 'Your identity and residential address were approved. Staff applicants still require role and scope assignment by an administrator.'
      else 'Your identity document was rejected. '||left(trim(p_reason),500)||' Please submit a corrected document from My Profile.' end,
    null,'profile',p_user_id);
  return jsonb_build_object('status',v_row.status);
end $$;
revoke all on function public.app_review_resident_verification(uuid,text,text) from public,anon;
grant execute on function public.app_review_resident_verification(uuid,text,text) to authenticated;

-- Server-side activation guard: an admin cannot turn a public pending staff
-- applicant into an active worker until the submitted document is approved.
create or replace function public.app_guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller_role text;
  caller_status text;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then return new; end if;
  select role, status into caller_role, caller_status from public.lb_profiles where id = v_caller;
  if caller_role is null then raise exception 'Caller has no profile; profile updates denied'; end if;
  if v_caller = new.id then
    if new.role is distinct from old.role or new.worker_function is distinct from old.worker_function
      or new.status is distinct from old.status or new.barangay_id is distinct from old.barangay_id
      or new.department_id is distinct from old.department_id then
      raise exception 'Users cannot change their own role, worker function, status, barangay, or department';
    end if;
    return new;
  end if;
  if caller_role <> 'admin' or caller_status <> 'active' or not public.app_mfa_verified() then
    raise exception 'Only MFA-verified active administrators may modify other accounts';
  end if;
  if new.role = 'admin' and old.role <> 'admin' then
    raise exception 'Admin accounts may only be provisioned through trusted setup';
  end if;
  if new.role = 'worker' and new.status = 'active'
     and not (old.role = 'worker' and old.status = 'active')
     and not exists (
       select 1 from public.lb_resident_verifications v
       where v.user_id = new.id and v.status = 'approved' and v.storage_path is not null
     ) then
    raise exception 'Approve the applicant’s identity and residential-address document before activating staff access';
  end if;
  new.updated_at := now();
  return new;
end $$;

notify pgrst, 'reload schema';
commit;
