// ============================================================================
// LinkBarangay Edge Function — create-staff-user
//
// Securely creates resident or worker accounts. Admin accounts are provisioned
// only through trusted setup, never through this public API function.
// The service-role key lives ONLY in this function's server secrets —
// it must never be added to the Vite frontend. See supabase/README_RUNBOOK.md
// for the exact deployment steps.
//
// Caller must be an authenticated, ACTIVE administrator. Administrator
// accounts themselves are provisioned directly (SQL editor / dashboard), not
// through this endpoint.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VALID_WORKER_FUNCTIONS = ["secretary", "officer", "captain", "dispatcher", "field"] as const;
type WorkerFunction = (typeof VALID_WORKER_FUNCTIONS)[number];
type AccountRole = "resident" | "worker";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "http://127.0.0.1:8443";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function strongPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const base = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  // Guarantee character-class variety for Supabase password rules
  return "Lb" + base.slice(0, 22) + "9!";
}

Deno.serve(async (req: Request) => {
  try {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceRoleKey || !supabaseUrl) {
    return json({ error: "Function is missing its service-role secret" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---- 1. Authenticate the caller -----------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization header" }, 401);

  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller.user) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: profileErr } = await admin
    .from("lb_profiles")
    .select("role, status, full_name")
    .eq("id", caller.user.id)
    .single();

  if (profileErr || !callerProfile) return json({ error: "Caller profile not found" }, 403);
  if (callerProfile.role !== "admin" || callerProfile.status !== "active") {
    return json({ error: "Only active administrators may create staff accounts" }, 403);
  }

  // ---- 2. Validate the payload --------------------------------------------
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Invalid JSON body" }, 400);

  const mode: "invite" | "create" = body.mode === "invite" ? "invite" : "create";
  const role = body.role as AccountRole;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const workerFunction = body.workerFunction as WorkerFunction;
  const barangayId: string | null = body.barangayId || null;
  const departmentId: string | null = body.departmentId || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email is required" }, 400);
  if (fullName.length < 2 || fullName.length > 120) return json({ error: "Full name (2-120 chars) is required" }, 400);
  if (role !== "resident" && role !== "worker") {
    return json({ error: "Role must be resident or worker" }, 400);
  }
  if (role === "resident" && !barangayId) {
    return json({ error: "Select a barangay for this resident so requests can reach the right front desk" }, 400);
  }
  if (role === "worker" && !VALID_WORKER_FUNCTIONS.includes(workerFunction)) {
    return json({ error: `Worker function must be one of: ${VALID_WORKER_FUNCTIONS.join(", ")}` }, 400);
  }
  if (role === "worker" && ["secretary", "officer", "captain"].includes(workerFunction) && !barangayId) {
    return json({ error: "Select a barangay for this worker function" }, 400);
  }
  if (role === "worker" && ["dispatcher", "field"].includes(workerFunction) && !departmentId) {
    return json({ error: "Select a department for this worker function" }, 400);
  }

  const barangayWorker = role === "worker" && ["secretary", "officer", "captain"].includes(workerFunction);
  const departmentWorker = role === "worker" && ["dispatcher", "field"].includes(workerFunction);
  const scopedBarangayId = role === "resident" || barangayWorker ? barangayId : null;
  const scopedDepartmentId = departmentWorker ? departmentId : null;
  const { data: barangay } = scopedBarangayId
    ? await admin.from("lb_barangays").select("id").eq("id", scopedBarangayId).eq("is_active", true).single()
    : { data: null };
  if (scopedBarangayId && !barangay) return json({ error: "Unknown barangay" }, 400);

  const { data: department } = scopedDepartmentId
    ? await admin.from("lb_departments").select("id").eq("id", scopedDepartmentId).eq("is_active", true).single()
    : { data: null };
  if (scopedDepartmentId && !department) return json({ error: "Unknown department" }, 400);

  // ---- 3. Create the auth user --------------------------------------------
  let userId: string;
  let temporaryPassword: string | undefined;

  if (mode === "invite") {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName,
        mobile,
        address,
        barangay_id: scopedBarangayId,
        ...(role === "worker" ? { requested_role: "worker" } : {}),
      },
      redirectTo: APP_ORIGIN,
    });
    if (error || !data.user) return json({ error: error?.message ?? "Invite failed" }, 400);
    userId = data.user.id;
  } else {
    temporaryPassword = strongPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        mobile,
        address,
        barangay_id: scopedBarangayId,
        ...(role === "worker" ? { requested_role: "worker" } : {}),
      },
    });
    if (error || !data.user) return json({ error: error?.message ?? "User creation failed" }, 400);
    userId = data.user.id;
  }

  // ---- 4. Provision the profile with the authorized role -------------------
  const { error: upsertErr } = await admin
    .from("lb_profiles")
    .upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        mobile,
        address,
        role,
        worker_function: role === "worker" ? workerFunction : null,
        status: "active",
        barangay_id: scopedBarangayId,
        department_id: scopedDepartmentId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (upsertErr) return json({ error: "Auth user created but profile failed: " + upsertErr.message }, 500);

  // ---- 5. Audit ------------------------------------------------------------
  await admin.from("lb_audit_logs").insert({
    actor_id: caller.user.id,
    actor_name: callerProfile.full_name ?? "Administrator",
    action: "staff.account_created",
    entity_type: "lb_profiles",
    entity_id: userId,
    details: {
      email,
      role,
      worker_function: role === "worker" ? workerFunction : null,
      mode,
      barangay_id: scopedBarangayId,
      department_id: scopedDepartmentId,
    },
  });

  return json({
    ok: true,
    userId,
    email,
    mode,
    temporaryPassword, // only present for mode="create" — shown to the admin ONCE
  });
  } catch (error) {
    console.error("create-staff-user failed", error);
    return json({ error: "The account service failed unexpectedly. Please retry." }, 500);
  }
});

