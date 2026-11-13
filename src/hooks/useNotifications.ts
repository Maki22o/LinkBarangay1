// ============================================================================
// LinkBarangay — notifications hook (real rows from Supabase, realtime +
// polling fallback for the unread badge)
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react"
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
} from "@/services/notificationService"
import { useAuth } from "@/hooks/useAuth"
import type { Notification } from "@/types"

export function useNotifications() {
  const { profile } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const userId = profile?.id ?? null
  const userIdRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!userIdRef.current) return
    try {
      const [items, unread] = await Promise.all([
        listNotifications(userIdRef.current),
        getUnreadCount(userIdRef.current),
      ])
      setNotifications(items)
      setUnreadCount(unread)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.")
    }
  }, [])

  useEffect(() => {
    userIdRef.current = userId
    if (!userId) {
      setNotifications([])
      setUnreadCount(0)
      setLoading(false)
      return
    }

    setLoading(true)
    void refresh().finally(() => setLoading(false))

    // Realtime updates when the project has realtime enabled…
    const unsubscribe = subscribeToNotifications(userId, () => {
      void refresh()
    })
    // …plus a polling fallback (also covers token refresh edge cases)
    const timer = window.setInterval(refresh, 30_000)

    return () => {
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [userId, refresh])

  const markRead = useCallback(
    async (id: string) => {
      if (!userIdRef.current) return
      await markNotificationRead(id, userIdRef.current)
      void refresh()
    },
    [refresh],
  )

  const markAllRead = useCallback(async () => {
    if (!userIdRef.current) return
    await markAllNotificationsRead(userIdRef.current)
    void refresh()
  }, [refresh])

  return { notifications, unreadCount, loading, error, refresh, markRead, markAllRead }
}
