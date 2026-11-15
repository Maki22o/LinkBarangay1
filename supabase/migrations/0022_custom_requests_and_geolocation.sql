-- Custom resident requests and exact map locations. Custom requests remain in
-- lb_service_requests so they retain the normal workflow and access controls.

alter table public.lb_service_requests
  add column if not exists is_custom boolean not null default false,
  add column if not exists location_latitude numeric(9,6),
  add column if not exists location_longitude numeric(9,6),
  add column if not exists location_details jsonb not null default '{}'::jsonb;

alter table public.lb_service_requests
  drop constraint if exists lb_requests_location_latitude_check,
  drop constraint if exists lb_requests_location_longitude_check,
  drop constraint if exists lb_requests_location_details_check;
alter table public.lb_service_requests
  add constraint lb_requests_location_latitude_check check (location_latitude is null or location_latitude between -90 and 90),
  add constraint lb_requests_location_longitude_check check (location_longitude is null or location_longitude between -180 and 180),
  add constraint lb_requests_location_details_check check (jsonb_typeof(location_details) = 'object');
create index if not exists lb_requests_custom_created_idx on public.lb_service_requests(is_custom, created_at desc);

create or replace function public.app_submit_resident_request_with_evidence_v2(
  p_title text, p_description text, p_category_id uuid, p_location text, p_evidence_path text,
  p_is_custom boolean, p_latitude numeric, p_longitude numeric, p_location_details jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_uid uuid := auth.uid(); v_role text; v_status text; v_barangay uuid; v_name text;
  v_title text := nullif(trim(coalesce(p_title,'')), '');
  v_description text := nullif(trim(coalesce(p_description,'')), '');
  v_location text := nullif(trim(coalesce(p_location,'')), '');
  v_request public.lb_service_requests; v_attempt integer := 0; v_reference text; v_tracking text; v_attachment uuid;
begin
  if v_uid is null then raise exception 'Sign in to submit a resident request'; end if;
  select role,status,barangay_id,coalesce(nullif(full_name,''),'Resident') into v_role,v_status,v_barangay,v_name from public.lb_profiles where id=v_uid;
  if not found or v_role <> 'resident' or v_status <> 'active' then raise exception 'Only active residents can submit requests'; end if;
  if not public.app_resident_is_verified(v_uid) then raise exception 'Your resident account must be approved before submitting requests'; end if;
  if v_barangay is null or not exists(select 1 from public.lb_barangays where id=v_barangay and is_active) then raise exception 'Your account needs an active barangay assignment'; end if;
  if v_title is null or length(v_title)<4 or length(v_title)>150 then raise exception 'Enter a request title between 4 and 150 characters'; end if;
  if v_description is null or length(v_description)<10 or length(v_description)>4000 then raise exception 'Enter a description between 10 and 4000 characters'; end if;
  if v_location is null or length(v_location)>300 then raise exception 'Select a valid request location'; end if;
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Pin a valid location on the map before continuing'; end if;
  if coalesce(p_is_custom,false) then
    if p_category_id is not null then raise exception 'Custom requests cannot use a preset category'; end if;
  elsif not exists(select 1 from public.lb_service_categories where id=p_category_id and is_active) then raise exception 'Select an active service category'; end if;
  if jsonb_typeof(coalesce(p_location_details, '{}'::jsonb)) <> 'object' then raise exception 'Invalid location details'; end if;
  select id into v_attachment from public.lb_attachments where owner_id=v_uid and request_id is null and kind='request_evidence' and storage_path=p_evidence_path for update;
  if not found or not exists(select 1 from storage.objects where bucket_id='request-attachments' and name=p_evidence_path and owner=v_uid) then raise exception 'Upload valid photo or video evidence before submitting'; end if;
  loop
    v_attempt:=v_attempt+1; v_reference:='LB-'||to_char(now(),'YYYY')||'-'||lpad((floor(random()*9000)+1000)::text,4,'0'); v_tracking:=upper(substring(md5(random()::text) from 1 for 6));
    begin
      insert into public.lb_service_requests(title,description,category_id,location,location_latitude,location_longitude,location_details,is_custom,barangay_id,submitted_by,status,priority,is_anonymous,reference,tracking_code)
      values(v_title,v_description,p_category_id,v_location,p_latitude,p_longitude,coalesce(p_location_details,'{}'::jsonb),coalesce(p_is_custom,false),v_barangay,v_uid,'submitted','normal',false,v_reference,v_tracking)
      returning * into v_request; exit;
    exception when unique_violation then if v_attempt>=5 then raise; end if;
    end;
  end loop;
  update public.lb_attachments set request_id=v_request.id where id=v_attachment;
  insert into public.lb_request_updates(request_id,actor_id,actor_name,type,previous_status,new_status,remarks)
    values(v_request.id,v_uid,v_name,'status_change',null,'submitted',case when v_request.is_custom then 'Custom request submitted with required photo/video evidence.' else 'Request submitted with required photo/video evidence.' end);
  return jsonb_build_object('request',to_jsonb(v_request));
end $$;
revoke all on function public.app_submit_resident_request_with_evidence_v2(text,text,uuid,text,text,boolean,numeric,numeric,jsonb) from public, anon;
grant execute on function public.app_submit_resident_request_with_evidence_v2(text,text,uuid,text,text,boolean,numeric,numeric,jsonb) to authenticated;
notify pgrst, 'reload schema';
