-- LinkBarangay no longer accepts anonymous/public reports or public tracking.
-- Historical records remain unchanged for audit purposes; this blocks future use.

revoke all on function public.app_submit_anonymous_report(text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.app_track_request(text,text) from public, anon, authenticated;

alter table public.lb_service_requests drop constraint if exists lb_requests_no_new_anonymous;
alter table public.lb_service_requests add constraint lb_requests_no_new_anonymous
  check (is_anonymous = false) not valid;

-- Existing public-abuse trigger is no longer necessary for new records, but it
-- is retained so historical migration order and audit state are untouched.
notify pgrst, 'reload schema';
