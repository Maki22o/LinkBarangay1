# Phase 1 staging acceptance checklist

Use separate accounts in the staging project: Resident A, Resident B,
Barangay Staff A, Dispatcher A, Field A, and Admin A. Do not treat UI route
visibility as proof; use browser network responses and direct Supabase queries
with each account session.

## Authentication

- [ ] Register a new resident; verify no protected screen is available before
  email confirmation.
- [ ] Confirm email; sign in and verify a profile is created.
- [ ] Attempt duplicate email registration; expect a safe duplicate-account
  response.
- [ ] Attempt weak and known-leaked passwords; expect rejection by Supabase.
- [ ] With CAPTCHA enabled, verify sign-up, sign-in, and password reset reject
  missing/invalid CAPTCHA tokens.
- [ ] Sign in as each worker/admin at AAL1; expect the MFA gate and denied
  protected-data API calls.
- [ ] Enroll TOTP, complete the challenge, then verify AAL2 access works.

## Scope and RLS

- [ ] Resident A can read only their profile, requests, verification document,
  attachments, and notifications; Resident B's UUIDs return no rows/403.
- [ ] Barangay Staff A sees only its barangay's requests and residents.
- [ ] Dispatcher A and Field A see only the matching **department and
  barangay** records; repeat using another barangay with the same department.
- [ ] Field A cannot update an unassigned request or another field worker's job.
- [ ] AAL1 worker/admin calls to request, assignment, appointment, profile
  administration, and staff-invite endpoints are denied.
- [ ] Non-admin calls to `create-staff-user` are denied; admin AAL2 calls work.
- [ ] Direct attempts to update own `role`, `status`, `barangay_id`,
  `department_id`, or `worker_function` are rejected and audited.

## Workflow and public tracking

- [ ] Verified Resident A submits a request with valid required fields and
  evidence; verify one unique `LB-` + 32-hex reference is generated.
- [ ] Staff verifies/routes it, dispatcher assigns Field A, Field A updates
  progress, staff inspects/resolves it; check notifications and history at each
  authorized role.
- [ ] Invalid state transitions and cross-scope assignment attempts are denied.
- [ ] Public tracking accepts the new opaque reference but returns only
  reference, status, timestamps, and generic status events.
- [ ] Public tracking rejects legacy short references, invalid references, and
  excess requests after rate limiting.
- [ ] Confirm browser console and failed network responses contain no service
  role key, OpenRouter key, resident document URL, or sensitive request data.
