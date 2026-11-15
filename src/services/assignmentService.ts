// ============================================================================
// LinkBarangay — field job assignment service
// State changes go through the SECURITY DEFINER RPCs; RLS scopes reads.
// ============================================================================

import { supabase } from "@/lib/supabase"
import { withCurrentAssignments } from "@/lib/assignmentState"
import type { Assignment } from "@/types"

const ASSIGNMENT_SELECT = `
  id, request_id, assigned_to, assigned_by, department_id, status, decline_reason,
  schedule_at, deadline_at, accepted_at, completed_at, notes, created_at, updated_at,
  request:lb_service_requests(
    id, reference, title, status, priority, location, category_id, department_id, assigned_to,
    due_at, created_at,
    category:lb_service_categories(id, name),
    department:lb_departments(id, name)
  ),
  assignee:lb_profiles!lb_assignments_assigned_to_profile_fkey(id, full_name)
`

export async function listMyAssignments(userId: string): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from("lb_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("assigned_to", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return withCurrentAssignments((data ?? []) as unknown as Assignment[])
}

export async function listDepartmentAssignments(departmentId: string | null): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from("lb_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("department_id", departmentId ?? "00000000-0000-0000-0000-000000000000")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return withCurrentAssignments((data ?? []) as unknown as Assignment[])
}

export async function listRequestAssignments(requestId: string): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from("lb_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
  if (error) throw new Error(error.message)
  return withCurrentAssignments((data ?? []) as unknown as Assignment[])
}

export async function getAssignment(id: string): Promise<Assignment | null> {
  const { data, error } = await supabase
    .from("lb_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const job = data as unknown as Assignment
  // The detail page may open a job older than the list window. Include all
  // statuses so a completed newer job cannot revive an old pending record.
  const latest = await supabase.from("lb_assignments").select("id")
    .eq("request_id", job.request_id).eq("assigned_to", job.assigned_to)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(1).maybeSingle()
  if (latest.error) throw new Error(latest.error.message)
  return { ...job, current_assignment_id: latest.data?.id ?? null }
}

// --- Field personnel actions (server-enforced ownership checks) -------------

export async function acceptAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase.rpc("app_accept_assignment", { p_assignment_id: assignmentId })
  if (error) throw new Error(error.message)
}

export async function declineAssignment(assignmentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("app_decline_assignment", {
    p_assignment_id: assignmentId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
}

export async function updateJobProgress(assignmentId: string, remarks: string): Promise<void> {
  const { error } = await supabase.rpc("app_update_job_progress", {
    p_assignment_id: assignmentId,
    p_remarks: remarks,
  })
  if (error) throw new Error(error.message)
}

export async function completeJob(assignmentId: string, remarks?: string): Promise<void> {
  const { error } = await supabase.rpc("app_complete_job", {
    p_assignment_id: assignmentId,
    p_remarks: remarks ?? null,
  })
  if (error) throw new Error(error.message)
}
