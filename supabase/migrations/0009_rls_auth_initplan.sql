-- Cache auth.uid() once per statement instead of re-evaluating it per row.
-- These policies keep the same access rules and change only evaluation cost.

alter policy lb_profiles_select on public.lb_profiles using (
  id = (select auth.uid())
  or public.app_is_admin()
  or (
    public.app_is_active_staff()
    and (
      (public.app_current_role() in ('secretary','officer','captain') and barangay_id = public.app_current_barangay())
      or (public.app_current_role() in ('dispatcher','field') and department_id = public.app_current_department())
    )
  )
);

alter policy lb_profiles_update on public.lb_profiles
  using (id = (select auth.uid()) or public.app_is_admin())
  with check (id = (select auth.uid()) or public.app_is_admin());

alter policy lb_requests_insert on public.lb_service_requests with check (
  public.app_is_active()
  and (
    (submitted_by = (select auth.uid()) and is_anonymous = false)
    or (
      public.app_current_role() = 'secretary'
      and public.app_current_status() = 'active'
      and submitted_by is null
      and barangay_id = public.app_current_barangay()
    )
    or public.app_is_admin()
  )
);

alter policy lb_assignments_select on public.lb_assignments using (
  assigned_to = (select auth.uid())
  or public.app_is_admin()
  or (
    public.app_current_role() = 'dispatcher'
    and public.app_current_status() = 'active'
    and department_id = public.app_current_department()
  )
  or (
    public.app_current_role() in ('officer','captain','secretary')
    and public.app_current_status() = 'active'
    and exists (
      select 1 from public.lb_service_requests r
      where r.id = request_id and r.barangay_id = public.app_current_barangay()
    )
  )
);

alter policy lb_appointments_select on public.lb_appointments using (
  resident_id = (select auth.uid())
  or public.app_is_admin()
  or (
    public.app_current_role() in ('secretary','captain')
    and public.app_current_status() = 'active'
    and barangay_id = public.app_current_barangay()
  )
);

alter policy lb_attachments_insert on public.lb_attachments with check (
  owner_id = (select auth.uid())
  and public.app_is_active()
  and exists (
    select 1 from public.lb_service_requests r
    where r.id = request_id and public.app_can_access_request(r.id)
  )
);

alter policy lb_attachments_owner_delete on public.lb_attachments
  using (owner_id = (select auth.uid()) or public.app_is_admin());

alter policy lb_notifications_select on public.lb_notifications
  using (user_id = (select auth.uid()));

alter policy lb_notifications_update on public.lb_notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
