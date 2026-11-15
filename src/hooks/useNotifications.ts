// One shared store, channel and fallback timer for the authenticated account.
import { createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { useAuth } from "@/hooks/useAuth"
import {
  getUnreadCount, listNotifications, markNotificationsRead, subscribeToNotifications,
} from "@/services/notificationService"
import { NotificationStore } from "@/lib/notificationStore"
import { startNotificationSync } from "@/lib/notificationSync"
import type { NotificationState } from "@/lib/notificationStore"

type NotificationContextValue = NotificationState & {
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  // The session/profile match prevents briefly exposing the previous user's
  // history while authentication is loading a newly signed-in account.
  const userId = profile?.status === "active" && session?.user.id === profile.id ? profile.id : null
  const store = useMemo(() => new NotificationStore(userId, {
    list: listNotifications, count: getUnreadCount, markRead: markNotificationsRead,
  }), [userId])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    store.start()
    if (!userId) return () => store.stop()
    const cleanupSync = startNotificationSync({
      refresh: store.refresh,
      subscribe: (onChange, onConnection) => subscribeToNotifications(
        userId, onChange, (status) => onConnection(status === "connected"),
      ),
      environment: {
        now: Date.now,
        visible: () => document.visibilityState === "visible",
        online: () => navigator.onLine,
        delay: (milliseconds, callback) => {
          const timer = window.setTimeout(callback, milliseconds)
          return () => window.clearTimeout(timer)
        },
        repeat: (milliseconds, callback) => {
          const timer = window.setInterval(callback, milliseconds)
          return () => window.clearInterval(timer)
        },
        listen: (event, callback) => {
          const target = event === "visibility" ? document : window
          const name = event === "visibility" ? "visibilitychange" : event
          target.addEventListener(name, callback)
          return () => target.removeEventListener(name, callback)
        },
      },
    })
    return () => {
      store.stop()
      cleanupSync()
    }
  }, [store, userId])

  const value = useMemo(() => ({ ...state,
    refresh: store.refresh, loadMore: store.loadMore,
    markRead: store.markRead, markAllRead: store.markAllRead,
  }), [state, store])
  return createElement(NotificationContext.Provider, { value }, children)
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext)
  if (!context) throw new Error("useNotifications must be used inside <NotificationsProvider>")
  return context
}
