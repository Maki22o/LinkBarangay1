-- Restore public tracking without the obsolete secure tracking code.
-- It intentionally returns only a request's reference, status, timestamps,
-- and generic status-history events (never address, description, submitter,
-- staff member, or internal remarks).

create or replace function public.app_track_request(p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_request public.lb_service_requests;
  v_updates jsonb;
begin
  perform public.app_enforce_public_rate('request-tracking', 12, interval '15 minutes');

  select * into v_request
  from public.lb_service_requests
  where upper(reference) = upper(trim(coalesce(p_reference, '')));

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'type', type,
    'previous_status', previous_status,
    'new_status', new_status,
    'at', created_at
  ) order by created_at), '[]'::jsonb)
  into v_updates
  from public.lb_request_updates
  where request_id = v_request.id;

  return jsonb_build_object(
    'found', true,
    'request', jsonb_build_object(
      'reference', v_request.reference,
      'status', v_request.status,
      'created_at', v_request.created_at,
      'updated_at', v_request.updated_at
    ),
    'updates', v_updates
  );
end;
$$;

revoke all on function public.app_track_request(text, text) from public, anon, authenticated;
revoke all on function public.app_track_request(text) from public;
grant execute on function public.app_track_request(text) to anon, authenticated;

notify pgrst, 'reload schema';
