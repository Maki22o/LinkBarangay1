-- Add indexes for foreign-key columns flagged by Supabase's performance advisor.
-- The resident_id index covers both legacy and profile relationship constraints.

create index if not exists lb_appointments_created_by_idx on public.lb_appointments (created_by);
create index if not exists lb_appointments_request_id_idx on public.lb_appointments (request_id);
create index if not exists lb_appointments_resident_id_idx on public.lb_appointments (resident_id);
create index if not exists lb_assignments_assigned_by_idx on public.lb_assignments (assigned_by);
create index if not exists lb_assignments_department_id_idx on public.lb_assignments (department_id);
create index if not exists lb_attachments_owner_id_idx on public.lb_attachments (owner_id);
create index if not exists lb_audit_logs_actor_id_idx on public.lb_audit_logs (actor_id);
create index if not exists lb_notifications_request_id_idx on public.lb_notifications (request_id);
create index if not exists lb_request_updates_actor_id_idx on public.lb_request_updates (actor_id);
create index if not exists lb_service_categories_department_id_idx on public.lb_service_categories (department_id);
create index if not exists lb_service_requests_assigned_by_idx on public.lb_service_requests (assigned_by);
create index if not exists lb_service_requests_needs_info_by_idx on public.lb_service_requests (needs_info_by);
create index if not exists lb_settings_updated_by_idx on public.lb_settings (updated_by);
