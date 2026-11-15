// ============================================================================
// LinkBarangay — profile page. Users edit only their own free-text fields;
// role, status, barangay and department are assigned by administrators and
// are read-only here (and enforced by a database trigger).
// ============================================================================

import { useEffect, useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button, Status, initials } from "@/components/common/ui"
import { Notice } from "@/components/common/States"
import { Field, TextInput } from "@/components/forms/fields"
import { useAuth } from "@/hooks/useAuth"
import { updateOwnProfile } from "@/services/profileService"
import { submitResidentId, validateResidentId } from "@/services/residentVerificationService"
import { profileRoleLabel } from "@/types"

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState("")
  const [mobile, setMobile] = useState("")
  const [address, setAddress] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [idFile, setIdFile] = useState<File | null>(null)
  const [idBusy, setIdBusy] = useState(false)
  const [idError, setIdError] = useState<string | null>(null)
  const [idNotice, setIdNotice] = useState<string | null>(null)

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "")
      setMobile(profile.mobile ?? "")
      setAddress(profile.address ?? "")
    }
  }, [profile?.id, profile?.full_name, profile?.mobile, profile?.address])

  if (!profile) return null

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await updateOwnProfile(profile.id, {
        full_name: fullName.trim(),
        mobile: mobile.trim(),
        address: address.trim(),
      })
      await refreshProfile()
      setNotice("Profile updated.")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const completion = [fullName, profile.email, mobile, address, profile.barangay_id].filter(
    Boolean,
  ).length
  const verificationStatus = profile.role === "resident" ? (profile.verification?.status ?? "pending") : null

  const submitId = async () => {
    if (!idFile) { setIdError("Choose your ID document first."); return }
    try { validateResidentId(idFile) } catch (err) { setIdError((err as Error).message); return }
    setIdBusy(true)
    setIdError(null)
    setIdNotice(null)
    try {
      await submitResidentId(profile.id, idFile)
      await refreshProfile()
      setIdFile(null)
      setIdNotice("Your ID was securely submitted for administrator review.")
    } catch (err) {
      setIdError((err as Error).message)
    } finally { setIdBusy(false) }
  }

  return (
    <div className="profile-page generic-page">
      <div className="welcome-row">
        <div>
          <span className="page-kicker">ACCOUNT</span>
          <h1>My Profile</h1>
          <p>Your personal information and account assignment.</p>
        </div>
      </div>

      <div className="panel">
        <div className="profile-hero">
          <span>{initials(profile.full_name || profile.email || "U")}</span>
          <div>
            <h2>{profile.full_name || "(No name set)"}</h2>
            <p>
              {profileRoleLabel(profile)}
              {profile.barangay?.name ? ` · Barangay ${profile.barangay.name}` : ""}
              {profile.department?.name ? ` · ${profile.department.name}` : ""}
            </p>
          </div>
          <div className="profile-progress-ring" title={`${completion} of 5 fields completed`}>
            <div className="profile-progress" style={{ background: undefined }}>
              <span>{Math.round((completion / 5) * 100)}%</span>
            </div>
          </div>
        </div>

        {notice && <Notice tone="success">{notice}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        <form className="profile-fields" onSubmit={save}>
          <Field label="Full name" required>
            <TextInput value={fullName} onChange={setFullName} required />
          </Field>
          <Field label="Email (sign-in address)" hint="Contact an administrator to change">
            <TextInput value={profile.email} onChange={() => undefined} disabled />
          </Field>
          <Field label="Role" hint="Assigned by the administrator — cannot be self-changed">
            <TextInput value={profileRoleLabel(profile)} onChange={() => undefined} disabled />
          </Field>
          <Field
            label={profile.role === "resident" ? "Barangay" : "Scope"}
            hint="Assigned by the administrator — cannot be self-changed"
          >
            <TextInput
              value={
                profile.barangay?.name ??
                profile.department?.name ??
                (profile.role === "admin" ? "—" : "Not assigned yet")
              }
              onChange={() => undefined}
              disabled
            />
          </Field>
          <Field label="Mobile number">
            <TextInput value={mobile} onChange={setMobile} placeholder="+63 9XX XXX XXXX" />
          </Field>
          <Field label="Address">
            <TextInput value={address} onChange={setAddress} placeholder="House no., street" />
          </Field>
          <div className="profile-fields-footer">
            <Button type="submit" icon="check" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
            <span className="field-help">
              <Icon name="shield" size={13} /> Role and assignment changes are audited.
            </span>
          </div>
        </form>
      </div>

      {profile.role === "resident" && (
        <section className="panel" style={{ marginTop: 16, padding: 22 }}>
          <div className="panel-head">
            <div>
              <h2>Address verification</h2>
              <p>Requests unlock after an administrator confirms your ID and residential address.</p>
            </div>
            <Status status={verificationStatus ?? "pending"} />
          </div>
          {verificationStatus === "rejected" && profile.verification?.rejection_reason && (
            <Notice tone="warning">Please review and resubmit: {profile.verification.rejection_reason}</Notice>
          )}
          {verificationStatus === "pending" && profile.verification?.storage_path && (
            <Notice tone="info">Your document is awaiting administrator review.</Notice>
          )}
          {verificationStatus === "approved" ? (
            <Notice tone="success">Your resident account is approved. You can submit service requests.</Notice>
          ) : (
            <div className="profile-fields" style={{ marginTop: 14 }}>
              <Field label="Government-issued ID showing your complete home address" required>
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setIdFile(event.target.files?.[0] ?? null)} />
              </Field>
              {idError && <Notice tone="error">{idError}</Notice>}
              {idNotice && <Notice tone="success">{idNotice}</Notice>}
              <Button disabled={idBusy || !idFile} onClick={() => void submitId()}>
                {idBusy ? "Submitting ID…" : "Submit ID for review"}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
