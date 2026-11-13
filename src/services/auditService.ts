// ============================================================================
// LinkBarangay — audit log service (admin read-only; writes happen server-side)
// ============================================================================

import { supabase } from "@/lib/supabase"
import type { AuditLog } from "@/types"

export interface AuditFilters {
  action?: string
  entity_type?: string
  search?: string
  page?: number
  pageSize?: number
}

export async function listAuditLogs(filters: AuditFilters = {}) {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, filters.pageSize ?? 30)

  let query = supabase
    .from("lb_audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (filters.action) query = query.eq("action", filters.action)
  if (filters.entity_type) query = query.eq("entity_type", filters.entity_type)
  if (filters.search) {
    const term = filters.search.trim().replace(/[%_,()]/g, "")
    if (term) {
      query = query.or(`actor_name.ilike.%${term}%,entity_id.ilike.%${term}%`)
    }
  }

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return { logs: (data ?? []) as AuditLog[], total: count ?? 0, page, pageSize }
}
