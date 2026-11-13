// ============================================================================
// LinkBarangay — profile page. Users edit only their own free-text fields;
// role, status, barangay and department are assigned by administrators and
// are read-only here (and enforced by a database trigger).
// ============================================================================

import { useEffect, useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button, initials } from "@/components/common/ui"
import { Notice } from "@/components/common/States"
import { Field, TextInput } from "@/components/forms/fields"
import { useAuth } from "@/hooks/useAuth"
import { updateOwnProfile } from "@/services/profileService"
import { profileRoleLabel } from "@/types"

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState("")
  const [mobile, setMobile] = useState("")
  const [address, setAddress] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
                (profile.role === "resident" ? "Not assigned yet" : "—")
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
    </div>
  )
}
