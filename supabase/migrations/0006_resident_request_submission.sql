-- LinkBarangay migration 0006 — submit resident requests through a narrowly
-- scoped RPC. Authorization is checked against the caller's database profile;
-- the client cannot choose the submitter, role, status, priority, or barangay.

create or replace function public.app_submit_resident_request(
  p_title text,
  p_description text,
  p_category_id uuid,
  p_location text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_account_status text;
  v_barangay_id uuid;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_location text := nullif(trim(coalesce(p_location, '')), '');
  v_reference text;
  v_tracking_code text;
  v_request public.lb_service_requests;
  v_attempt integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to submit a resident request';
  end if;

  select role, status, barangay_id
    into v_role, v_account_status, v_barangay_id
  from public.lb_profiles
  where id = v_uid;

  if not found or v_role <> 'resident' or v_account_status <> 'active' then
    raise exception 'Only residents with an active account can submit a request';
  end if;

  if v_title is null or length(v_title) < 4 or length(v_title) > 150 then
    raise exception 'Enter a request title between 4 and 150 characters';
  end if;
  if v_description is null or length(v_description) < 10 or length(v_description) > 4000 then
    raise exception 'Enter a description between 10 and 4000 characters';
  end if;
  if v_location is null or length(v_location) > 300 then
    raise exception 'Enter a location (up to 300 characters)';
  end if;
  if not exists (
    select 1 from public.lb_service_categories
    where id = p_category_id and is_active = true
  ) then
    raise exception 'Select an active service category';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_reference := 'LB-' || to_char(now(), 'YYYY') || '-'
      || lpad((floor(random() * 9000) + 1000)::text, 4, '0');
    v_tracking_code := upper(substring(md5(random()::text) from 1 for 6));

    begin
      insert into public.lb_service_requests (
        title, description, category_id, location, barangay_id,
        submitted_by, status, priority, is_anonymous, reference, tracking_code
      ) values (
        v_title, v_description, p_category_id, v_location, v_barangay_id,
        v_uid, 'submitted', 'normal', false, v_reference, v_tracking_code
      ) returning * into v_request;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;

  return jsonb_build_object('request', to_jsonb(v_request));
end;
$$;

revoke all on function public.app_submit_resident_request(text, text, uuid, text) from public, anon;
grant execute on function public.app_submit_resident_request(text, text, uuid, text) to authenticated;
