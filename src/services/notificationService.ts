// Persisted notification access. Creation belongs to database workflow triggers.
import { supabase } from "@/lib/supabase"
import type { Notification } from "@/types"

export interface NotificationCursor {
  created_at: string
  id: string
}

let sequence = 0

function databaseError(error: { message: string; code?: string }): Error {
  if (error.code === "PGRST202" || error.code === "42883") {
    return new Error("Notification read controls require database migration 0015. Please contact the administrator.")
  }
  return new Error(error.message)
}

/** Stable keyset order also handles notifications with identical timestamps. */
export async function listNotifications(
  userId: string,
  limit = 51,
  cursor?: NotificationCursor,
): Promise<Notification[]> {
  let query = supabase
    .from("lb_notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.min(101, Math.max(1, limit)))
  if (cursor) {
    // Both values originate from database rows, but validate before constructing
    // the PostgREST filter to keep this boundary safe for future callers.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.created_at) ||
      !Number.isFinite(Date.parse(cursor.created_at))) {
      throw new Error("Invalid notification history cursor. Refresh and try again.")
    }
    // Preserve PostgreSQL microseconds; Date.toISOString() truncates them and
    // would skip rows around page boundaries.
    const timestamp = cursor.created_at
    query = query.or(`created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) throw databaseError(error)
  return (data ?? []) as Notification[]
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("lb_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false)
  if (error) throw databaseError(error)
  return count ?? 0
}

export async function markNotificationsRead(userId: string, id: string | null): Promise<number> {
  // Ownership is derived from auth.uid() by the RPC, never from caller input.
  // userId is retained in this interface so each store operation is explicitly
  // tied to one account; the store discards responses after account changes.
  if (!userId) throw new Error("Please sign in to update notifications.")
  const { data, error } = await supabase.rpc("app_mark_notifications_read", {
    p_notification_id: id,
    p_expected_user_id: userId,
  })
  if (error) throw databaseError(error)
  return Number(data ?? 0)
}

export function markNotificationRead(id: string, userId: string): Promise<number> {
  return markNotificationsRead(userId, id)
}

export function markAllNotificationsRead(userId: string): Promise<number> {
  return markNotificationsRead(userId, null)
}

export type NotificationConnection = "connected" | "reconnecting"

/** One channel per provider/account; UPDATE events synchronize read state. */
export function subscribeToNotifications(
  userId: string,
  onChange: () => void,
  onConnection?: (status: NotificationConnection) => void,
): () => void {
  let closed = false
  const channel = supabase
    .channel(`lb_notifications_${userId}_${++sequence}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "lb_notifications",
      filter: `user_id=eq.${userId}`,
    }, () => { if (!closed) onChange() })
    .subscribe((status) => {
      if (closed) return
      if (status === "SUBSCRIBED") onConnection?.("connected")
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        onConnection?.("reconnecting")
      }
    })

  return () => {
    closed = true
    void supabase.removeChannel(channel).catch((error: unknown) => {
      console.error("Could not close notification channel", error)
    })
  }
}
