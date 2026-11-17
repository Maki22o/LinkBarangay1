# LinkBarangay — Deployment Runbook

This runbook describes the current Supabase setup for the LinkBarangay app.
The connected project has been inspected. Migrations 0007 through 0012 have been
applied, and the `create-staff-user` Edge Function is deployed with JWT
verification enabled. Historical migrations 0005 and 0006 were applied in the
Supabase SQL Editor and therefore may not appear in migration history.

## Step 0 — Check `.env.local`

`.env.local` must contain, for the **same** project:

```
VITE_SUPABASE_URL=https://dfhdlutxfggg….supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<the sb_publishable_… key from this project's API settings>
```

Never put a service-role or secret key in this file.

## Step 1 — Inspect your current schema (2 minutes, optional but recommended)

SQL Editor → run:

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name like 'lb_%'
order by table_name, ordinal_position;

select tablename, policyname, cmd, roles
from pg_policies where schemaname = 'public' order by tablename, policyname;
```

If `lb_profiles` / `lb_service_requests` / `lb_request_updates` /
`lb_notifications` have **extra NOT NULL columns without defaults** that you
care about, tell me and I'll adjust the migrations before you run them.

## Step 2 — Migration order for a new or reset project

SQL Editor → paste each file's full contents → Run:

1. `supabase/migrations/0001_profiles_roles.sql`
2. `supabase/migrations/0002_reference_tables.sql`
3. `supabase/migrations/0003_requests_workflow.sql`
4. `supabase/migrations/0004_rls_policies_workflow.sql`
5. `supabase/migrations/0005_profile_relationships.sql`
6. `supabase/migrations/0006_resident_request_submission.sql`
7. `supabase/migrations/0007_three_account_roles.sql`
8. `supabase/migrations/0008_foreign_key_indexes.sql`
9. `supabase/migrations/0009_rls_auth_initplan.sql`
10. `supabase/migrations/0010_worker_scope_constraints.sql`
11. `supabase/migrations/0011_admin_module_integrity.sql`
12. `supabase/migrations/0012_admin_index_cleanup.sql`

What they do (nothing is deleted, no data destroyed):

- **0001** — sets the three account roles (`resident`, `worker`, `admin`),
  stores the worker's operational function in `worker_function`, adds `status` +
  barangay/department scope columns, auto-creates a **resident** profile on
  every signup, and blocks any user from changing their own role/status/scope.
- **0002** — barangays, departments, service categories (with routing +
  SLA), settings; seeds the records shown in the UI.
- **0003** — aligns `lb_service_requests` (reference numbers, tracking codes,
  workflow columns; backfills existing rows), aligns `lb_request_updates`,
  creates `lb_assignments`, `lb_appointments`, `lb_attachments`,
  `lb_audit_logs`, and the private `request-attachments` storage bucket.
- **0004** — deny-by-default RLS on every `lb_*` table (all legacy policies on
  those tables are replaced), the controlled status-transition RPC
  (`app_transition_request`), anonymous reporting + public tracking RPCs,
  assignment RPCs, notification fan-out, realtime.
- **0005** — explicit profile foreign keys for request, assignment, and
  appointment relationship queries.
- **0006** — validated resident submission RPC that sets protected request
  fields on the server.
- **0007** — converts legacy staff-role values to `worker` plus
  `worker_function`, updates workflow RPCs, and restricts helper-function
  execution privileges.
- **0008** — adds indexes for foreign-key columns reported by Supabase.
- **0009** — caches `auth.uid()` in selected RLS policies without changing access.
- **0010** — requires the corresponding barangay/department scope for each worker function.
- **0011** — adds explicit profile-to-barangay/department relationships, allows
  the admin user directory to refresh through Realtime, and blocks client-side
  promotion of resident/worker accounts to Admin.
- **0012** — removes two duplicate profile scope indexes already created by 0008.

## Step 3 — Bootstrap the first administrator

Sign up once through the app's normal registration (this creates a *resident*
profile), then run in the SQL Editor with your own email:

```sql
update public.lb_profiles
set role = 'admin',
    barangay_id = (select id from public.lb_barangays where name = 'San Roque')
where email = 'you@example.com';
```

This context (SQL Editor) is trusted; the frontend can never do this.

## Step 4 — Resident/Worker invitation Edge Function

The function is deployed as `create-staff-user` with JWT verification enabled.
It checks that the caller has an active admin profile and provisions only
`resident` or `worker` accounts. Worker accounts also require an allowed
`worker_function` and its matching barangay or department scope. Admin accounts
must be provisioned through trusted setup. Check Supabase Edge Function logs if
account creation fails; never put a service-role key in `.env.local`.

For local development, `APP_ORIGIN` defaults to `http://127.0.0.1:8443`.
Set the Edge Function secret `APP_ORIGIN` to the exact deployed app origin when
the app is hosted elsewhere.

Alternative without deploying anything: have the person register normally
(they land as a resident), then change the account to Resident or Worker in User
Management — admin-only, DB-enforced, audited. Admin cannot be selected there.

## Step 5 — Supabase Auth settings to review (Dashboard → Authentication)

- **Email confirmation**: keep "Confirm email" OFF. New resident and staff
  applicants need an immediate session so the required private ID/address
  document is submitted in the same registration flow.
- **Site URL / redirect URLs**: add your dev origin (`http://127.0.0.1:8443`).
  Set **Site URL** to `http://127.0.0.1:8443` for this local preview and add
  that exact origin under **Redirect URLs**. Use the real HTTPS app origin in
  production. Invitation, registration-confirmation, and password-reset links
  now return to the app so it can finish account setup.

## Production security checklist (required before launch)

- **Email confirmation**: keep this OFF. Identity/address review and staff
  activation are performed by administrators in the application.
- **Password policy**: set the Supabase Auth minimum password length to **8**.
  This matches the UI and prevents direct Auth API signups using shorter passwords.
- **Leaked-password protection**: enable it in Supabase Auth if available on
  your plan.
- **CAPTCHA**: configure Turnstile or hCaptcha in Supabase Auth before enabling
  it. Do not add a CAPTCHA site or secret key to this repository.
- **Resident documents**: keep the storage bucket private, review access and
  audit logs regularly, and establish a written retention/deletion schedule.
  Virus/malware scanning requires a separate trusted scanning provider; do not
  preview untrusted office documents or executables.

## Phase 1 launch-blocker deployment (staging first)

Do **not** run this section first on production. Create a Supabase staging
project with the same Auth settings, schema, Storage buckets, and Edge
Functions, then apply the approved migrations in numeric order. The current
Phase 1 sequence is:

1. `0029_support_requests_and_identity_guards.sql`
2. `0030_public_abuse_protection.sql`
3. `0031_disable_anonymous_reporting.sql`
4. `0032_dispatcher_barangay_scope.sql`
5. `0033_reference_only_public_tracking.sql`
6. `0034_privileged_mfa_and_secure_public_tracking.sql`
7. `0035_staff_application_identity_verification.sql`
8. `0036_remove_mfa_enforcement.sql`

`0036` removes the MFA gate and database MFA requirement while retaining
role-based access controls, administrator approval, and identity/address
verification for public staff applicants.

New public tracking references become `LB-` plus 32 uppercase hexadecimal
characters. They are safe to enter in the public Track a Request screen and
return only generic status history. Legacy short references are **not**
publicly trackable after this migration; the resident must sign in to view
those existing requests.

In Dashboard → Authentication, before staging verification and production:

- turn on **Confirm email** and add the exact staging/production HTTPS URLs;
- configure and enforce **CAPTCHA** for sign-up, sign-in, and password reset;
- require a **12-character** password minimum and enable leaked-password
  protection when available on the project plan;
- verify that TOTP MFA is enabled; then run the manual role tests in
  `supabase/verification/phase1_staging_checklist.md`.

## Step 6 — Test accounts

Fastest way: create real signups via the app (residents), then elevate staff
via User Management (Step 4 alternative) while logged in as the bootstrap
admin. Every elevation is written to `lb_audit_logs`.

---

## Session revocation note

Suspending an account (User Management → Suspend) blocks all further API
access within seconds (every RLS policy and RPC validates live status).
However, Supabase does not let a client invalidate another user's existing JWT
— for immediate session termination, use Dashboard → Authentication → Users →
remove session, or the CLI. This is a platform limitation, not a policy gap.

## Google Drive off-site backup

The project contains the `backup-to-google-drive` Edge Function and migration
`0037_google_drive_backup_audit.sql`. It exports the LinkBarangay application
tables and copies files from the private `request-attachments` and
`resident-verification-ids` buckets into a dated folder in Google Drive. It is
an application-data backup, not a replacement for Supabase's managed database
backup/PITR service.

Before deployment:

1. In Google Cloud Console, create a service account, enable **Google Drive API**,
   create a JSON key, then share the [LinkBarangay Backups](https://drive.google.com/drive/folders/1STpSw83XV3Ns0AvtFE7BoBaNVIp7L5SN)
   folder with that service-account email as **Editor**.
2. Store the entire JSON key in the Edge Function secret
   `GOOGLE_SERVICE_ACCOUNT_JSON` (never commit or paste it in the frontend),
   and set `GOOGLE_DRIVE_BACKUP_FOLDER_ID=1STpSw83XV3Ns0AvtFE7BoBaNVIp7L5SN`.
3. Set a long random `BACKUP_CRON_TOKEN`; an external scheduler or Supabase Cron
   must send it in the `x-backup-schedule-token` header. Manual POST calls are
   limited to active administrators.
4. Apply migration 0037, deploy the function, run one manual backup, then only
   enable the daily schedule after checking its `manifest.json` and
   `lb_backup_runs` entry.

Do not remove files from the source storage buckets because they exist in a
backup. Retention and restore testing must be owned by an administrator.

## Diagnostic: verify RLS is active

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename like 'lb_%';
-- every row must show rowsecurity = true
```
