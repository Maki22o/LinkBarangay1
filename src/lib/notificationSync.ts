/** Browser/channel coordination is separate from state so lifecycle behavior is testable. */
export interface NotificationSyncEnvironment {
  now: () => number
  visible: () => boolean
  online: () => boolean
  delay: (milliseconds: number, callback: () => void) => () => void
  repeat: (milliseconds: number, callback: () => void) => () => void
  listen: (event: "focus" | "online" | "visibility", callback: () => void) => () => void
}

export function startNotificationSync({
  refresh,
  subscribe,
  environment,
}: {
  refresh: () => Promise<void>
  subscribe: (onChange: () => void, onConnection: (connected: boolean) => void) => () => void
  environment: NotificationSyncEnvironment
}): () => void {
  let active = true
  let connected = false
  let cancelRefresh: (() => void) | null = null
  let lastRefresh = environment.now()
  const scheduleRefresh = () => {
    if (!active || cancelRefresh) return
    // A transaction may insert multiple relevant events. Reconcile once after
    // the burst, then let the store catch up again if another event arrives.
    cancelRefresh = environment.delay(200, () => {
      cancelRefresh = null
      if (!active) return
      lastRefresh = environment.now()
      void refresh()
    })
  }
  const foregroundRefresh = () => {
    if (environment.visible() && environment.online()) scheduleRefresh()
  }
  const unsubscribe = subscribe(scheduleRefresh, (isConnected) => {
    if (!active) return
    connected = isConnected
    if (connected) scheduleRefresh() // catches missed events after reconnection
  })
  const cancelPoll = environment.repeat(30_000, () => {
    if (!active || !environment.online() || !environment.visible()) return
    // Realtime is primary. Keep a quiet reconciliation while healthy and a
    // 30-second fallback if the connection cannot currently be established.
    if (environment.now() - lastRefresh >= (connected ? 120_000 : 30_000)) scheduleRefresh()
  })
  const removeListeners = [
    environment.listen("focus", foregroundRefresh),
    environment.listen("online", foregroundRefresh),
    environment.listen("visibility", foregroundRefresh),
  ]
  return () => {
    active = false
    unsubscribe()
    cancelPoll()
    cancelRefresh?.()
    removeListeners.forEach((remove) => remove())
  }
}
