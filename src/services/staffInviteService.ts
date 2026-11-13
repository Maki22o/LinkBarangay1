// ============================================================================
// LinkBarangay — staff account creation via the create-staff-user Edge
// Function. The service-role key exists ONLY inside that function's server
// secrets; the frontend just calls it with the caller's session token.
// See supabase/README_RUNBOOK.md for deployment.
// ============================================================================

import { supabase } from "@/lib/supabase"
import type { WorkerFunction } from "@/types"

export interface StaffInviteInput {
  mode: "invite" | "create"
  role: "resident" | "worker"
  email: string
  fullName: string
  mobile?: string
  address?: string
  workerFunction?: WorkerFunction | null
  barangayId?: string | null
  departmentId?: string | null
}

export interface StaffInviteResult {
  ok: boolean
  userId: string
  email: string
  mode: string
  temporaryPassword?: string
}

export class EdgeFunctionUnavailableError extends Error {
  constructor(message = "The staff-account service is not deployed yet.") {
    super(message)
    this.name = "EdgeFunctionUnavailableError"
  }
}

export async function createStaffAccount(input: StaffInviteInput): Promise<StaffInviteResult> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error("Your session expired — sign in again.")

  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-staff-user`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        mode: input.mode,
        role: input.role,
        email: input.email,
        fullName: input.fullName,
        mobile: input.mobile ?? "",
        address: input.address ?? "",
        workerFunction: input.role === "worker" ? input.workerFunction : null,
        barangayId: input.role === "worker" ? input.barangayId ?? null : null,
        departmentId: input.role === "worker" ? input.departmentId ?? null : null,
      }),
    })
  } catch {
    throw new EdgeFunctionUnavailableError(
      "Could not connect to the account service. Check your internet connection and try again.",
    )
  }

  if (response.status === 404) {
    throw new EdgeFunctionUnavailableError(
      "The account service is not deployed on this Supabase project. Deploy create-staff-user (see supabase/README_RUNBOOK.md), then try again.",
    )
  }

  const body = (await response.json().catch(() => null)) as
    | (StaffInviteResult & { error?: string })
    | null

  if (!response.ok) {
    const message = body?.error ?? `Request failed (${response.status})`
    if (/not deployed|not found|failed to fetch/i.test(message)) {
      throw new EdgeFunctionUnavailableError(message)
    }
    throw new Error(message)
  }
  if (!body?.ok) throw new Error(body?.error ?? "The service returned an unexpected response.")
  return body
}
