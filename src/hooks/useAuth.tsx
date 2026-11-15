// ============================================================================
// LinkBarangay — authentication context
//
// The single source of truth for "who is signed in". The user's role comes
// exclusively from their lb_profiles row in Supabase; there is no client-side
// role selection anywhere in the app.
// ============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { fetchProfile } from "@/services/profileService"
import { signOut as authSignOut } from "@/services/authService"
import type { Profile } from "@/types"

interface AuthContextValue {
  /** True until the initial session check finishes. */
  initializing: boolean
  session: { user: { id: string; email?: string | null } } | null
  profile: Profile | null
  /** Message explaining why a session was terminated (e.g. suspended). */
  sessionNotice: string | null
  authLinkFlow: "invite" | "recovery" | null
  authLinkError: string | null
  clearAuthLink: () => void
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

type SupabaseSession = { user: { id: string; email?: string | null } } | null
let ownProfileSubscription = 0

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true)
  const [session, setSession] = useState<SupabaseSession>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const currentUser = useRef<string | null>(null)
  const profileRequest = useRef(0)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [authLinkFlow, setAuthLinkFlow] = useState<"invite" | "recovery" | null>(() => {
    const type = new URLSearchParams(window.location.hash.slice(1)).get("type")
    return type === "invite" || type === "recovery" ? type : null
  })
  const [authLinkError, setAuthLinkError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const description = params.get("error_description")
    return description ? description.replaceAll("+", " ") : null
  })

  const clearAuthLink = useCallback(() => {
    setAuthLinkFlow(null)
    setAuthLinkError(null)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`)
  }, [])

  const loadProfile = useCallback(async (userId: string) => {
    const request = ++profileRequest.current
    let loaded: Profile | null
    try {
      loaded = await fetchProfile(userId)
    } catch (err) {
      if (request === profileRequest.current && currentUser.current === userId) {
        setSessionNotice(err instanceof Error ? err.message : "Could not load your account. Please try again.")
      }
      return
    }
    if (request !== profileRequest.current || currentUser.current !== userId) return
    if (!loaded) {
      setProfile(null)
      setSessionNotice("Your account has no profile yet. Please contact the barangay office.")
      return
    }
    if (loaded.status !== "active") {
      setProfile(null)
      await authSignOut()
      if (currentUser.current && currentUser.current !== userId) return
      setSessionNotice(
        loaded.status === "pending"
          ? "Your worker account is waiting for administrator approval."
          : loaded.status === "suspended"
            ? "This account has been suspended. Please contact the barangay office."
            : "This account is inactive. Please contact the barangay office.",
      )
      return
    }
    setProfile(loaded)
    setSessionNotice(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    let observedAuthEvent = false
    const pending = new Set<ReturnType<typeof setTimeout>>()
    const acceptSession = (next: SupabaseSession) => {
      const id = next?.user.id ?? null
      if (id !== currentUser.current) {
        ++profileRequest.current
        setProfile(null)
      }
      currentUser.current = id
      setSession(next)
    }
    const reportProfileError = (err: unknown) => {
      if (!cancelled) setSessionNotice(err instanceof Error ? err.message : "Could not load your account.")
    }

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled || observedAuthEvent) return
        const current = data.session ?? null
        acceptSession(current ? { user: { id: current.user.id, email: current.user.email } } : null)
        if (current) {
          await loadProfile(current.user.id)
        }
        if (!cancelled) setInitializing(false)
      })
      .catch((err) => {
        if (!cancelled) { reportProfileError(err); setInitializing(false) }
      })

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) return
      observedAuthEvent = true
      acceptSession(
        nextSession ? { user: { id: nextSession.user.id, email: nextSession.user.email } } : null,
      )
      if (event === "SIGNED_OUT") {
        setProfile(null)
        setSession(null)
      } else if (
        nextSession &&
        (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED" || event === "PASSWORD_RECOVERY")
      ) {
        // Leave Supabase's auth callback before starting another authenticated query.
        const timer = setTimeout(() => {
          pending.delete(timer)
          if (!cancelled && currentUser.current === nextSession.user.id) {
            void loadProfile(nextSession.user.id).catch(reportProfileError).finally(() => {
              if (!cancelled) setInitializing(false)
            })
          }
        }, 0)
        pending.add(timer)
      } else if (!nextSession) {
        setInitializing(false)
      }
    })

    return () => {
      cancelled = true
      currentUser.current = null
      ++profileRequest.current
      pending.forEach(clearTimeout)
      subscription.subscription?.unsubscribe()
    }
  }, [loadProfile])

  // Keep role/status changes used by notification destinations current. RLS
  // remains authoritative even while this refresh is in flight.
  useEffect(() => {
    const id = session?.user.id
    if (!id) return
    let active = true
    const refresh = () => {
      if (!active || currentUser.current !== id) return
      void loadProfile(id).catch((err: unknown) => {
        if (active) setSessionNotice(err instanceof Error ? err.message : "Could not refresh your account.")
      })
    }
    const channel = supabase.channel(`lb_own_profile_${id}_${++ownProfileSubscription}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lb_profiles", filter: `id=eq.${id}` }, refresh)
      .subscribe()
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    return () => {
      active = false
      window.removeEventListener("focus", refresh)
      window.removeEventListener("online", refresh)
      void supabase.removeChannel(channel).catch((err: unknown) => console.error("Profile subscription cleanup failed", err))
    }
  }, [session?.user.id, loadProfile])

  const signOut = useCallback(async () => {
    await authSignOut()
    currentUser.current = null
    ++profileRequest.current
    setProfile(null)
    setSession(null)
    setSessionNotice(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id)
  }, [session, loadProfile])

  const value = useMemo(
    () => ({ initializing, session, profile, sessionNotice, authLinkFlow, authLinkError, clearAuthLink, signOut, refreshProfile }),
    [initializing, session, profile, sessionNotice, authLinkFlow, authLinkError, clearAuthLink, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
