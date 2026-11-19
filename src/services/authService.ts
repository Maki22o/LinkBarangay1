// ============================================================================
// LinkBarangay — Supabase Auth service
// ============================================================================

import { supabase } from "@/lib/supabase"

export interface SignUpInput {
  fullName: string
  email: string
  password: string
  mobile: string
  address: string
  barangayId?: string
  /** "worker" creates a pending account that an administrator must approve. */
  accountType?: "resident" | "worker"
}

/** Client-side baseline. Also set the same minimum in Supabase Auth settings
 * so direct API calls cannot bypass this UI validation. */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters."
  if (/\s/.test(password)) return "Do not use spaces in your password."
  return null
}

/** Maps raw Supabase auth errors to resident-friendly messages. */
export function mapAuthError(error: { message?: string } | null | undefined): string {
  const raw = (error?.message ?? "").toLowerCase()
  if (raw.includes("invalid login credentials")) return "Incorrect email or password."
  if (raw.includes("email not confirmed")) return "Please confirm your email address before signing in."
  if (raw.includes("user already registered") || raw.includes("already been registered"))
    return "An account with this email already exists."
  if (raw.includes("lb_profiles_mobile") || raw.includes("mobile_normalized") || raw.includes("duplicate key"))
    return "This contact number is already in use."
  if (raw.includes("password") && (raw.includes("at least") || raw.includes("weak")))
    return "Password is too weak — use at least 8 characters with letters and numbers."
  if (raw.includes("rate limit") || raw.includes("too many"))
    return "Too many attempts — please wait a moment and try again."
  if (raw.includes("signup requires a valid password")) return "Please enter a valid password (at least 8 characters)."
  if (raw.includes("unable to validate email")) return "Please enter a valid email address."
  if (raw.includes("failed to fetch") || raw.includes("network") || raw.includes("fetch"))
    return "Cannot reach the server. Check your internet connection or the Supabase configuration in .env.local."
  return error?.message || "Something went wrong. Please try again."
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) throw new Error(mapAuthError(error))
  return data
}

/**
 * Public registration creates RESIDENT profiles only. The database trigger
 * provisions the lb_profiles row with role='resident' — the role is never
 * taken from client input. A worker request becomes status='pending' until
 * an administrator approves it (migration 0013).
 * The project must keep Supabase Auth email confirmation disabled so the
 * applicant can immediately submit the required private ID document.
 */
export async function signUpResident(input: SignUpInput) {
  const passwordError = validatePassword(input.password)
  if (passwordError) throw new Error(passwordError)
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      data: {
        full_name: input.fullName.trim(),
        mobile: input.mobile.trim(),
        address: input.address.trim(),
        ...(input.barangayId ? { barangay_id: input.barangayId } : {}),
        ...(input.accountType === "worker" ? { requested_role: "worker" } : {}),
      },
      emailRedirectTo: window.location.origin,
    },
  })
  if (error) throw new Error(mapAuthError(error))
  if (!data.session?.user) {
    throw new Error("Registration was created, but automatic sign-in is unavailable. Disable Confirm email in Supabase Authentication → Providers → Email, then try again.")
  }
  return { session: data.session }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    {
      redirectTo: "https://link-barangay1.vercel.app",
    }
  )

  if (error) throw new Error(mapAuthError(error))
}
