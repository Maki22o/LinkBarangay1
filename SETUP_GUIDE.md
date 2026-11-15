# LinkBarangay full setup guide

Use the updated `LinkBarangay1-notifications.zip`. Extract it and open a terminal in `LinkBarangay1-main`, beside `package.json`. This guide supersedes deployment-state claims in the older setup documents: no hosted Supabase project was connected or deployed during this work.

## 1. Requirements and frontend installation

- Node.js 24 LTS and npm. The archived `.mise.toml` specifies Node 22; use Node 24 to match the verified build and native TypeScript tests.
- A Supabase project and dashboard access.
- Supabase CLI through `npx supabase` for the account-provisioning function.
- Docker only for isolated database/Realtime tests. Python Playwright and Chromium only for browser tests.

```bash
node --version
npm --version
npm ci
```

Keep `package-lock.json`. Use npm consistently rather than alternating npm and pnpm lockfiles.

## 2. Connect the frontend

Copy `.env.example` to `.env.local`. On macOS/Linux:

```bash
cp .env.example .env.local
```

PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Set these values from the same project's Supabase API settings:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PROJECT_PUBLISHABLE_KEY
```

Use the publishable key (`sb_publishable_...`), or the project's legacy anon key where applicable. Never use a service-role/secret key or database password in a `VITE_` variable. Vite includes these variables in browser assets. Restart Vite after editing the file.

## 3. Initialize or upgrade the database

Choose one path. Use SQL Editor to run each complete file individually and resolve errors before continuing. Do not reset an existing project or blindly run `supabase db push` over an unreconciled migration history.

### Existing project

If migrations 0001–0014 are already applied, do not rerun them. Run:

1. `supabase/verification/0015_preflight.sql` — read-only compatibility checks.
2. `supabase/migrations/0015_unified_notifications.sql` — apply once, as a complete transaction.

If the project is missing earlier migrations, first reconcile its actual schema and migration history. In particular, do not rerun the historical role conversion on existing canonical worker accounts. If preflight or 0015 reports an unknown function definition, inspect that deployed RPC; do not bypass its guard.

### Brand-new empty project

Do this before registering any application accounts. Run in this exact order:

1. `supabase/migrations/0001_profiles_roles.sql`
2. `supabase/migrations/0002_reference_tables.sql`
3. `supabase/migrations/0003_requests_workflow.sql`
4. `supabase/migrations/0004_rls_policies_workflow.sql`
5. `supabase/migrations/0005_profile_relationships.sql`
6. `supabase/migrations/0006_resident_request_submission.sql`
7. **`supabase/bootstrap/0007_fresh_baseline.sql`**, instead of archived migration 0007.
8. `supabase/migrations/0008_foreign_key_indexes.sql`
9. `supabase/migrations/0009_rls_auth_initplan.sql`
10. `supabase/migrations/0010_worker_scope_constraints.sql`
11. `supabase/migrations/0011_admin_module_integrity.sql`
12. `supabase/migrations/0012_admin_index_cleanup.sql`
13. `supabase/migrations/0013_worker_signup_approval.sql`
14. `supabase/migrations/0014_signup_barangay.sql`
15. `supabase/verification/0015_preflight.sql`
16. `supabase/migrations/0015_unified_notifications.sql`

The archive's 0004 already contains worker-aware RPCs, while its 0007 insists on converting legacy RPC strings. The fresh-only initializer validates the canonical definitions and applies 0007's remaining constraints, guards and grants without that incompatible conversion. It refuses populated application databases. The historical migration files remain unchanged. Record that this initializer fulfilled the 0007 baseline if you later reconcile CLI migration history.

The fresh initializer path passed the complete 112-assertion isolated PostgreSQL suite. Never apply files from `supabase/tests/` to a hosted application database; those are disposable test fixtures.

## 4. Configure authentication

In Supabase Authentication settings:

1. Enable email/password authentication and signups if residents will self-register.
2. For local development, set Site URL to `http://127.0.0.1:8443` and add it to allowed redirect URLs. Add `http://localhost:8443` separately if using that hostname.
3. Decide whether email confirmation is required. With confirmation enabled, users must follow the email before signing in.
4. Configure SMTP for reliable confirmation, staff invitation and password-reset email delivery. Check provider limits if emails fail.

For production, use your exact HTTPS origin as Site URL and allow that origin for redirects. The application returns signup, invitation and password-recovery flows to its origin.

## 5. Start the application

```bash
npm run dev
```

Open `http://127.0.0.1:8443`. The default is HTTP despite the port number. This Vite configuration uses a strict port; stop another process using 8443 or set `PORT` before starting.

Example alternative on macOS/Linux:

```bash
PORT=5173 npm run dev
```

PowerShell:

```powershell
$env:PORT="5173"
npm run dev
```

If changing the origin, also update Auth redirect URLs and the Edge Function origin settings below.

## 6. Create the first administrator

Register your own account through the Resident signup option. Confirm the email if required. Then run in Supabase SQL Editor, replacing the email:

```sql
update public.lb_profiles
set role = 'admin', worker_function = null, status = 'active'
where email = 'your-admin@example.com'
returning id, email, role, status;
```

Confirm the returned row is your account, then sign out and sign in again. Admin promotion is deliberately available only through trusted setup, not browser User Management. The existing admin role has system-wide authority.

## 7. Deploy account provisioning

From the project root, initialize CLI configuration only if `supabase/config.toml` is absent:

```bash
npx supabase login
npx supabase init
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set APP_ORIGIN=http://127.0.0.1:8443 ALLOWED_ORIGIN=http://127.0.0.1:8443 --project-ref YOUR_PROJECT_REF
npx supabase functions deploy create-staff-user --project-ref YOUR_PROJECT_REF
```

Skip `init` or `link` if already configured correctly. Keep JWT verification enabled. The function also validates the caller with Supabase Auth and requires an active admin profile. Supabase supplies its built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the hosted function; those server credentials do not belong in frontend env files.

For production, change `APP_ORIGIN` and `ALLOWED_ORIGIN` to your exact HTTPS origin. The function currently supports a single configured CORS origin; localhost and 127.0.0.1 are different origins. Invitations use APP_ORIGIN for their return URL.

Without this function, users can still self-register and an admin can assign their worker role/function/scope through User Management. Admin-initiated invitations/account creation require the function.

## 8. Configure organizational data and accounts

Migration 0002 seeds example barangays, departments, categories, routing and SLA values. Review them through the admin configuration pages before real use; assign each service category to the appropriate department and review required documents and SLA hours.

| Account role | Worker function | Required scope |
|---|---|---|
| resident | none | Barangay chosen during registration |
| admin | none | System-wide access |
| worker | secretary | Barangay |
| worker | officer | Barangay |
| worker | captain | Barangay |
| worker | dispatcher | Department |
| worker | field | Department |

Worker self-signup creates a pending resident profile, not an active worker. An admin must set role=worker, the intended function, matching scope and status=active. Pending, suspended or inactive accounts cannot use the authenticated application. Ensure dispatcher and field personnel share the department handling their requests.

## 9. Verify storage and Realtime

Storage should contain the private `request-attachments` bucket, created by migration 0003. Keep it private. The configured limit is 10 MiB per file, with supported images and PDF documents; work photos require images. The application obtains signed URLs for authorized viewing.

In the Dashboard's Realtime/replication configuration, confirm these tables are published:

- `lb_notifications` — INSERT and UPDATE are required.
- `lb_service_requests`.
- `lb_profiles` — account role/status refreshes.

Check in SQL Editor:

```sql
select pubname, pubinsert, pubupdate
from pg_publication where pubname='supabase_realtime';

select schemaname, tablename
from pg_publication_tables
where pubname='supabase_realtime'
order by tablename;
```

If the publication exists but a required table is absent, enable it through Dashboard replication settings. Keep RLS enabled. Migration 0015 adds notifications to an existing publication but does not create a missing publication or change its global publish settings.

## 10. Verify the workflow

Use separate browser profiles for different users and a second tab for the same notification recipient:

1. Register a resident; create active secretary, officer/captain, dispatcher and field accounts with matching scopes.
2. Submit a resident request. Check its acknowledgment and the correct intake workers' notification histories.
3. Secretary sends it for verification; officer verifies it and routes it to a department.
4. Dispatcher assigns field personnel. Check the field worker's notification and job destination.
5. Field worker accepts, adds progress, and completes the job. Officer/captain inspects and resolves it; the resident can confirm closure.
6. Verify resident updates, cross-tab read synchronization, unread counts, refresh persistence, appointment notifications and account-change notices.
7. Reassign/reopen/reroute a request. Old assignments must remain historical without active action buttons or workload counts.
8. Confirm unrelated residents, barangays and departments receive no event. Opening the inbox alone must not mark it read.

## 11. Run checks

```bash
npm run build
npx tsc --noEmit
npm test
npm run test:db
```

Build/type checking passed; native tests passed 29/29; SQL tests passed 112 assertions. To test the new empty-project initializer path specifically, on macOS/Linux:

```bash
LB_TEST_CANONICAL_BOOTSTRAP=1 npm run test:db
```

The SQL suites use disposable Docker containers, not your configured hosted project. Run Docker suites sequentially. Optional `npm run test:realtime` starts a local real Realtime server and needs image downloads, package installation in its container and sufficient Docker space. Its clean wrapper is disk-limited here; six real WebSocket checks passed on separately prepared isolated services. Hosted verification remains necessary.

Browser tests require Python Playwright/Chromium and the fixture Vite origin described in `NOTIFICATIONS.md`. Do not point intercepted-HTTP browser tests at your production app.

## 12. Deploy the frontend

Use a static host supporting Vite builds, with:

- Root directory: the folder containing package.json.
- Node version: 24.
- Install command: `npm ci`.
- Build command: `npm run build`.
- Output directory: `dist`.
- Build environment: the same two VITE_SUPABASE variables from step 2.

Apply database migrations before releasing the frontend. Serve index.html at the app root and configure an SPA fallback if your host requires it. The app uses internal view state rather than URL path routes. Leave FIGMA_PUBLIC_URL unset for a normal root deployment. Supabase handles backend APIs; no separate Express server is required.

After deploying, set the production Auth Site URL/redirects and Edge Function APP_ORIGIN/ALLOWED_ORIGIN. Rebuild when VITE variables change; changing host runtime variables alone does not update existing static assets. `npm run preview` previews a local production build and is not the production hosting service.

## Troubleshooting

| Symptom | Check |
|---|---|
| Missing Supabase configuration | .env.local is beside package.json; both VITE names are exact; restart Vite. |
| Old 0007 refuses a known role query | On an empty project use the fresh initializer at step 3; on an existing project reconcile history instead of rerunning conversions. |
| 0015 preflight/function drift error | Inspect deployed RPC definitions and prerequisite migrations; do not remove compatibility guards. |
| Login reports pending/inactive | Admin must approve the account and set its correct role, function, scope and active status. |
| Confirmation/invite/reset link returns incorrectly | Check Auth redirects, Site URL, APP_ORIGIN and whether localhost versus 127.0.0.1 differs. |
| Account service 404 | Deploy create-staff-user to the same project used by the frontend. |
| Account service 401/403 | Check the session, active admin profile, gateway JWT compatibility and function logs. Do not bypass the function's caller/admin validation. |
| CORS failure | ALLOWED_ORIGIN must match the browser origin exactly. |
| Notifications appear only after refresh | Check publication membership, INSERT/UPDATE settings and WebSocket access. Fallback reconciliation runs while visible/online. |
| Mark-read says migration required | Apply 0015 to the same project; reload PostgREST schema cache if needed. |
| Attachments fail | Check private bucket existence, file type/size, current request access and Storage policies. |
| Permission errors | Verify current profile status and organizational scope. Do not disable RLS to make a test pass. |
| Port 8443 unavailable | Stop its current process or choose another PORT and update allowed origins. |

The separate NOTIFICATIONS.md report contains the full event-recipient matrix, additional verification SQL, deployment limitations and manual acceptance checks.
