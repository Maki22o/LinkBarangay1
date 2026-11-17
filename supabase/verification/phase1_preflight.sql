-- Phase 1, read-only staging verification. Run after migrations 0029-0034.
-- This script does not modify data.

-- Required schema objects and RLS must be present.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('lb_profiles','lb_service_requests','lb_request_updates',
                    'lb_assignments','lb_appointments','lb_attachments',
                    'lb_resident_verifications','lb_support_requests')
order by tablename;

select routine_name, specific_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('app_track_request','app_mfa_verified','app_is_active',
                       'app_is_active_staff','app_is_admin','app_dispatch_access')
order by routine_name, specific_name;

-- Security posture for private buckets and public tracking references.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('resident-verification-ids','request-attachments')
order by id;

select count(*) as legacy_short_references_not_publicly_trackable
from public.lb_service_requests
where reference ~ '^LB-[0-9]{4}-[0-9]{4}$';

select policyname, tablename, cmd, roles
from pg_policies
where schemaname in ('public','storage')
  and tablename in ('lb_profiles','lb_service_requests','lb_assignments',
                    'lb_appointments','lb_attachments','lb_resident_verifications','objects')
order by tablename, policyname;
