// ============================================================================
// LinkBarangay — profile & user management service
// ============================================================================

import { supabase } from "@/lib/supabase"
import type { AccountStatus, Profile, Role, WorkerFunction } from "@/types"

const PROFILE_SELECT = `
  id, full_name, email, mobile, address, role, worker_function, status,
  barangay_id, department_id, created_at, updated_at,
  barangay:lb_barangays!lb_profiles_barangay_id_fkey(id, name),
  department:lb_departments!lb_profiles_department_id_fkey(id, name)
`

function toProfile(row: Record<string, unknown>): Profile {
  return row as unknown as Profile
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("lb_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toProfile(data) : null
}

/** Residents update only their own free-text fields (DB trigger guards scope). */
export async function updateOwnProfile(
  userId: string,
  patch: { full_name?: string; mobile?: string; address?: string },
): Promise<Profile> {
  const { data, error } = await supabase
    .from("lb_profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return toProfile(data)
}

// ---------------------------------------------------------------------------
// Administration (enforced again by RLS + triggers server-side)
// ---------------------------------------------------------------------------

export interface UserFilters {
  search?: string
  role?: Role | ""
  status?: AccountStatus | ""
  page?: number
  pageSize?: number
}

export async function listUsers(filters: UserFilters = {}) {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, filters.pageSize ?? 25)

  let query = supabase
    .from("lb_profiles")
    .select(PROFILE_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (filters.search) {
    const term = filters.search.trim().replace(/[%_,()]/g, "")
    if (term) {
      query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
    }
  }
  if (filters.role) query = query.eq("role", filters.role)
  if (filters.status) query = query.eq("status", filters.status)

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return { users: ((data ?? []) as unknown as Profile[]), total: count ?? 0, page, pageSize }
}

export interface AdminUpdateInput {
  role?: Role
  worker_function?: WorkerFunction | null
  status?: AccountStatus
  barangay_id?: string | null
  department_id?: string | null
}

export async function adminUpdateUser(userId: string, patch: AdminUpdateInput): Promise<void> {
  const { error } = await supabase.from("lb_profiles").update(patch).eq("id", userId)
  if (error) {
    // Surface the DB trigger/policy message (e.g. self-elevation blocked)
    throw new Error(error.message)
  }
}

// ---------------------------------------------------------------------------
// Scoped directory lookups (RLS enforces what the caller may see)
// ---------------------------------------------------------------------------

/** Worker profiles within a barangay (front desk / officer / supervisor functions). */
export async function listBarangayStaff(barangayId: string | null): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("lb_profiles")
    .select(PROFILE_SELECT)
    .eq("barangay_id", barangayId ?? "00000000-0000-0000-0000-000000000000")
    .eq("role", "worker")
    .in("worker_function", ["secretary", "officer", "captain"])
    .order("full_name")
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Profile[])
}

/** Active field personnel of a department (dispatcher assignment picker). */
export async function listFieldPersonnel(departmentId: string | null): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("lb_profiles")
    .select(PROFILE_SELECT)
    .eq("role", "worker")
    .eq("worker_function", "field")
    .eq("status", "active")
    .eq("department_id", departmentId ?? "00000000-0000-0000-0000-000000000000")
    .order("full_name")
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Profile[])
}

/** Residents of a barangay (secretary / officer records view). */
export async function listBarangayResidents(
  barangayId: string | null,
  search = "",
): Promise<Profile[]> {
  let query = supabase
    .from("lb_profiles")
    .select(PROFILE_SELECT)
    .eq("role", "resident")
    .eq("barangay_id", barangayId ?? "00000000-0000-0000-0000-000000000000")
    .order("full_name")
    .limit(200)
  if (search.trim()) {
    const term = search.trim().replace(/[%_,()]/g, "")
    if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Profile[])
}
