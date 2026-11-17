-- Staff applicants (pending sign-ups) must upload a valid ID that admins can view.
-- Reuses lb_resident_verifications and the private resident-verification-ids bucket.
drop policy if exists lb_resident_id_upload on storage.objects;
create policy lb_resident_id_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resident-verification-ids'
    and owner = (select auth.uid())
    and name like ((select auth.uid())::text || '/%')
    and exists (select 1 from public.lb_profiles p
      where p.id = (select auth.uid()) and p.role = 'resident' and p.status in ('active','pending'))
  );

create or replace function public.app_submit_resident_verification(
  p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_uid uuid := auth.uid();
  v_verification public.lb_resident_verifications;
  v_admin public.lb_profiles;
  v_pending boolean;
begin
  if v_uid is null then raise exception 'Sign in before submitting your ID'; end if;
  if not exists (select 1 from public.lb_profiles where id = v_uid and role = 'resident' and status in ('active','pending')) then
    raise exception 'Only resident or pending staff applicant accounts may submit an ID';
  end if;
  select (status = 'pending') into v_pending from public.lb_profiles where id = v_uid;
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
      case when v_pending then 'staff.application.review' else 'resident.verification.review' end,
      case when v_pending then 'Staff Application ID Submitted' else 'Resident ID Review Required' end,
      case when v_pending then 'A staff applicant uploaded a valid ID. Review it under User Management.' else 'A resident submitted an identification document for address verification.' end,null,'users',v_uid);
  end loop;
  return jsonb_build_object('status',v_verification.status);
end $$;
revoke all on function public.app_submit_resident_verification(text,text,text,bigint) from public,anon;
grant execute on function public.app_submit_resident_verification(text,text,text,bigint) to authenticated;
