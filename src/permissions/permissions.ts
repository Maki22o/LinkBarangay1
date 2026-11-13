// ============================================================================
// LinkBarangay — centralized, typed permission system (deny-by-default).
//
// The frontend uses this to render the right navigation and buttons for the
// authenticated profile. It is UX only: every rule here is enforced
// independently by RLS policies and SECURITY DEFINER RPCs (see
// supabase/migrations/0004_rls_policies_workflow.sql).
// ============================================================================

import type { Permission, Profile, Role, ViewId, WorkerFunction } from "@/types"

const RESIDENT_PERMISSIONS: Permission[] = [
  "requests.create", "requests.view_own", "requests.comment", "requests.close_own",
]
const ADMIN_PERMISSIONS: Permission[] = [
  "requests.create", "requests.view_own", "requests.view_barangay", "requests.view_department",
  "requests.verify", "requests.reject", "requests.route", "requests.assign", "requests.resolve",
  "requests.comment", "requests.escalate", "intake.encode", "intake.verify_documents",
  "intake.appointments", "intake.resident_records", "personnel.view", "users.view", "users.create",
  "users.update", "users.suspend", "roles.manage", "reports.view", "audit.view", "configuration.manage",
]
const WORKER_PERMISSIONS: Record<WorkerFunction, Permission[]> = {
  secretary: ["requests.view_barangay", "requests.create", "requests.comment", "intake.encode", "intake.verify_documents", "intake.appointments", "intake.resident_records", "personnel.view"],
  officer: ["requests.view_barangay", "requests.create", "requests.verify", "requests.reject", "requests.route", "requests.comment", "requests.escalate", "intake.verify_documents", "intake.resident_records", "personnel.view", "reports.view"],
  captain: ["requests.view_barangay", "requests.verify", "requests.reject", "requests.resolve", "requests.comment", "requests.escalate", "intake.resident_records", "personnel.view", "reports.view"],
  dispatcher: ["requests.view_department", "requests.route", "requests.assign", "requests.comment", "requests.escalate", "personnel.view", "reports.view"],
  field: ["requests.view_own", "requests.update_progress", "requests.comment"],
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  resident: RESIDENT_PERMISSIONS,
  // Aggregate display only; live permission checks use worker_function below.
  worker: [...new Set(Object.values(WORKER_PERMISSIONS).flat())],
  admin: ADMIN_PERMISSIONS,
}

// Worker functions retain least-privilege access beneath the three account roles.

/** Frontend permission check. Denies anything unknown or inactive. */
export function hasPermission(
  profile: Pick<Profile, "role" | "status" | "worker_function"> | null | undefined,
  permission: Permission,
): boolean {
  if (!profile || profile.status !== "active") return false
  if (profile.role === "worker") {
    return profile.worker_function
      ? WORKER_PERMISSIONS[profile.worker_function]?.includes(permission) ?? false
      : false
  }
  return ROLE_PERMISSIONS[profile.role]?.includes(permission) ?? false
}

// ---------------------------------------------------------------------------
// Views → required permission. Views with null are available to every active
// authenticated user; actual row access is always enforced by RLS.
// ---------------------------------------------------------------------------
export const VIEW_PERMISSIONS: Partial<Record<ViewId, Permission>> = {
  submit: "requests.create",
  "walk-in": "intake.encode",
  intake: "requests.view_barangay",
  verification: "intake.verify_documents",
  appointments: "intake.appointments",
  residents: "intake.resident_records",
  "verify-queue": "requests.verify",
  escalated: "requests.escalate",
  approvals: "requests.resolve",
  "personnel-monitor": "personnel.view",
  "barangay-reports": "reports.view",
  "dept-queue": "requests.view_department",
  assignments: "requests.assign",
  personnel: "personnel.view",
  workload: "personnel.view",
  "sla-monitor": "requests.view_department",
  jobs: "requests.update_progress",
  users: "users.view",
  roles: "roles.manage",
  configuration: "configuration.manage",
  barangays: "configuration.manage",
  departments: "configuration.manage",
  categories: "configuration.manage",
  routing: "configuration.manage",
  "sla-settings": "configuration.manage",
  reports: "reports.view",
  audit: "audit.view",
}

export function canAccessView(
  profile: Pick<Profile, "role" | "status" | "worker_function"> | null | undefined,
  view: ViewId,
): boolean {
  const required = VIEW_PERMISSIONS[view]
  if (!required) return Boolean(profile && profile.status === "active")
  return hasPermission(profile, required)
}

// ---------------------------------------------------------------------------
// Per-role navigation. Only menus the role is authorized for are rendered.
// ---------------------------------------------------------------------------
export type IconName =
  | "home" | "plus" | "file" | "bell" | "user" | "search" | "arrow" | "check" | "clock"
  | "pin" | "upload" | "chevron" | "menu" | "logout" | "shield" | "route" | "briefcase"
  | "users" | "settings" | "chart" | "history" | "alert" | "close" | "eye" | "filter"
  | "phone" | "help"

export interface NavItem {
  label: string
  icon: IconName
  view: ViewId
}

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  resident: [
    { label: "Home", icon: "home", view: "dashboard" },
    { label: "Submit a Request", icon: "plus", view: "submit" },
    { label: "My Requests", icon: "file", view: "requests" },
    { label: "Notifications", icon: "bell", view: "notifications" },
    { label: "My Profile", icon: "user", view: "profile" },
  ],
  worker: [],
  admin: [
    { label: "System Overview", icon: "home", view: "dashboard" },
    { label: "User Management", icon: "users", view: "users" },
    { label: "Roles & Permissions", icon: "shield", view: "roles" },
    { label: "Configuration", icon: "settings", view: "configuration" },
    { label: "Reports & Analytics", icon: "chart", view: "reports" },
    { label: "Audit Logs", icon: "history", view: "audit" },
    { label: "Notifications", icon: "bell", view: "notifications" },
  ],
}

export const NAV_BY_WORKER_FUNCTION: Record<WorkerFunction, NavItem[]> = {
  secretary: [
    { label: "Secretary Dashboard", icon: "home", view: "dashboard" },
    { label: "Walk-in Encoding", icon: "plus", view: "walk-in" },
    { label: "Incoming Requests", icon: "file", view: "intake" },
    { label: "Document Verification", icon: "shield", view: "verification" },
    { label: "Appointments", icon: "clock", view: "appointments" },
    { label: "Resident Records", icon: "users", view: "residents" },
    { label: "Notifications", icon: "bell", view: "notifications" },
    { label: "My Profile", icon: "user", view: "profile" },
  ],
  officer: [
    { label: "Officer Dashboard", icon: "home", view: "dashboard" },
    { label: "Verification Queue", icon: "shield", view: "verify-queue" },
    { label: "Barangay Requests", icon: "file", view: "requests" },
    { label: "Escalated Requests", icon: "alert", view: "escalated" },
    { label: "Notifications", icon: "bell", view: "notifications" },
    { label: "My Profile", icon: "user", view: "profile" },
  ],
  captain: [
    { label: "Supervisor Dashboard", icon: "home", view: "dashboard" },
    { label: "Approval Queue", icon: "check", view: "approvals" },
    { label: "Escalated Concerns", icon: "alert", view: "escalated" },
    { label: "Barangay Requests", icon: "file", view: "requests" },
    { label: "Personnel Monitoring", icon: "briefcase", view: "personnel-monitor" },
    { label: "Barangay Reports", icon: "chart", view: "barangay-reports" },
    { label: "Notifications", icon: "bell", view: "notifications" },
    { label: "My Profile", icon: "user", view: "profile" },
  ],
  dispatcher: [
    { label: "Operations Dashboard", icon: "home", view: "dashboard" },
    { label: "Department Queue", icon: "route", view: "dept-queue" },
    { label: "Assignments", icon: "briefcase", view: "assignments" },
    { label: "All Department Requests", icon: "file", view: "requests" },
    { label: "Personnel", icon: "users", view: "personnel" },
    { label: "Workload & SLA", icon: "clock", view: "workload" },
    { label: "Notifications", icon: "bell", view: "notifications" },
  ],
  field: [
    { label: "My Day", icon: "home", view: "dashboard" },
    { label: "Assigned Jobs", icon: "briefcase", view: "jobs" },
    { label: "Notifications", icon: "bell", view: "notifications" },
    { label: "My Profile", icon: "user", view: "profile" },
  ],
}

export function navForProfile(profile: Pick<Profile, "role" | "worker_function">): NavItem[] {
  return profile.role === "worker" && profile.worker_function
    ? NAV_BY_WORKER_FUNCTION[profile.worker_function]
    : NAV_BY_ROLE[profile.role]
}

export function scopeLabelFor(role: Role): string {
  if (role === "resident") return "RESIDENT PORTAL"
  if (role === "admin") return "ADMINISTRATION"
  return "OPERATIONS PORTAL"
}
