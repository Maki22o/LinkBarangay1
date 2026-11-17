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

- **Email confirmation**: if "Confirm email" is ON, new residents will see a
  "check your email" screen after registering. Turn it OFF if you want
  instant sign-in for testing.
- **Site URL / redirect URLs**: add your dev origin (`http://127.0.0.1:8443`).
  Set **Site URL** to `http://127.0.0.1:8443` for this local preview and add
  that exact origin under **Redirect URLs**. Use the real HTTPS app origin in
  production. Invitation, registration-confirmation, and password-reset links
  now return to the app so it can finish account setup.

## Production security checklist (required before launch)

- **Email confirmation**: turn this ON for the deployed site. The app supports
  the confirmation flow, but this setting is controlled in the Supabase
  dashboard.
- **Password policy**: set the Supabase Auth minimum password length to **12**.
  The UI also requires uppercase, lowercase, and a number, but the dashboard
  minimum prevents direct Auth API signups using shorter passwords.
- **Leaked-password protection**: enable it in Supabase Auth if available on
  your plan.
- **CAPTCHA**: configure Turnstile or hCaptcha in Supabase Auth before enabling
  it. Do not add a CAPTCHA site or secret key to this repository.
- **MFA**: staff and administrators can enroll a TOTP authenticator from **My
  Profile → Two-factor authentication**. Make it a required operating policy
  for all privileged accounts before granting them access to resident IDs.
- **Resident documents**: keep the storage bucket private, review access and
  audit logs regularly, and establish a written retention/deletion schedule.
  Virus/malware scanning requires a separate trusted scanning provider; do not
  preview untrusted office documents or executables.

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

## Diagnostic: verify RLS is active

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename like 'lb_%';
-- every row must show rowsecurity = true
```
