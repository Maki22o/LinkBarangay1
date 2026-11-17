import { useEffect, useState } from "react"
import { Button } from "@/components/common/ui"
import { Notice } from "@/components/common/States"
import { Field, TextInput } from "@/components/forms/fields"
import { supabase } from "@/lib/supabase"

type EnrolledFactor = { id: string; status?: string }

/** Optional TOTP enrollment for privileged accounts. The secret and codes are
 * handled by Supabase Auth; LinkBarangay never stores them. */
export function MfaSecurityPanel() {
  const [factors, setFactors] = useState<EnrolledFactor[]>([])
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadFactors = async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError) { setError(listError.message); return }
    setFactors((data?.totp ?? []).filter((factor) => factor.status === "verified"))
  }

  useEffect(() => { void loadFactors() }, [])

  const beginEnrollment = async () => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "LinkBarangay authenticator",
      })
      if (enrollError || !data) throw new Error(enrollError?.message ?? "Could not start two-factor setup.")
      setFactorId(data.id)
      setQrCode(data.totp.qr_code)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const verifyEnrollment = async () => {
    if (!factorId || !/^\d{6}$/.test(code.trim())) { setError("Enter the 6-digit code from your authenticator app."); return }
    setBusy(true); setError(null)
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
      if (challengeError || !challenge) throw new Error(challengeError?.message ?? "Could not verify the code.")
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() })
      if (verifyError) throw new Error(verifyError.message)
      setQrCode(null); setFactorId(null); setCode("")
      setNotice("Two-factor authentication is enabled for this account.")
      await loadFactors()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  if (factors.length > 0 && !qrCode) {
    return <section className="panel security-panel">
      <h2>Two-factor authentication</h2>
      <Notice tone="success">Authenticator-app verification is enabled for this account.</Notice>
    </section>
  }

  return <section className="panel security-panel">
    <h2>Two-factor authentication</h2>
    <p>Protect staff and administrator access with an authenticator app such as Google Authenticator or Microsoft Authenticator.</p>
    {!qrCode ? <Button variant="secondary" disabled={busy} onClick={() => void beginEnrollment()}>{busy ? "Starting…" : "Set up authenticator app"}</Button> : <div className="mfa-enrollment">
      <p>Scan this QR code with your authenticator app, then enter its six-digit code.</p>
      <img className="mfa-qr" src={qrCode} alt="Authenticator app setup QR code" />
      <Field label="Authenticator code" required><TextInput value={code} onChange={setCode} placeholder="123456" required /></Field>
      <Button disabled={busy} onClick={() => void verifyEnrollment()}>{busy ? "Verifying…" : "Verify and enable"}</Button>
    </div>}
    {error && <Notice tone="error">{error}</Notice>}
    {notice && <Notice tone="success">{notice}</Notice>}
  </section>
}
