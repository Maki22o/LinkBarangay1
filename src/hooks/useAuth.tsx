// ============================================================================
// LinkBarangay — authentication context
//
// The single source of truth for "who is signed in". The user's role comes
// exclusively from their lb_profiles row in Supabase; there is no client-side
// role selection anywhere in the app.
// ============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true)
  const [session, setSession] = useState<SupabaseSession>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
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
    const loaded = await fetchProfile(userId)
    if (!loaded) {
      setProfile(null)
      setSessionNotice("Your account has no profile yet. Please contact the barangay office.")
      return
    }
    if (loaded.status !== "active") {
      setProfile(null)
      await authSignOut()
      setSessionNotice(
        loaded.status === "suspended"
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

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return
        const current = data.session ?? null
        setSession(current ? { user: { id: current.user.id, email: current.user.email } } : null)
        if (current) {
          await loadProfile(current.user.id)
        }
        setInitializing(false)
      })
      .catch(() => {
        if (!cancelled) setInitializing(false)
      })

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) return
      setSession(
        nextSession ? { user: { id: nextSession.user.id, email: nextSession.user.email } } : null,
      )
      if (event === "SIGNED_OUT") {
        setProfile(null)
        setSession(null)
      } else if (
        nextSession &&
        (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "PASSWORD_RECOVERY")
      ) {
        void loadProfile(nextSession.user.id)
      }
    })

    return () => {
      cancelled = true
      subscription.subscription?.unsubscribe()
    }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await authSignOut()
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
