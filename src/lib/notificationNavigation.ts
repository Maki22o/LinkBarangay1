import { canAccessView, hasPermission } from "../permissions/permissions.ts"
import type { Notification, Profile, ViewId } from "../types/index.ts"

export function notificationBadge(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null
  return unread > 99 ? "99+" : String(unread)
}

export type NotificationDestination = {
  view: ViewId
  entityId: string | null
  record: "request" | "assignment" | "appointment" | null
  inline?: boolean
}

// Persisted destinations are data, never executable URLs or unrestricted routes.
const MODULE_DESTINATIONS = new Set<ViewId>([
  "users", "configuration", "barangays", "departments", "categories", "routing", "sla-settings",
  "jobs", "assignments",
])

export function notificationDestination(
  item: Pick<Notification, "request_id" | "destination_view" | "entity_id">,
  profile: Profile | null,
): NotificationDestination | null {
  if (!profile || profile.status !== "active") return null
  const view = item.destination_view ?? (item.request_id ? "request-detail" : null)
  const entityId = item.entity_id ?? item.request_id
  if (view === "request-detail" && entityId) {
    return { view, entityId, record: "request" }
  }
  if (view === "job-detail" && item.entity_id && profile.worker_function === "field" &&
      hasPermission(profile, "requests.update_progress")) {
    return { view, entityId: item.entity_id, record: "assignment" }
  }
  if (view === "appointments" && item.entity_id) {
    if (profile.role === "resident") {
      // Residents can inspect their own appointment within the inbox. This does
      // not grant access to the secretary's scheduling module or its controls.
      return { view: "notifications", entityId: item.entity_id, record: "appointment", inline: true }
    }
    if (canAccessView(profile, view)) return { view, entityId: item.entity_id, record: "appointment" }
  }
  if (view === "profile" && (!item.entity_id || item.entity_id === profile.id)) {
    return { view, entityId: profile.id, record: null }
  }
  if (view && MODULE_DESTINATIONS.has(view as ViewId) && canAccessView(profile, view as ViewId)) {
    return { view: view as ViewId, entityId: item.entity_id ?? null, record: null }
  }
  return null
}
