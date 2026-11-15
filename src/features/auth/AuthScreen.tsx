// ============================================================================
// LinkBarangay — authentication screens, wired to Supabase Auth.
// Modes: login · register (resident-only) · anonymous report · public tracking
// ============================================================================

import { useEffect, useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button, Logo, Status } from "@/components/common/ui"
import { Modal } from "@/components/common/Modal"
import { Field, TextInput, TextArea, Select } from "@/components/forms/fields"
import { Notice } from "@/components/common/States"
import {
  requestPasswordReset,
  signIn,
  signOut,
  signUpResident,
} from "@/services/authService"
import { fetchProfile } from "@/services/profileService"
import {
  submitAnonymousReport,
  trackRequest,
  type AnonymousResult,
  type TrackedRequest,
} from "@/services/requestService"
import { listBarangays, listCategories } from "@/services/configService"
import { useAuth } from "@/hooks/useAuth"
import { submitResidentId, validateResidentId } from "@/services/residentVerificationService"
import { supabase } from "@/lib/supabase"
import { STATUS_LABELS } from "@/types"
import type { Barangay, ServiceCategory, ViewId } from "@/types"

type AuthMode = "login" | "register" | "anonymous" | "track"
type AccountType = "resident" | "worker"

function RoleSelect({
  value,
  onChange,
}: {
  value: AccountType
  onChange: (value: AccountType) => void
}) {
  return (
    <Field label="I am a" required>
      <div className="role-toggle" role="radiogroup" aria-label="Account type">
        {(["resident", "worker"] as const).map((r) => (
          <button
            type="button"
            key={r}
            role="radio"
            aria-checked={value === r}
            className={value === r ? "active" : ""}
            onClick={() => onChange(r)}
          >
            {r === "resident" ? "Resident" : "Worker"}
          </button>
        ))}
      </div>
    </Field>
  )
}

const titles: Record<AuthMode, [string, string]> = {
  login: ["Welcome back", "Sign in to view and manage your requests."],
  register: ["Create your account", "Register once to access barangay services online."],
  anonymous: ["Report anonymously", "Submit a concern without creating an account."],
  track: ["Track a request", "Enter your reference number and secure tracking code."],
}

export function AuthScreen({
  mode,
  navigate,
}: {
  mode: AuthMode
  navigate: (view: ViewId) => void
}) {
  const { sessionNotice } = useAuth()
  const [barangays, setBarangays] = useState<Barangay[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Reference data is readable by anonymous users (migration 0002)
    Promise.all([listBarangays(), listCategories()])
      .then(([brgys, cats]) => {
        if (cancelled) return
        setBarangays(brgys)
        setCategories(cats)
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <button className="logo-button light" onClick={() => navigate("landing")}>
          <Logo />
        </button>
        <div className="auth-message">
          <span className="eyebrow light">Linking people to public service</span>
          <h2>Your concern deserves a clear path forward.</h2>
          <p>
            Submit, track, and resolve local service requests through one
            accountable system.
          </p>
        </div>
        <div className="auth-quote">
          <Icon name="shield" />
          <span>Secure, transparent, and built for every resident.</span>
        </div>
      </aside>
      <main className="auth-main">
        <button className="back-link" onClick={() => navigate("landing")}>
          <Icon name="arrow" size={17} /> Back to home
        </button>
        <div className={`auth-card ${mode === "register" ? "wide" : ""}`}>
          <div className="auth-heading">
            <span className="mobile-logo">
              <Logo />
            </span>
            <h1>{titles[mode][0]}</h1>
            <p>{titles[mode][1]}</p>
          </div>

          {sessionNotice && (
            <div className="notice warning">
              <Icon name="alert" />
              <div>
                <strong>{sessionNotice.includes("approval") ? "Account pending approval" : "Session ended"}</strong>
                <p>{sessionNotice}</p>
              </div>
            </div>
          )}
          {loadError && (
            <Notice tone="warning">
              Reference data could not be loaded: {loadError}. Check the
              Supabase configuration and try again.
            </Notice>
          )}

          {mode === "login" && <LoginForm navigate={navigate} />}
          {mode === "register" && <RegisterForm barangays={barangays} navigate={navigate} />}
          {mode === "anonymous" && <AnonymousForm categories={categories} />}
          {mode === "track" && <TrackForm />}
        </div>
      </main>
    </div>
  )
}

export function AuthLinkErrorScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="auth-message">
          <span className="eyebrow light">LinkBarangay account</span>
          <h2>Your account link needs another step.</h2>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-heading">
            <h1>Link expired or already used</h1>
            <p>For your security, invitation and password links work only once.</p>
          </div>
          <Notice tone="warning">
            Return to sign in and use “Forgot password?” to receive a fresh secure link.
          </Notice>
          <div className="modal-actions">
            <Button onClick={onContinue}>Go to sign in</Button>
          </div>
        </div>
      </main>
    </div>
  )
}

export function SetPasswordScreen({
  flow,
  onDone,
}: {
  flow: "invite" | "recovery"
  onDone: () => void
}) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.")
      return
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.")
      return
    }
    setBusy(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        return
      }
      onDone()
    } catch (updateError) {
      setError((updateError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="auth-message">
          <span className="eyebrow light">LinkBarangay account</span>
          <h2>Secure your account with a password.</h2>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-heading">
            <h1>{flow === "invite" ? "Accept your invitation" : "Set a new password"}</h1>
            <p>Choose a password to continue to LinkBarangay.</p>
          </div>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <Field label="New password" required>
              <TextInput type="password" value={password} onChange={setPassword} required />
            </Field>
            <Field label="Confirm password" required>
              <TextInput type="password" value={confirmPassword} onChange={setConfirmPassword} required />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" className="full-width" disabled={busy}>
              {busy ? "Saving…" : "Set password"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
function LoginForm({ navigate }: { navigate: (view: ViewId) => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [accountType, setAccountType] = useState<AccountType>("resident")

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      // Session is picked up by AuthProvider; the app redirects automatically.
      const { user } = await signIn(email, password)
      // The chosen account type must match the role stored on the account.
      const found = await fetchProfile(user.id)
      if (found && found.status !== "pending") {
        const isWorker = found.role === "worker" || found.role === "admin"
        if ((accountType === "worker") !== isWorker) {
          await signOut()
          setError(
            accountType === "worker"
              ? "This account is not a worker account. Choose Resident to sign in."
              : "This is a worker account. Choose Worker to sign in.",
          )
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sendReset = async () => {
    if (!email.trim()) {
      setError("Enter your email above first, then click forgot password.")
      return
    }
    setResetBusy(true)
    setError(null)
    try {
      await requestPasswordReset(email)
      setResetSent(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <>
      {resetSent && (
        <Notice tone="success">
          If that email has an account, a password reset link has been sent.
          Check your inbox.
        </Notice>
      )}
      <form onSubmit={submit} className="auth-form">
        <RoleSelect value={accountType} onChange={setAccountType} />
        <Field label="Email address" required>
          <TextInput
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="name@email.com"
            required
          />
        </Field>
        <Field label="Password" required>
          <TextInput
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Enter your password"
            required
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="form-options">
          <label>
            <input type="checkbox" /> Remember me
          </label>
          <button type="button" onClick={sendReset} disabled={resetBusy}>
            {resetBusy ? "Sending…" : "Forgot password?"}
          </button>
        </div>
        <Button type="submit" className="full-width" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="auth-switch">
        New to LinkBarangay?{" "}
        <button onClick={() => navigate("register")}>Create an account</button>
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// Resident registration (public registration can never create staff accounts;
// the role is assigned server-side by the database trigger)
// ---------------------------------------------------------------------------
function RegisterForm({
  barangays,
  navigate,
}: {
  barangays: Barangay[]
  navigate: (view: ViewId) => void
}) {
  const { refreshProfile } = useAuth()
  const [fullName, setFullName] = useState("")
  const [mobile, setMobile] = useState("")
  const [address, setAddress] = useState("")
  const [residentIdFile, setResidentIdFile] = useState<File | null>(null)
  const [barangayId, setBarangayId] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmPending, setConfirmPending] = useState(false)
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false)
  const [accountType, setAccountType] = useState<AccountType>("resident")

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!barangayId) {
      setError("Select your barangay so your requests can reach the right front desk.")
      return
    }
    if (accountType === "resident" && !residentIdFile) {
      setError("Upload a valid ID showing your complete residential address.")
      return
    }
    if (accountType === "resident" && residentIdFile) {
      try { validateResidentId(residentIdFile) } catch (err) { setError((err as Error).message); return }
    }
    setBusy(true)
    try {
      const result = await signUpResident({
        fullName,
        email,
        password,
        mobile,
        address,
        barangayId,
        accountType,
      })
      setNeedsEmailConfirm(result.needsEmailConfirmation)
      if (result.needsEmailConfirmation) {
        setConfirmPending(true)
      } else if (accountType === "worker") {
        await signOut()
        setConfirmPending(true)
      } else {
        if (!result.session?.user.id || !residentIdFile) throw new Error("Sign in again and upload your ID from My Profile to finish verification.")
        await submitResidentId(result.session.user.id, residentIdFile)
        await refreshProfile()
        setConfirmPending(true)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={submit} className="auth-form">
        <RoleSelect value={accountType} onChange={setAccountType} />
        <div className="form-grid">
          <Field label="Full name" required>
            <TextInput
              value={fullName}
              onChange={setFullName}
              placeholder="e.g. Juan Dela Cruz"
              required
            />
          </Field>
          <Field label="Mobile number" required>
            <TextInput
              value={mobile}
              onChange={setMobile}
              placeholder="+63 9XX XXX XXXX"
              required
            />
          </Field>
          <Field label="Home address" required>
            <TextInput
              value={address}
              onChange={setAddress}
              placeholder="House no., street"
              required
            />
          </Field>
          <Field label="Barangay" required>
            <Select
              value={barangayId}
              onChange={setBarangayId}
              options={[
                { value: "", label: "Select barangay" },
                ...barangays.filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          </Field>
          {accountType === "resident" && (
            <Field label="Valid ID or document with full residential address" required hint="Any valid ID or document that clearly shows your complete address · JPG, PNG, WebP, or PDF · up to 10 MB · visible only to administrators">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
                onChange={(event) => setResidentIdFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          )}
          <Field label="Email address" required>
            <TextInput
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="name@email.com"
              required
            />
          </Field>
          <Field label="Create password" hint="At least 8 characters" required>
            <TextInput
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
              required
            />
          </Field>
        </div>
        <label className="consent">
          <input type="checkbox" required />
          <span>
            I agree to the <button type="button">Privacy Notice</button> and
            consent to the processing of my information for this service.
          </span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="full-width" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="auth-switch">
        Already have an account?{" "}
        <button onClick={() => navigate("login")}>Sign in</button>
      </p>
      {confirmPending && (
        <Modal title="Account submitted for approval" onClose={() => navigate("login")}>
          <div className="confirm-panel">
            <Notice tone="success">
              {accountType === "worker" ? (
                <>
                  <strong>Worker account submitted.</strong> Your account for <b>{email}</b>{" "}
                  is waiting for administrator approval. You can sign in after it is approved.
                </>
              ) : needsEmailConfirm ? (
                <>
                  <strong>Confirm your email first.</strong> We sent a confirmation link to <b>{email}</b>. After confirming, sign in and upload your ID from My Profile so an administrator can review your resident account.
                </>
              ) : (
                <>
                  <strong>Resident verification submitted.</strong> Your ID and address are waiting for administrator approval. You can submit service requests after approval.
                </>
              )}
            </Notice>
            <div className="modal-actions">
              <Button onClick={() => navigate("login")}>Go to sign in</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Anonymous reporting — creates a real request row and returns a reference +
// tracking code
// ---------------------------------------------------------------------------
function AnonymousForm({ categories }: { categories: ServiceCategory[] }) {
  const [title, setTitle] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [location, setLocation] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnonymousResult | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const created = await submitAnonymousReport({
        title,
        description,
        category_id: categoryId || null,
        location,
      })
      setResult(created)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="anon-success">
        <div className="notice warning">
          <Icon name="alert" />
          <div>
            <strong>Save this tracking information</strong>
            <p>
              Anonymous reports cannot receive personal updates. You will need
              the reference number and tracking code to follow progress.
            </p>
          </div>
        </div>
        <div className="reference-box">
          <small>REFERENCE NUMBER</small>
          <strong>{result.reference}</strong>
          <button
            onClick={() => navigator.clipboard?.writeText(result.reference)}
          >
            Copy
          </button>
        </div>
        <div className="reference-box">
          <small>SECURE TRACKING CODE</small>
          <strong>{result.tracking_code}</strong>
          <button
            onClick={() => navigator.clipboard?.writeText(result.tracking_code)}
          >
            Copy
          </button>
        </div>
        <Button className="full-width" onClick={() => setResult(null)}>
          Submit another report
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="notice warning">
        <Icon name="alert" />
        <div>
          <strong>Before you continue</strong>
          <p>
            Anonymous reports cannot receive personal updates. Save the secure
            reference we provide to track progress.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="auth-form">
        <Field label="Request title" required>
          <TextInput
            value={title}
            onChange={setTitle}
            placeholder="Briefly describe your concern"
            required
          />
        </Field>
        <Field label="Service category" required>
          <Select
            value={categoryId}
            onChange={setCategoryId}
            options={[
              { value: "", label: "Select a category" },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </Field>
        <Field label="Location" required>
          <TextInput
            value={location}
            onChange={setLocation}
            placeholder="Street, landmark, or area"
            required
          />
        </Field>
        <Field label="Description" required>
          <TextArea
            value={description}
            onChange={setDescription}
            placeholder="Tell us what happened and what help is needed."
            required
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="full-width" icon="arrow" disabled={busy}>
          {busy ? "Submitting…" : "Submit anonymous report"}
        </Button>
      </form>
    </>
  )
}

// ---------------------------------------------------------------------------
// Public tracking (reference number + secure code; no login)
// ---------------------------------------------------------------------------
function TrackForm() {
  const [reference, setReference] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TrackedRequest | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const tracked = await trackRequest(reference, code)
      if (!tracked.found) {
        setError("No request matches that reference number and tracking code.")
      } else {
        setResult(tracked)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (result?.request) {
    const req = result.request
    const status = String(req.status ?? "submitted")
    return (
      <div className="track-result">
        <div className="result-top">
          <div>
            <span className="mini-label">MATCH FOUND</span>
            <h3>{String(req.title)}</h3>
            <p>Reference {String(req.reference)}</p>
          </div>
          <Status status={status} />
        </div>
        <div className="track-timeline">
          {(result.updates ?? []).map((update, index) => (
            <div className="complete" key={index}>
              <i>
                <Icon name="check" size={13} />
              </i>
              <span>
                <strong>
                  {update.new_status
                    ? STATUS_LABELS[update.new_status as keyof typeof STATUS_LABELS] ?? update.new_status
                    : update.type.replaceAll("_", " ")}
                </strong>
                <small>
                  {update.actor !== "System" ? `${update.actor} · ` : ""}
                  {new Date(update.at).toLocaleString()}
                  {update.remarks ? ` — ${update.remarks}` : ""}
                </small>
              </span>
            </div>
          ))}
        </div>
        <Button className="full-width" onClick={() => setResult(null)}>
          Track another request
        </Button>
      </div>
    )
  }

  return (
    <>
      <form onSubmit={submit} className="auth-form">
        <Field label="Reference number" required>
          <TextInput
            value={reference}
            onChange={setReference}
            placeholder="e.g. LB-2026-0428"
            required
          />
        </Field>
        <Field label="Secure tracking code" required>
          <TextInput
            value={code}
            onChange={setCode}
            placeholder="6-character code"
            required
          />
        </Field>
        <div className="notice">
          <Icon name="shield" />
          <p>Your tracking code is shown in your confirmation receipt.</p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="full-width" icon="search" disabled={busy}>
          {busy ? "Searching…" : "Track request"}
        </Button>
      </form>
    </>
  )
}
