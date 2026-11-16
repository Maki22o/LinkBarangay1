-- Run this read-only check in the linked project's Supabase SQL Editor.
-- Replace the two example emails. Enter the appointment in Philippine time.
-- If the request already has an assignment, enter its reference to exclude it from overlap checks.
with booking_input as (
  select
    'dispatcher@example.com'::text as dispatcher_email,
    'field.worker@example.com'::text as worker_email,
    timestamp '2026-11-19 10:22:00' at time zone 'Asia/Manila' as start_at,
    150 as duration_minutes,
    null::text as request_reference
), booking as (
  select input.*, input.start_at + make_interval(mins => input.duration_minutes) as end_at,
    extract(dow from input.start_at at time zone 'Asia/Manila')::smallint as weekday
  from booking_input input
)
select
  booking.start_at at time zone 'Asia/Manila' as appointment_start_ph,
  booking.end_at at time zone 'Asia/Manila' as appointment_end_ph,
  worker_hours.start_time as worker_start,
  worker_hours.end_time as worker_end,
  case when dispatcher_hours.is_available then dispatcher_hours.start_time end as dispatcher_start,
  case when dispatcher_hours.is_available then dispatcher_hours.end_time end as dispatcher_end,
  case
    when dispatcher.id is null then 'No profile matches the dispatcher email.'
    when worker.id is null then 'No profile matches the field worker email.'
    when dispatcher.status is distinct from 'active'
      or (dispatcher.role is distinct from 'admin' and dispatcher.worker_function is distinct from 'dispatcher')
      then 'The dispatcher profile is not active or does not have the dispatcher role.'
    when worker.status is distinct from 'active' or worker.role is distinct from 'worker'
      or worker.worker_function is distinct from 'field'
      then 'The selected profile is not an active field worker.'
    when worker.department_id is null
      or (dispatcher.role <> 'admin' and dispatcher.department_id is distinct from worker.department_id)
      then 'The field worker and dispatcher must be assigned to the same department.'
    when booking.request_reference is not null and request.id is null then 'No request matches the reference.'
    when request.id is not null and (
      (request.department_id is not null and request.department_id <> worker.department_id)
      or (dispatcher.role <> 'admin' and request.department_id is distinct from dispatcher.department_id)
    ) then 'The request is outside the dispatcher or worker department.'
    when booking.start_at <= now() then 'The appointment start is in the past.'
    when not public.app_dispatcher_in_booking_hours(dispatcher.id, booking.start_at, booking.end_at)
      then 'The appointment falls outside the dispatcher''s saved availability.'
    when worker_hours.personnel_id is null then 'The field worker has no saved working hours for this weekday.'
    when not public.app_field_on_duty(worker.id, booking.start_at, booking.end_at)
      then 'The full appointment does not fit within the worker''s saved working hours.'
    when blocked.starts_at is not null then 'The appointment overlaps a period the field worker blocked.'
    when public.app_field_has_booking(worker.id, booking.start_at, booking.end_at, request.id)
      then 'The appointment overlaps another booking for this worker.'
    else 'Available. The saved schedules and overlap checks allow this appointment.'
  end as booking_check,
  blocked.starts_at at time zone 'Asia/Manila' as blocked_from_ph,
  blocked.ends_at at time zone 'Asia/Manila' as blocked_until_ph
from booking
left join public.lb_profiles dispatcher on lower(dispatcher.email) = lower(booking.dispatcher_email)
left join public.lb_profiles worker on lower(worker.email) = lower(booking.worker_email)
left join public.lb_service_requests request on request.reference = booking.request_reference
left join public.lb_field_working_hours worker_hours
  on worker_hours.personnel_id = worker.id and worker_hours.day_of_week = booking.weekday
left join public.lb_dispatcher_availability dispatcher_hours
  on dispatcher_hours.dispatcher_id = dispatcher.id and dispatcher_hours.day_of_week = booking.weekday
left join lateral (
  select period.starts_at, period.ends_at
  from public.lb_field_unavailability period
  where period.personnel_id = worker.id
    and period.starts_at < booking.end_at and period.ends_at > booking.start_at
  order by period.starts_at
  limit 1
) blocked on true;
