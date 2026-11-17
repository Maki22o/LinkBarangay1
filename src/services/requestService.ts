// ============================================================================
// LinkBarangay — service request service
// All row visibility is enforced by RLS; the filters here simply match the
// caller's scope so lists render correctly.
// ============================================================================

import { supabase } from "@/lib/supabase"
import type {
  Profile,
  RequestPriority,
  RequestStatus,
  RequestUpdate,
  ServiceRequest,
} from "@/types"

const REQUEST_SELECT = `
  id, reference, title, description, category_id, barangay_id, department_id,
  status, priority, is_anonymous, is_custom, submitter_name, submitter_contact, location,
  location_latitude, location_longitude, location_details,
  submitted_by, assigned_to, assigned_by, due_at, estimated_completion_at, estimated_duration_minutes, estimate_recorded_at, needs_info_by, needs_info_message,
  rejection_reason, resolved_at, closed_at, reopened_count, escalation_count,
  created_at, updated_at,
  category:lb_service_categories(id, name, slug, sla_hours, field_appointment_minutes),
  barangay:lb_barangays(id, name),
  department:lb_departments(id, name),
  submitter:lb_profiles!lb_service_requests_submitted_by_profile_fkey(id, full_name, email, mobile, address),
  assignee:lb_profiles!lb_service_requests_assigned_to_profile_fkey(id, full_name)
`

export interface RequestListFilters {
  status?: RequestStatus | ""
  priority?: RequestPriority | ""
  sortBy?: "newest" | "priority"
  categoryId?: string | ""
  departmentId?: string | ""
  search?: string
  overdue?: boolean
  page?: number
  pageSize?: number
}

/** A server-side Realtime filter matching each authenticated request scope. */
export function requestRealtimeFilter(profile: Profile): string | undefined {
  if (profile.role === "resident") return `submitted_by=eq.${profile.id}`
  if (profile.role === "admin") return undefined
  if (profile.worker_function === "field") return `assigned_to=eq.${profile.id}`
  if (profile.worker_function === "barangay_staff") {
    return profile.barangay_id ? `barangay_id=eq.${profile.barangay_id}` : undefined
  }
  if (profile.worker_function === "dispatcher") {
    // Realtime accepts one filter only; RLS enforces the additional barangay scope.
    return profile.department_id ? `department_id=eq.${profile.department_id}` : undefined
  }
  return undefined
}

export async function listRequests(profile: Profile, filters: RequestListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, filters.pageSize ?? 20)

  let query = supabase
    .from("lb_service_requests")
    .select(
      `id, reference, title, status, priority, is_anonymous, is_custom, submitter_name, location,
       location_latitude, location_longitude, location_details,
       category_id, department_id, barangay_id, submitted_by, assigned_to, priority_rank,
       due_at, created_at, updated_at, escalation_count,
       category:lb_service_categories(id, name, slug),
       department:lb_departments(id, name),
       barangay:lb_barangays(id, name)`,
      { count: "exact" },
    )
    .order(filters.overdue ? "due_at" : filters.sortBy === "priority" ? "dispatch_priority_order" : "created_at",
      { ascending: Boolean(filters.overdue), nullsFirst: false })
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1)

  // Scope filter mirrors the RLS policies (RLS remains the real gatekeeper)
  if (profile.role === "resident") query = query.eq("submitted_by", profile.id)
  else if (profile.role === "worker" && profile.worker_function === "field") query = query.eq("assigned_to", profile.id)
  else if (profile.role === "worker" && profile.worker_function === "barangay_staff")
    query = query.eq("barangay_id", profile.barangay_id ?? "00000000-0000-0000-0000-000000000000")
  else if (profile.role === "worker" && profile.worker_function === "dispatcher")
    query = query
      .eq("department_id", profile.department_id ?? "00000000-0000-0000-0000-000000000000")
      .eq("barangay_id", profile.barangay_id ?? "00000000-0000-0000-0000-000000000000")

  if (filters.status) query = query.eq("status", filters.status)
  if (filters.priority === "normal") query = query.in("priority", ["normal", "medium"])
  else if (filters.priority) query = query.eq("priority", filters.priority)
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId)
  if (filters.departmentId) query = query.eq("department_id", filters.departmentId)
  if (filters.overdue) {
    query = query
      .not("due_at", "is", null)
      .lt("due_at", new Date().toISOString())
      .not("status", "in", "('resolved','closed','rejected')")
  }
  if (filters.search) {
    const term = filters.search.trim().replace(/[%_,()]/g, "")
    if (term) {
      query = query.or(`title.ilike.%${term}%,reference.ilike.%${term}%`)
    }
  }

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return {
    requests: (data ?? []) as unknown as ServiceRequest[],
    total: count ?? 0,
    page,
    pageSize,
  }
}

export async function getRequest(
  id: string,
): Promise<{ request: ServiceRequest; updates: RequestUpdate[] } | null> {
  const [{ data, error }, updatesResult] = await Promise.all([
    supabase.from("lb_service_requests").select(REQUEST_SELECT).eq("id", id).maybeSingle(),
    supabase
      .from("lb_request_updates")
      .select("*")
      .eq("request_id", id)
      .order("created_at", { ascending: true }),
  ])
  if (error) throw new Error(error.message)
  if (!data) return null
  const updates = (updatesResult.data ?? []) as RequestUpdate[]
  return { request: data as unknown as ServiceRequest, updates }
}

export interface SubmitInput {
  title: string
  description: string
  category_id: string | null
  location: string
  is_custom: boolean
  latitude: number | null
  longitude: number | null
  location_details: Record<string, string>
  barangay_id?: string | null
}

export async function submitRequest(input: SubmitInput, evidencePath: string, preferredAt?: string): Promise<ServiceRequest> {
  const { data, error } = await supabase.rpc(preferredAt ? "app_submit_request_with_field_appointment" : "app_submit_resident_request_with_evidence_v2", {
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_category_id: input.category_id,
    p_location: input.location.trim(),
    p_evidence_path: evidencePath,
    p_is_custom: input.is_custom,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_location_details: input.location_details,
    ...(preferredAt ? { p_preferred_at: preferredAt } : {}),
  })
  if (error) throw new Error(error.message)
  const result = data as { request?: ServiceRequest }
  if (!result?.request) throw new Error("The request was saved, but the server returned no request details.")
  return result.request
}

/** Secretary / front-desk encoding for a walk-in resident (no login by them). */
export async function encodeWalkInRequest(
  profile: Profile,
  input: Pick<SubmitInput, "title" | "description" | "category_id" | "location"> & { submitter_name: string; submitter_contact?: string },
): Promise<ServiceRequest> {
  const { data, error } = await supabase
    .from("lb_service_requests")
    .insert({
      title: input.title.trim(),
      description: input.description.trim(),
      category_id: input.category_id,
      location: input.location.trim(),
      barangay_id: profile.barangay_id,
      submitted_by: null,
      submitter_name: input.submitter_name.trim(),
      submitter_contact: (input.submitter_contact ?? "").trim() || null,
      status: "submitted",
      priority: "normal",
      is_anonymous: false,
    })
    .select(REQUEST_SELECT)
    .single()
  if (error) throw new Error(error.message)
  return data as unknown as ServiceRequest
}

// ---------------------------------------------------------------------------
// Workflow RPCs (server-enforced transition matrix)
// ---------------------------------------------------------------------------

export async function transitionRequest(
  requestId: string,
  newStatus: RequestStatus,
  remarks?: string,
  extra?: Record<string, unknown>,
): Promise<ServiceRequest> {
  const { data, error } = await supabase.rpc("app_transition_request", {
    p_request_id: requestId,
    p_new_status: newStatus,
    p_remarks: remarks ?? null,
    p_extra: extra ?? null,
  })
  if (error) throw new Error(error.message)
  return ((data as { request: ServiceRequest })?.request) ?? ({} as ServiceRequest)
}

export async function addComment(requestId: string, remarks: string): Promise<void> {
  const { error } = await supabase.rpc("app_add_comment", {
    p_request_id: requestId,
    p_remarks: remarks,
  })
  if (error) throw new Error(error.message)
}

export async function replyToInfoRequest(requestId: string, remarks: string): Promise<void> {
  const { error } = await supabase.rpc("app_reply_info_request", {
    p_request_id: requestId,
    p_remarks: remarks,
  })
  if (error) throw new Error(error.message)
}

export async function escalateRequest(requestId: string, remarks?: string): Promise<void> {
  const { error } = await supabase.rpc("app_escalate_request", {
    p_request_id: requestId,
    p_remarks: remarks ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function setRequestPriority(requestId: string, priority: RequestPriority, reason: string): Promise<void> {
  const { error } = await supabase.rpc("app_change_request_priority", {
    p_request_id: requestId,
    p_priority: priority,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
}

export async function assignField(
  requestId: string,
  fieldUserId: string,
  opts: { scheduleAt?: string | null; deadlineAt?: string | null; notes?: string | null } = {},
): Promise<string> {
  const { data, error } = await supabase.rpc("app_assign_field", {
    p_request_id: requestId,
    p_field_user_id: fieldUserId,
    p_schedule_at: opts.scheduleAt ?? null,
    p_deadline_at: opts.deadlineAt ?? null,
    p_notes: opts.notes ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as { assignment_id: string }).assignment_id
}

// Anonymous reporting is retired. Public request tracking remains available
// by reference number, and deliberately exposes status-only information.
export interface AnonymousResult { id: string; reference: string; tracking_code: string }
export interface TrackedRequest {
  found: boolean
  request?: Record<string, unknown>
  updates?: { type: string; previous_status: string | null; new_status: string | null; at: string }[]
}
export async function submitAnonymousReport(..._args: unknown[]): Promise<AnonymousResult> {
  throw new Error("Anonymous reporting is no longer available.")
}
export async function trackRequest(reference: string): Promise<TrackedRequest> {
  const { data, error } = await supabase.rpc("app_track_request", { p_reference: reference.trim() })
  if (error) throw new Error(error.message)
  return data as TrackedRequest
}

// ---------------------------------------------------------------------------
// Attachments (metadata; file bytes live in the private storage bucket)
// ---------------------------------------------------------------------------

export interface AttachmentRow {
  id: string
  request_id: string
  owner_id: string | null
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number | null
  kind: string
  created_at: string
}

export async function listAttachments(requestId: string): Promise<AttachmentRow[]> {
  const { data, error } = await supabase
    .from("lb_attachments")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as AttachmentRow[]
}

export type AttachmentKindInput = "supporting_doc" | "before_photo" | "after_photo" | "reply_doc" | "completion_doc"

export async function uploadStagedRequestEvidence(userId: string, file: File): Promise<string> {
  const maxBytes = 50 * 1024 * 1024
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"])
  if (!allowed.has(file.type)) throw new Error("Choose a JPG, PNG, WebP photo, or MP4/WebM/MOV video.")
  if (!file.size || file.size > maxBytes) throw new Error("Evidence must be under 50 MB.")
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120)
  const path = `staged/${userId}/${crypto.randomUUID()}-${safeName}`
  const { error: uploadError } = await supabase.storage
    .from("request-attachments")
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) throw new Error(uploadError.message)
  const { error } = await supabase.from("lb_attachments").insert({
    request_id: null,
    owner_id: userId,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    kind: "request_evidence",
  })
  if (error) {
    await supabase.storage.from("request-attachments").remove([path])
    throw new Error(error.message)
  }
  return path
}

export async function removeStagedRequestEvidence(path: string, userId: string): Promise<void> {
  await supabase.from("lb_attachments").delete().eq("storage_path", path).eq("owner_id", userId).is("request_id", null)
  await supabase.storage.from("request-attachments").remove([path])
}

export async function uploadAttachment(
  requestId: string,
  userId: string,
  file: File,
  kind: AttachmentKindInput,
) {
  const maxBytes = 10 * 1024 * 1024
  const isImage = file.type.startsWith("image/")
  const isPdf = file.type === "application/pdf"
  if (file.size === 0) throw new Error("The selected file is empty.")
  if (file.size > maxBytes) throw new Error("Files must be 10 MB or smaller.")
  if (!isImage && !(isPdf && kind !== "before_photo" && kind !== "after_photo")) {
    throw new Error(kind === "before_photo" || kind === "after_photo"
      ? "Choose an image file for work photos."
      : "Choose an image or PDF file.")
  }

  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120)
  const path = `${requestId}/${userId}/${Date.now()}-${safeName}`
  const { error: uploadError } = await supabase.storage
    .from("request-attachments")
    .upload(path, file, { contentType: file.type || "application/octet-stream" })
  if (uploadError) throw new Error(uploadError.message)

  const { error } = await supabase.from("lb_attachments").insert({
    request_id: requestId,
    owner_id: userId,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type || "",
    size_bytes: file.size,
    kind,
  })
  if (error) {
    await supabase.storage.from("request-attachments").remove([path])
    throw new Error(error.message)
  }
}

export async function getAttachmentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("request-attachments")
    .createSignedUrl(storagePath, 600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}
