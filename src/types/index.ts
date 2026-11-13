// ============================================================================
// LinkBarangay — shared domain types
// Mirrors the database schema created by supabase/migrations/.
// ============================================================================

export type Role = "resident" | "worker" | "admin"
export type WorkerFunction = "secretary" | "officer" | "captain" | "dispatcher" | "field"

export type AccountStatus = "active" | "suspended" | "inactive" | "pending"

export const ROLE_LABELS: Record<Role, string> = {
  resident: "Resident",
  worker: "Worker",
  admin: "System Administrator",
}

export const WORKER_FUNCTION_LABELS: Record<WorkerFunction, string> = {
  secretary: "Front desk",
  officer: "Barangay officer",
  captain: "Supervisor",
  dispatcher: "Dispatcher",
  field: "Field personnel",
}

export function profileRoleLabel(profile: Pick<Profile, "role" | "worker_function">): string {
  if (profile.role !== "worker") return ROLE_LABELS[profile.role]
  return profile.worker_function
    ? `Worker · ${WORKER_FUNCTION_LABELS[profile.worker_function]}`
    : "Worker"
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
  submitted: "Submitted",
  for_verification: "For Verification",
  needs_information: "Needs Information",
  verified: "Verified",
  assigned: "Assigned",
  in_progress: "In Progress",
  for_inspection: "For Inspection",
  resolved: "Resolved",
  closed: "Closed",
  rejected: "Rejected",
}

export const PRIORITY_LABELS: Record<RequestPriority, string> = {
  low: "Low",
  normal: "Normal",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
}

export type RequestStatus =
  | "submitted"
  | "for_verification"
  | "needs_information"
  | "verified"
  | "assigned"
  | "in_progress"
  | "for_inspection"
  | "resolved"
  | "closed"
  | "rejected"

export type RequestPriority = "low" | "normal" | "medium" | "high" | "urgent"

export type Permission =
  // Requests
  | "requests.create"
  | "requests.view_own"
  | "requests.view_barangay"
  | "requests.view_department"
  | "requests.verify"
  | "requests.reject"
  | "requests.route"
  | "requests.assign"
  | "requests.update_progress"
  | "requests.resolve"
  | "requests.comment"
  | "requests.escalate"
  | "requests.close_own"
  // Secretary intake
  | "intake.encode"
  | "intake.verify_documents"
  | "intake.appointments"
  | "intake.resident_records"
  // Personnel
  | "personnel.view"
  // Administration
  | "users.view"
  | "users.create"
  | "users.update"
  | "users.suspend"
  | "roles.manage"
  | "reports.view"
  | "audit.view"
  | "configuration.manage"

export interface Profile {
  id: string
  full_name: string
  email: string
  mobile: string
  address: string
  role: Role
  worker_function: WorkerFunction | null
  status: AccountStatus
  barangay_id: string | null
  department_id: string | null
  created_at: string
  updated_at?: string | null
  barangay?: { id: string; name: string } | null
  department?: { id: string; name: string } | null
}

export interface ServiceRequest {
  id: string
  reference: string | null
  tracking_code?: string | null
  title: string
  description: string
  category_id: string | null
  barangay_id: string | null
  department_id: string | null
  status: RequestStatus
  priority: RequestPriority
  is_anonymous: boolean
  submitter_name: string | null
  submitter_contact: string | null
  location: string
  submitted_by: string | null
  assigned_to: string | null
  assigned_by: string | null
  due_at: string | null
  needs_info_by: string | null
  needs_info_message: string
  rejection_reason: string
  resolved_at: string | null
  closed_at: string | null
  reopened_count: number
  escalation_count: number
  created_at: string
  updated_at: string
  category?: { id: string; name: string; slug: string; sla_hours: number } | null
  barangay?: { id: string; name: string } | null
  department?: { id: string; name: string } | null
  submitter?: Pick<Profile, "id" | "full_name" | "email" | "mobile" | "address"> | null
  assignee?: Pick<Profile, "id" | "full_name"> | null
}

export interface RequestUpdate {
  id: string
  request_id: string
  actor_id: string | null
  actor_name: string
  type: string
  previous_status: string | null
  new_status: string | null
  remarks: string
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  title: string
  message: string
  request_id: string | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

export type AssignmentStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "in_progress"
  | "completed"
  | "verified"

export interface Assignment {
  id: string
  request_id: string
  assigned_to: string
  assigned_by: string | null
  department_id: string | null
  status: AssignmentStatus
  decline_reason: string
  schedule_at: string | null
  deadline_at: string | null
  accepted_at: string | null
  completed_at: string | null
  notes: string
  created_at: string
  updated_at: string
  request?: ServiceRequest | null
  assignee?: { id: string; full_name: string } | null
}

export interface Barangay {
  id: string
  name: string
  code: string
  city: string
  is_active: boolean
}

export interface Department {
  id: string
  name: string
  code: string
  description: string
  is_active: boolean
}

export interface ServiceCategory {
  id: string
  name: string
  slug: string
  description: string
  department_id: string | null
  required_documents: string[]
  sla_hours: number
  is_active: boolean
  department?: { id: string; name: string } | null
}

export interface Appointment {
  id: string
  barangay_id: string | null
  resident_id: string | null
  request_id: string | null
  scheduled_at: string
  purpose: string
  status: "scheduled" | "completed" | "cancelled" | "no_show"
  created_by: string | null
  notes: string
  created_at: string
  resident?: { id: string; full_name: string } | null
}

export interface AuditLog {
  id: string
  actor_id: string | null
  actor_name: string
  action: string
  entity_type: string
  entity_id: string
  details: Record<string, unknown>
  created_at: string
}

export type AttachmentKind =
  | "supporting_doc"
  | "before_photo"
  | "after_photo"
  | "reply_doc"
  | "completion_doc"

export interface Attachment {
  id: string
  request_id: string
  owner_id: string | null
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number | null
  kind: AttachmentKind
  created_at: string
}

export interface SlaSettings {
  verification_hours: number
  routing_hours: number
  resolution_days: number
  reopen_days: number
}

export interface RoutingSettings {
  mode: string
  default_department?: string
}

export interface AppSettings {
  sla?: SlaSettings
  routing?: RoutingSettings
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type ViewId =
  // Public (unauthenticated)
  | "landing"
  | "login"
  | "register"
  | "anonymous"
  | "track"
  // Authenticated
  | "dashboard"
  | "requests"
  | "request-detail"
  | "submit"
  | "notifications"
  | "profile"
  | "walk-in"
  | "intake"
  | "verification"
  | "appointments"
  | "residents"
  | "verify-queue"
  | "escalated"
  | "approvals"
  | "personnel-monitor"
  | "barangay-reports"
  | "dept-queue"
  | "assignments"
  | "personnel"
  | "workload"
  | "sla-monitor"
  | "jobs"
  | "job-detail"
  | "users"
  | "roles"
  | "configuration"
  | "barangays"
  | "departments"
  | "categories"
  | "routing"
  | "sla-settings"
  | "reports"
  | "audit"
  | "unauthorized"