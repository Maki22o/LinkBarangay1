begin;

create view public.lb_dispatch_queue with (security_invoker=true) as
select r.id,r.reference,r.title,r.status,r.priority,r.dispatch_priority_order,r.description,r.location,
  r.created_at,r.department_id,r.category_id,c.name as category_name,
  case when r.is_anonymous then 'Anonymous' else coalesce(nullif(resident.full_name,''),r.submitter_name) end as resident_name,
  worker.full_name as personnel_name,b.preferred_at,b.status as appointment_status,
  case when b.status='pending' then null else coalesce(b.scheduled_at,legacy.schedule_at) end as scheduled_at,
  case when r.estimate_recorded_at is not null then r.estimated_completion_at else legacy.deadline_at end as estimated_completion_at
from public.lb_service_requests r
left join public.lb_service_categories c on c.id=r.category_id
left join public.lb_profiles resident on resident.id=r.submitted_by
left join public.lb_profiles worker on worker.id=r.assigned_to
left join public.lb_appointments b on b.request_id=r.id and b.is_field_booking
left join lateral (
  select a.schedule_at,a.deadline_at from public.lb_assignments a
    where a.request_id=r.id and a.assigned_to=r.assigned_to order by a.created_at desc,a.id desc limit 1
) legacy on true
where public.app_dispatch_access(r.department_id)
  and (r.status in ('verified','assigned','in_progress','for_inspection') or b.status='pending');
revoke all on public.lb_dispatch_queue from public,anon,authenticated;
grant select on public.lb_dispatch_queue to authenticated;

create function public.app_dispatch_overview()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not coalesce(public.app_is_admin(),false) then raise exception 'Administrator access is required'; end if;
  select jsonb_build_object(
    'scheduled', (select count(*) from public.lb_appointments where is_field_booking and status in ('confirmed','rescheduled','in_progress')),
    'pending', (select count(*) from public.lb_appointments where is_field_booking and status='pending'),
    'active', count(*) filter (where status in ('verified','assigned','in_progress') and assigned_to is not null),
    'completed', (select count(*) from public.lb_assignments where status in ('completed','verified')),
    'overdue', count(*) filter (where status in ('verified','assigned','in_progress') and estimated_completion_at<now()),
    'unassigned', count(*) filter (where status in ('verified','assigned') and assigned_to is null),
    'priority', count(*) filter (where status not in ('closed','resolved','rejected') and priority in ('high','urgent')),
    'workloads', (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,
      'department',d.name,'active',coalesce(current_work.total,0)) order by coalesce(current_work.total,0) desc,p.full_name),'[]'::jsonb)
      from public.lb_profiles p left join public.lb_departments d on d.id=p.department_id
      left join (select assigned_to,count(*) total from public.lb_service_requests
        where status in ('verified','assigned','in_progress') group by assigned_to) current_work on current_work.assigned_to=p.id
      where p.status='active' and p.role='worker' and p.worker_function='field')
  ) into result from public.lb_service_requests;
  return result;
end $$;
revoke all on function public.app_dispatch_overview() from public,anon;
grant execute on function public.app_dispatch_overview() to authenticated;

-- Project a business-day estimate using the assigned person's actual remaining
-- hours. Full-day blocks and days without working hours contribute nothing.
create function public.app_set_working_day_estimate(p_request_id uuid,p_days integer,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.lb_service_requests; a public.lb_assignments; start_at timestamptz;
  day_start timestamptz; day_end timestamptz; work_period tstzmultirange; working_date date;
  segment tstzrange; days_count integer:=0; minutes_total integer:=0; result_at timestamptz;
begin
  if p_days is null or p_days not between 1 and 30 then raise exception 'Choose 1 to 30 working days'; end if;
  select * into r from public.lb_service_requests where id=p_request_id for update;
  if not found or not public.app_dispatch_access(r.department_id) then raise exception 'You cannot edit this estimate'; end if;
  select * into a from public.lb_assignments where request_id=r.id and assigned_to=r.assigned_to
    order by created_at desc,id desc limit 1;
  if a.id is null or a.status not in ('pending','accepted','in_progress') then
    raise exception 'Assign personnel before estimating by working days';
  end if;
  perform public.app_lock_field_schedule(a.assigned_to);
  start_at:=greatest(now(),a.schedule_at);
  for working_date in select (start_at at time zone 'Asia/Manila')::date+n from generate_series(0,180) n loop
    select (working_date+h.start_time) at time zone 'Asia/Manila',(working_date+h.end_time) at time zone 'Asia/Manila'
      into day_start,day_end from public.lb_field_working_hours h
      where h.personnel_id=a.assigned_to and h.day_of_week=extract(dow from working_date);
    if not found or day_end<=start_at then continue; end if;
    work_period:=tstzmultirange(tstzrange(greatest(start_at,day_start),day_end,'[)')) -
      coalesce((select range_agg(tstzrange(b.starts_at,b.ends_at,'[)'))
         from public.lb_field_unavailability b where b.personnel_id=a.assigned_to
           and b.starts_at<day_end and b.ends_at>day_start),'{}'::tstzmultirange);
    if isempty(work_period) then continue; end if;
    days_count:=days_count+1;
    for segment in select unnest(work_period) loop
      minutes_total:=minutes_total+floor(extract(epoch from upper(segment)-lower(segment))/60)::integer;
      result_at:=upper(segment);
    end loop;
    exit when days_count=p_days;
  end loop;
  if days_count<>p_days then raise exception 'There are not enough working days in this worker''s calendar'; end if;
  perform public.app_set_completion_estimate(r.id,result_at,greatest(1,minutes_total),p_reason);
end $$;
revoke all on function public.app_set_working_day_estimate(uuid,integer,text) from public,anon;
grant execute on function public.app_set_working_day_estimate(uuid,integer,text) to authenticated;

notify pgrst,'reload schema';
commit;
