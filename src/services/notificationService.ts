// ============================================================================
// LinkBarangay — notification service
// ============================================================================

import { supabase } from "@/lib/supabase"
import type { Notification } from "@/types"

let notificationSubscriptionSequence = 0

export async function listNotifications(userId: string, limit = 50): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("lb_notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as Notification[]
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("lb_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("lb_notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("is_read", false)
  if (error) throw new Error(error.message)
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("lb_notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("is_read", false)
  if (error) throw new Error(error.message)
}

/** Realtime subscription to the caller's own notifications. */
export function subscribeToNotifications(
  userId: string,
  onInsert: (notification: Notification) => void,
): () => void {
  const channel = supabase
    // AppShell and NotificationsPage each use the notifications hook. Give
    // each listener its own channel so a second hook never tries to register
    // postgres_changes handlers on an already-subscribed channel.
    .channel(`lb_notifications_${userId}_${++notificationSubscriptionSequence}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "lb_notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onInsert(payload.new as Notification),
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
