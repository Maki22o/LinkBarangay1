// ============================================================================
// LinkBarangay — configuration service (barangays, departments, categories,
// settings). Reads are public; writes are admin-only and enforced by RLS.
// ============================================================================

import { supabase } from "@/lib/supabase"
import type { AppSettings, Barangay, Department, ServiceCategory } from "@/types"

export async function listBarangays(): Promise<Barangay[]> {
  const { data, error } = await supabase
    .from("lb_barangays")
    .select("*")
    .order("name", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Barangay[]
}

export async function listDepartments(): Promise<Department[]> {
  const { data, error } = await supabase
    .from("lb_departments")
    .select("*")
    .order("name", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Department[]
}

export async function listCategories(includeInactive = false): Promise<ServiceCategory[]> {
  let query = supabase
    .from("lb_service_categories")
    .select("*, department:lb_departments(id, name)")
    .order("name", { ascending: true })
  if (!includeInactive) query = query.eq("is_active", true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ServiceCategory[]
}

// --- Admin CRUD (RLS enforces admin-only) -----------------------------------

export async function upsertBarangay(row: Partial<Barangay> & { name: string }): Promise<void> {
  const { error } = await supabase.from("lb_barangays").upsert(row)
  if (error) throw new Error(error.message)
}

export async function upsertDepartment(row: Partial<Department> & { name: string }): Promise<void> {
  const { error } = await supabase.from("lb_departments").upsert(row)
  if (error) throw new Error(error.message)
}

export async function upsertCategory(
  row: Partial<ServiceCategory> & { name: string; slug: string },
): Promise<void> {
  const { error } = await supabase.from("lb_service_categories").upsert(row)
  if (error) throw new Error(error.message)
}

export async function getSettings(key: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("lb_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.value as Record<string, unknown>) ?? null
}

export async function getAllSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.from("lb_settings").select("key, value")
  if (error) throw new Error(error.message)
  const out: AppSettings = {}
  for (const row of data ?? []) out[row.key] = row.value
  return out
}

export async function upsertSetting(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("lb_settings").upsert({ key, value })
  if (error) throw new Error(error.message)
}
