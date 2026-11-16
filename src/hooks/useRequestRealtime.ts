import { useEffect, useRef } from "react"
import { supabase } from "@/lib/supabase"

let subscriptionSequence = 0

/** Refresh a scoped request view after a visible database change or reconnect. */
export function useRequestRealtimeRefresh(
  onChange: () => void,
  options: { enabled?: boolean; filter?: string; table?: "lb_service_requests" | "lb_assignments" | "lb_appointments" } = {},
) {
  const callback = useRef(onChange)
  callback.current = onChange
  const enabled = options.enabled ?? true
  const filter = options.filter
  const table = options.table ?? "lb_service_requests"

  useEffect(() => {
    if (!enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        if (active) callback.current()
      }, 180)
    }
    const channel = supabase
      .channel(`lb_request_sync_${++subscriptionSequence}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table,
        ...(filter ? { filter } : {}),
      }, refresh)
      .subscribe((status) => {
        // Catch up after initial subscribe and every successful reconnect.
        if (status === "SUBSCRIBED") refresh()
      })
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)

    return () => {
      active = false
      if (timer) clearTimeout(timer)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("online", refresh)
      void supabase.removeChannel(channel)
    }
  }, [enabled, filter, table])
}
