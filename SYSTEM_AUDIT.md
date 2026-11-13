# LinkBarangay System Audit and Fix Report

**Updated:** 13 November 2026  
**Scope:** source code, role/permission model, migrations, live Supabase schema and advisor results, Edge Function deployment, TypeScript check, and production build.

## Initial audit assessment

The project has a broad, integrated service-request workflow, but the updated frontend and live role schema had diverged. Important request/notification fixes were present in source, while the connected project had no Worker/Admin test accounts or request records. As a result, this audit distinguishes code/schema verification from actual runtime tests.

| Module / Feature | Current status | Issue found | Required action | Priority |
|---|---|---|---|---|
| Authentication | Partially verified | Live profile exists; sign-in/sign-out UI was not interactively tested. | Run a browser session with test accounts. | High |
| Roles and permissions | Schema and code verified | DB previously exposed seven staff roles and lacked `worker_function`. | Applied three-role migration; worker scope stored separately. | High |
| Resident request | Partially verified | Server validation responded to invalid description; valid request persistence was not tested. | Submit a valid request with a resident account. | High |
| Worker assignment | Code/schema verified; workflow not tested | No Worker/Admin identities or request rows in live project. | Test dispatch, accept, progress, completion, and reassignment. | High |
| Notifications | Code/schema reviewed; delivery not tested | No real request update was generated during this audit. | Verify realtime and persisted notifications with test accounts. | Medium |
| Attachments | Storage configuration verified | Actual file upload/download was not exercised. | Test valid and invalid file uploads in the app. | Medium |
| Admin configuration and reports | Source reviewed; CRUD not tested | No Admin account available. | Exercise category, settings, account, report, and audit flows. | Medium |
| Search | Implemented; build-verified | Global search was previously an unconnected input. | Now submits to the request list filter. | Medium |
| Responsive layout | Not tested | No controllable app browser session was available. | Inspect desktop/tablet/mobile in a browser. | Medium |
| Public anonymous flow | Source reviewed; not runtime-tested | Anonymous report/tracking RPCs remain public SECURITY DEFINER endpoints. | Review/rate-limit before broad public use. | High |
| Build and type safety | Verified | Vite warnings remain for config deprecation and bundle size. | Build passes; consider future code-splitting. | Low |

## Executive summary

The system now uses exactly three account roles: `resident`, `worker`, and `admin`. Worker specializations remain in `worker_function` so existing least-privilege workflows can continue without presenting secretary/officer/captain/dispatcher/field as separate account roles.

Migration `0007_three_account_roles` was applied to the connected Supabase project. Migration `0008_foreign_key_indexes` and `0009_rls_auth_initplan` were also applied. The `create-staff-user` Edge Function is deployed with JWT verification enabled. The live project is healthy and its one existing profile remains a resident. The current project has no worker or admin test accounts and no service requests, so a complete multi-role request lifecycle could not be executed without creating test data/accounts.

## What is implemented

- Resident sign-up/profile, request submission, request history/detail, notifications, profile editing, attachments, public tracking, and anonymous reporting.
- Worker dashboards and specialized tools for front desk intake, barangay review, supervision, department dispatch, and field assignments.
- Admin account management, worker invitations, reference/configuration data, reports, and audit views.
- Global search now submits into the request list and applies its title/reference filter.
- Scoped request lists and workflow RPCs, RLS policies, status/activity records, notifications, signed attachment access, and storage validation.
- Three top-level roles are represented in frontend types, permission checks, admin role forms, display labels, navigation, and the database constraint.

## Findings and changes

| Priority | Finding | Change / status |
|---|---|---|
| High | Frontend role model and live database diverged. The database accepted seven roles and had no `worker_function` column, although the updated app needed three roles plus worker specialization. | Fixed. Migration 0007 adds the worker function, remaps legacy staff accounts, enforces role/function consistency, updates worker-aware workflow RPCs, and preserves the existing RLS scope rules. Applied live. |
| High | Worker invitation endpoint was absent from the live project. | Fixed. `create-staff-user` is deployed with JWT verification. It verifies the caller is an active admin and only provisions a worker with an allowed specialization. |
| High | Worker accounts could be created without the scope required by their function, leaving them without applicable assignments/queues. | Fixed. Admin UI and Edge Function require a barangay for secretary/officer/captain and a department for dispatcher/field; migration 0010 adds a database constraint for new or updated worker profiles. |
| High | Several profile/scope helper and trigger functions were executable by anonymous clients even though they are not public APIs. | Fixed. Migration 0007 revokes anonymous/public execution from those helpers and trigger functions. Anonymous execution remains only on the intended anonymous-report and request-tracking RPCs. |
| High | Direct resident inserts could hit an RLS violation when the client tried to insert protected request fields. | The client now submits through `app_submit_resident_request`, which derives identity and protected values server-side and validates category/title/description/location. A prior UI attempt reached server-side validation and correctly rejected a five-character description. A valid end-to-end insert was not performed, so successful persistence still needs account-level verification. |
| Medium | Profile relationship queries lacked explicit foreign-key paths, producing schema-cache relationship errors. | Fixed in migration 0005 and service queries. |
| Medium | Attachment validation and upload-failure handling were incomplete. | Fixed in request service/UI: image/PDF and 10 MB validation, orphan cleanup on metadata failure, and visible partial-upload feedback. Migration 0003 configures the private bucket limit and MIME allowlist. |
| Medium | Notifications realtime subscription names could collide, and page/load/action failures were not consistently visible. | Fixed with unique channel names, surfaced hook errors, and a page-level error boundary/retry state. |
| Medium | Supabase flagged 14 foreign-key columns as unindexed. | Migration 0008 adds the corresponding indexes. The performance advisor no longer reports missing FK indexes. |
| Medium | Supabase flagged RLS policies that re-evaluated `auth.uid()` per row. | Migration 0009 wraps those calls in scalar subqueries while preserving policy predicates. |
| Medium | Assignment reassign/decline paths can create ambiguous outcomes if multiple assignments remain active. | Still open; must be addressed with a workflow rule and verified against real assignment states. |
| Medium | Anonymous report/tracking RPCs intentionally remain callable without sign-in and trigger the Supabase SECURITY DEFINER advisor. | Still open for review of rate limiting and capability-code exposure. They are needed for public anonymous reporting/tracking and were not disabled. |
| Low | Request location preview is illustrative rather than an interactive map/geocoder. | Still open; no maps provider is configured. |
| Low | Production bundle exceeds Vite's 500 kB advisory threshold. | Still open; build succeeds. Code splitting would reduce initial download size. |

## Role verification

| User type | Code/schema check | Live workflow test |
|---|---|---|
| Resident | Role constraint, resident request RPC, profile selection, request and notification views checked. Existing live profile is still `resident`. | Partial: a too-short description was rejected by server validation. No successful request was inserted. |
| Worker | `worker_function` union, function-specific permissions/navigation, worker queries, assignment RPC adaptations, and Edge Function payload checked. | Not end-to-end: no worker account exists in the connected project. |
| Admin | Admin-only permissions, user-management role options, and Edge Function admin guard checked. | Not end-to-end: no admin account exists in the connected project. |

Only three account roles are stored. The worker functions are capabilities within the `worker` role, not extra operational roles.

## Verification performed

- `npx tsc --noEmit` — passed.
- `npm run build` — passed; Vite reports an existing config deprecation warning and a large main bundle warning.
- Supabase project status — `ACTIVE_HEALTHY`.
- Live schema — `lb_profiles.worker_function` exists; role constraint accepts only `resident`, `worker`, and `admin`; one live profile is `resident` with no worker function.
- Live worker-scope check — migration 0010 is installed; there are currently zero worker profiles missing their required scope. The constraint is `NOT VALID` to preserve any legacy worker lacking scope in other environments; it enforces new/updated rows, and those legacy rows must be repaired before their next update.
- Live storage bucket — `request-attachments` is private, limited to 10 MiB, and allows JPEG/PNG/GIF/WebP/HEIC/HEIF/PDF MIME types.
- Live RPC definitions — the five role-sensitive request/assignment functions now read worker functions and were verified after migration.
- Live function grants — the only SECURITY DEFINER functions still callable by `anon` are `app_submit_anonymous_report` and `app_track_request`.
- Supabase security advisor — two anonymous SECURITY DEFINER warnings remain for public report/tracking; 21 authenticated-callable SECURITY DEFINER routines remain and need role-level runtime testing before being certified safe.
- Supabase health advisor — no findings.
- Supabase performance advisor — foreign-key-index and auth-initplan findings are clear after migrations 0008/0009. Remaining notices are 26 unused indexes on the currently tiny database and five overlapping permissive-policy notices that still need a targeted review.
- Live Edge Function deployment result — `create-staff-user` version 2 active, `verify_jwt=true`.
- Source and navigation were inspected. Full interactive browser testing was not completed: the available Chrome window was showing the ChatGPT page and the running preview was hosted within VS Code, not available as a controllable browser tab in this session.

### Test evidence matrix

| Test case | Expected result | Actual result | Status |
|---|---|---|---|
| `npx tsc --noEmit` | No TypeScript errors | Command exited successfully with no diagnostics. | **Passed** |
| `npm run build` | Production bundle created | Build completed; Vite printed config deprecation and >500 kB bundle warnings. | **Passed** |
| Supabase migrations 0007–0010 | Schema updated without data loss | Each migration tool call returned success; live columns, constraints, RLS policies, and RPC definitions were queried afterward. | **Passed** |
| Three-role database constraint | Only resident/worker/admin accepted | Live constraint shows those three values; existing profile is resident. | **Passed** |
| Worker scope guard | Reject a worker missing the scope for its function | Constraint is installed and live invalid-worker count is zero; no insert/update rejection was exercised. | **Blocked** |
| Attachment bucket configuration | Private, 10 MiB, allowed MIME types | Queried live `storage.buckets`; values match JPEG/PNG/GIF/WebP/HEIC/HEIF/PDF and 10 MiB. | **Passed** |
| Resident invalid-description validation | Reject description under 10 characters | A user-provided screenshot shows the app displaying “Enter a description between 10 and 4000 characters”; I did not reproduce the browser action. | **Not Tested** |
| Resident valid request persistence | Request, timeline, and notification saved | No valid insert was attempted; the live request count is zero. | **Blocked** — needs a browser session and resident test submission. |
| Admin invites Worker | Only active admin can invite worker | Edge Function is active, version 2, `verify_jwt=true`; no authenticated invocation was made. | **Blocked** |
| Admin assigns Worker | Assignment recorded and scoped | No Worker/Admin accounts or request rows exist for the test. | **Blocked** |
| Worker completes task | Assignment/request state updates | No worker account or assignment available. | **Blocked** |
| Resident notification delivery | New update appears in inbox/realtime | No request lifecycle event was generated during this audit. | **Blocked** |
| Anonymous report/tracking | Public flow works without exposing unrelated data | Not called. | **Not tested** |
| Browser navigation and responsive layouts | Pages/buttons work across viewport sizes | App preview was inside VS Code, Chrome was on ChatGPT, and local HTTP access was denied by the execution sandbox. | **Blocked** |

### Build and environment checks

- `npx tsc --noEmit` — executed, passed.
- `npm run build` — executed, passed with the warnings above.
- `npm run` — confirmed scripts are `dev`, `build`, `preview`, and `format`; no test or lint script is defined.
- `npm install` — not run; dependencies were already present in `node_modules`.
- `npm run dev` — not run; the project instructions report a pre-existing VS Code preview server. The attempted HTTP probe to `127.0.0.1:8443` was blocked by the sandbox, so server startup/HTTP response was not verified here.
- Supabase migrations — live project was queried directly; migrations 0007–0010 were applied through the Supabase integration. Historical 0005/0006 were already applied manually in SQL Editor.

## Remaining attention

1. Sign in with one resident, one worker, and one admin account to test the full request lifecycle, including assignment, worker progress, completion, notification delivery, and role boundaries. The connected database currently has no worker/admin test identities.
2. Submit one valid resident request in the app to verify that the RPC persists it and the notification/timeline records appear.
3. If another environment has legacy workers with no scope, assign each a barangay or department before validating `lb_profiles_worker_scope_check`.
4. Review/rate-limit the public anonymous report and tracking endpoints before wider public deployment.
5. Decide how reassignment handles prior active assignments, then encode and test that policy.
6. Add a real map provider only if location picking is required.
7. Consider code splitting and review remaining performance-advisor notices after enough real usage data exists.

## Migrations and local run

For a fresh/reset database, apply migrations in order: `0001` through `0010`. The live project already has `0007` through `0010` applied; historical `0005`/`0006` had previously been run through the Supabase SQL Editor. Do not re-run migrations manually out of sequence.

Local app setup: ensure `.env.local` contains the matching `VITE_SUPABASE_URL` and publishable key only, run `npm install`, then `npm run dev`. Never add the Supabase service-role key to the frontend environment.

## Change inventory

### Newly added migration files

| File path | Change made | Reason | Status |
|---|---|---|---|
| `supabase/migrations/0005_profile_relationships.sql` | Added explicit profile FKs for request submitter/assignee, assignments, appointments. | Fix PostgREST relationship-cache errors. | Applied previously; live FKs verified. |
| `supabase/migrations/0006_resident_request_submission.sql` | Added authenticated resident submission RPC with server-side validation and protected fields. | Avoid client-side RLS insert failures and prevent callers selecting protected request state. | Applied previously; valid submission still needs end-to-end test. |
| `supabase/migrations/0007_three_account_roles.sql` | Migrates old role values to worker + function, updates RPC role handling, tightens helper/trigger execution grants. | Enforce three account roles and preserve worker scope. | Applied and live schema/RPCs verified. |
| `supabase/migrations/0008_foreign_key_indexes.sql` | Adds indexes to previously unindexed FK columns. | Address Supabase performance findings. | Applied; no missing-FK-index warnings remain. |
| `supabase/migrations/0009_rls_auth_initplan.sql` | Wraps repeated `auth.uid()` calls in statement-level scalar subqueries. | Reduce per-row auth function evaluation. | Applied; no auth-initplan findings remain. |
| `supabase/migrations/0010_worker_scope_constraints.sql` | Adds a `NOT VALID` check requiring worker-function-specific barangay/department scope on new/updated profiles. | Prevent new workers from being created without the scope their queue requires while preserving legacy rows until repaired. | Applied; current invalid-worker count is zero. |

### Modified source/configuration files

| File path | Change made | Reason | Status |
|---|---|---|---|
| `src/types/index.ts` | Defines only resident/worker/admin account roles and a separate worker-function type/label. | Match the requested three-role model. | Complete; build passed. |
| `src/permissions/permissions.ts` | Uses function-specific worker permissions and navigation while exposing three roles. | Preserve least privilege under Worker. | Complete; build passed. |
| `src/App.tsx` | Routes dashboards by worker function; adds global request-search handling; wraps notifications error state. | Repair role routing, search, and notification errors. | Complete; build passed. |
| `src/components/layout/AppShell.tsx` | Displays three-role identity labels; submits global search to request list. | Remove inert search behavior and align role display. | Complete; build passed. |
| `src/features/admin/AdminPages.tsx` | Adds worker-function editing/invitation and requires proper barangay/department scope. | Make admin provisioning match the database constraints. | Complete; build passed. |
| `src/features/resident/SubmitRequestPage.tsx` | Adds request field validation and visible partial upload failure. | Prevent invalid requests and silent attachment failures. | Complete; build passed. |
| `src/features/shared/RequestsPage.tsx` | Accepts the submitted global search term. | Apply toolbar search to request query. | Complete; build passed. |
| `src/features/shared/RequestDetailPage.tsx` | Checks worker function for dispatcher/field/staff actions. | Preserve scoped actions after role consolidation. | Complete; build passed. |
| `src/features/shared/StaffDashboard.tsx` | Selects staff dashboard behavior from `worker_function`. | Keep worker specialist dashboards available under Worker. | Complete; build passed. |
| `src/features/shared/ProfilePage.tsx` | Displays Resident/Worker/Admin labels and worker specialization. | Align profile UI with role model. | Complete; build passed. |
| `src/features/shared/NotificationsPage.tsx` | Surfaces fetch/action failures and retry/error state. | Make notification failures diagnosable. | Complete; build passed. |
| `src/hooks/useNotifications.ts` | Exposes fetch errors instead of swallowing them. | Show real notification load failures. | Complete; build passed. |
| `src/services/notificationService.ts` | Uses unique realtime channel names. | Avoid channel collisions across subscriptions. | Complete; build passed. |
| `src/services/profileService.ts` | Selects worker function and filters workers by function. | Keep profile joins and directories compatible with schema. | Complete; build passed. |
| `src/services/requestService.ts` | Uses resident submission RPC, role-specific request scopes, attachment validation/cleanup, explicit FK relationships. | Repair insert, data selection, and upload paths. | Complete; build passed. |
| `src/services/assignmentService.ts` | Uses explicit assigned-worker profile FK relationship. | Repair assignment profile joins. | Complete; build passed. |
| `src/services/appointmentService.ts` | Uses explicit resident profile FK relationship. | Repair appointment profile joins. | Complete; build passed. |
| `src/services/staffInviteService.ts` | Sends `workerFunction` to the Edge Function. | Match server payload contract. | Complete; build passed. |
| `supabase/functions/create-staff-user/index.ts` | Provisions `role=worker`, validates worker function and required scope. | Prevent unscoped worker accounts and enforce server-side permissions. | Deployed version 2; invocation not tested. |
| `supabase/migrations/0001_profiles_roles.sql` | Establishes three roles, worker-function column/constraints, helper and self-update rules. | Make the canonical schema use the requested role model. | Updated for fresh installs; live migration 0007 applied. |
| `supabase/migrations/0003_requests_workflow.sql` | Audits worker-function changes and sets attachment bucket constraints. | Preserve audit detail and enforce storage limits. | Updated; live bucket settings verified. |
| `supabase/migrations/0004_rls_policies_workflow.sql` | Uses worker functions for scoped RLS/RPC logic and caches auth uid in relevant policies. | Keep worker permissions functional after role consolidation. | Updated; live migrations applied. |
| `SUPABASE_SETUP.md` | Documents the three roles and integrated Supabase setup. | Remove outdated mock/prototype setup guidance. | Updated. |
| `supabase/README_RUNBOOK.md` | Documents migration order, worker function, scope, and deployment state. | Keep setup instructions aligned to live project. | Updated. |
| `SYSTEM_AUDIT.md` | Records findings, implementation, file inventory, test evidence, and limitations. | Deliver reviewable audit evidence. | Updated. |

### Deleted files

None.

### Deployment and production configuration

- Live Supabase database migrations 0007–0010 were applied; migration 0005/0006 had previously been run manually in SQL Editor. Historical manual migrations may not be in `supabase_migrations.schema_migrations`.
- `create-staff-user` is deployed and JWT verification is enabled. Confirm function logs and email invitation settings when testing invites.
- Use `.env.local` with the correct project URL and publishable key only. Keep service-role credentials in server-side Supabase Function secrets.
- Before production, set the Edge Function `ALLOWED_ORIGIN` to the deployed app origin, configure Auth Site URL/redirect URLs, review public anonymous RPC rate limits, and perform the blocked role-level workflow tests.
- Build/deploy commands: `npm install`, `npm run build`; publish the generated `dist/` output to the chosen static host. No hosting provider deployment was performed in this audit.
