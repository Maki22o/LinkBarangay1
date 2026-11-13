# LinkBarangay Supabase setup

This project is configured to use the `linkbarangay Project collab` Supabase project.

## Local setup

1. Install dependencies: `npm install`
2. Ensure `.env.local` contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Start Vite: `npm run dev`.

The client is exported from `src/lib/supabase.ts`:

```ts
import { supabase, LINKBARANGAY_TABLES } from './lib/supabase'
```

Primary database tables include `lb_profiles`, `lb_service_requests`,
`lb_request_updates`, `lb_assignments`, `lb_appointments`, `lb_attachments`,
`lb_notifications`, and `lb_audit_logs`.

There are exactly three account roles: `resident`, `worker`, and `admin`.
Workers have a `worker_function` value (`secretary`, `officer`, `captain`,
`dispatcher`, or `field`) that scopes their available tools and permissions.

The frontend uses Supabase Auth, Row Level Security, and the current migrations.
Never put a service-role or secret key in this Vite frontend. Migration order
and the deployed worker invitation function are documented in
`supabase/README_RUNBOOK.md`.
