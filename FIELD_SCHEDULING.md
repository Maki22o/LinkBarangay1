# Field scheduling setup and testing

The dispatcher and field features use the existing Supabase project and the same requests, assignments, appointments, activity records, audit logs, and notification inbox. The frontend uses the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. There are no new frontend credentials.

## Update an existing database

1. Confirm that the project uses the Git copy’s schema through `0023_allow_google_maps_link_locations.sql`. Review the migration history and take an appropriate database backup before an upgrade. Use a staging project to verify the upgrade when available.
2. Apply the following files in order. Each file is transactional. In a CLI-managed project with all earlier versions recorded, review the linked migration list and pending changes before using `supabase db push`. For a project managed in the SQL Editor, run the complete contents of each missing file and keep its migration history in sync with your deployment process.
   - `0024_field_scheduling_foundation.sql` extends the existing tables and adds field working hours and unavailable periods.
   - `0025_field_booking_workflow.sql` installs the resident preference, assignment, cancellation, priority, and estimate functions.
   - `0026_field_schedule_tracking.sql` installs job transitions, role-scoped schedule reads, notifications, and optional scheduled reminders.
   - `0027_dispatch_monitoring.sql` installs the dispatch queue, administrative monitoring, and working-day estimates.
   - `0028_field_booking_errors.sql` reports missing working hours, blocked time, and overlapping assignments separately when a booking fails.
3. Verify the existing `supabase_realtime` publication includes `lb_service_requests`, `lb_assignments`, `lb_appointments`, and `lb_notifications`. The new migrations add the appointment and assignment tables to an existing publication.
4. In **Configuration → Service Categories**, set a department and a **Field appointment duration in minutes** for each service that should accept resident appointment requests. Leaving the duration blank keeps resident appointment selection off for that category. Choose values suited to your services.
5. Ensure each dispatcher and field worker is active and in the appropriate department. Field personnel set their working hours from **My Availability** before dispatch can book them. Unscheduled assignments still work.

Existing front desk appointments remain in the front desk page. Older field assignments retain their original schedule and count toward conflicts when still current. An older assignment appears in the field appointment calendar after dispatch saves it as a managed appointment.

## Optional background alerts

Enable the Supabase Cron extension (`pg_cron`) to receive persisted overdue alerts without an open browser. After choosing an urgent unassigned threshold for your barangay, replace the example value in this SQL and run it through the SQL Editor with database-owner access. Leaving the setting unset still permits overdue-job alerts.

```sql
insert into public.lb_settings(key,value)
values ('dispatch_alerts','{"urgent_unassigned_minutes":60}'::jsonb)
on conflict (key) do update set value=excluded.value,updated_at=now();

select cron.schedule(
  'linkbarangay-field-alerts',
  '*/5 * * * *',
  'select public.app_send_dispatch_reminders();'
);
```

Run the named schedule once and confirm it appears in Cron. Repeated runs deduplicate alerts for the same estimate or urgent priority event.

## Verify with separate accounts

1. **Field personnel:** Save working hours on a future date. Add a block on that date. Verify that a block that conflicts with an already booked job is rejected until dispatch reschedules it.
2. **Resident:** Use an approved account. Submit a request with its required evidence and select a preferred time for a configured service. Check that the preference appears as pending. Submit another request for a service without field appointments and verify its normal submission.
3. **Barangay staff:** Move the submitted request to verification and verify it. Continue using the existing intake and inspection workflow.
4. **Dispatcher:** In **Department Queue**, filter by **Pending appointment**. Open the request, propose an alternate for the resident to review, or select field personnel and confirm the time after verification. Try the same worker and time on another request. Check the appointment calendar, field availability, cancellation and rescheduling, priority reasons, and manual or working-day estimates.
5. **Field personnel:** Open **Assigned Jobs**, accept the job, and select **Start work**. Add a progress note and submit completion. Confirm the resident request goes to inspection. Use the rescheduling or inability report on a separate job.
6. **Resident and barangay staff:** Check the resident’s timeline and estimate without opening staff instructions. Mark the inspected request resolved and confirm the resident receives the completion notification.
7. **Administrator:** Open **Reports & Analytics**, check the scheduling metrics and workloads, and use appointment history to navigate to a request. Review changes in **Audit Logs**.

`npm test` runs the frontend tests. `npm run test:dispatch:db` requires Docker and runs the full migration sequence plus role, privacy, cancellation, notification, and concurrent booking checks against an isolated PostgreSQL container. `npx tsc --noEmit` and `npm run build` check the frontend build. This project has no lint script.

## Scheduling rules

- Appointments use Philippine time (`Asia/Manila`). Resident suggestions cover the next 90 days in 30-minute increments. A preference becomes a reservation when a dispatcher confirms it.
- A booking must fit entirely inside one working window. Dispatchers with saved availability also book within their own saved hours. Two appointments can touch at the end and start without overlapping. Working-day estimates count the assigned worker’s working days and omit blocked time. They are planning estimates, not additional reservations.
- Changing field hours or adding a block cannot displace an existing booking. Reschedule or cancel it first. Cancellation and field inability reports release its capacity.

For a rejected appointment, open [the read-only booking check](supabase/verification/field_booking_check.sql) in the Supabase SQL Editor. Enter the dispatcher and field worker login emails and the appointment time and duration. Enter the request reference if it already has an assignment. The `booking_check` result explains what the saved schedules allow.

## Files changed

| Area | Created | Updated |
| --- | --- | --- |
| Database | `supabase/migrations/0024_field_scheduling_foundation.sql`, `0025_field_booking_workflow.sql`, `0026_field_schedule_tracking.sql`, `0027_dispatch_monitoring.sql` | |
| Screens | `src/features/dispatcher/FieldBookingCalendar.tsx`, `src/features/field/FieldAvailabilityPage.tsx`, `src/features/shared/RequestScheduling.tsx` | `src/App.tsx`, `src/features/admin/AdminConfigPages.tsx`, `src/features/dispatcher/DispatcherPages.tsx`, `src/features/field/FieldPages.tsx`, `src/features/resident/SubmitRequestPage.tsx`, `src/features/shared/RequestDetailPage.tsx`, `src/features/shared/RequestsPage.tsx` |
| Data and UI | `src/services/schedulingService.ts` | `src/services/appointmentService.ts`, `src/services/assignmentService.ts`, `src/services/requestService.ts`, `src/hooks/useRequestRealtime.ts`, `src/lib/assignmentState.ts`, `src/lib/dateTime.ts`, `src/types/index.ts`, `src/permissions/permissions.ts`, `src/components/common/ui.tsx`, `src/index.css` |
| Tests and setup | `supabase/tests/field_scheduling.sql`, `scripts/test-field-scheduling-db.sh`, `FIELD_SCHEDULING.md` | `tests/dateTime.test.mjs`, `package.json`, `SETUP_GUIDE.md` |
