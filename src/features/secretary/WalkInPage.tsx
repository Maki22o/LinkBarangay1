// ============================================================================
// LinkBarangay — walk-in request encoding (secretary front desk)
// Creates a real lb_service_requests row on behalf of a walk-in resident.
// ============================================================================

import { useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button } from "@/components/common/ui"
import { Notice } from "@/components/common/States"
import { Field, Select, TextArea, TextInput } from "@/components/forms/fields"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { listCategories } from "@/services/configService"
import { encodeWalkInRequest } from "@/services/requestService"
import type { ServiceRequest, ViewId } from "@/types"

export function WalkInPage({ setView }: { setView: (view: ViewId) => void }) {
  const { profile } = useAuth()
  const categories = useAsync(() => listCategories(), [])
  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<ServiceRequest | null>(null)

  if (created) {
    return (
      <div className="success-state">
        <span>
          <Icon name="check" size={30} />
        </span>
        <h1>Walk-in request encoded</h1>
        <p>
          The request entered the intake queue. Reference:
        </p>
        <div className="reference-box">
          <small>REFERENCE NUMBER</small>
          <strong>{created.reference}</strong>
        </div>
        <div>
          <Button onClick={() => setCreated(null)}>Encode another</Button>
          <Button variant="secondary" onClick={() => setView("intake")}>
            Open intake queue
          </Button>
        </div>
      </div>
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      const request = await encodeWalkInRequest(profile, {
        title,
        description,
        category_id: categoryId,
        location,
        submitter_name: name,
        submitter_contact: contact,
      })
      setCreated(request)
      setName("")
      setContact("")
      setCategoryId("")
      setTitle("")
      setDescription("")
      setLocation("")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">FRONT DESK</span>
          <h1>Encode walk-in request</h1>
          <p>
            Record a request for a resident who came in person
            {profile?.barangay?.name ? ` — Barangay ${profile.barangay.name}` : ""}.
          </p>
        </div>
      </div>

      <div className="form-panel">
        <form onSubmit={submit}>
          <div className="form-section">
            {error && <Notice tone="error">{error}</Notice>}
            <div className="form-grid">
              <Field label="Resident full name" required>
                <TextInput value={name} onChange={setName} placeholder="e.g. Juan Dela Cruz" required />
              </Field>
              <Field label="Contact number / email" hint="Optional, for follow-up">
                <TextInput value={contact} onChange={setContact} placeholder="+63 9XX XXX XXXX" />
              </Field>
            </div>
            <Field label="Service category" required>
              <Select
                value={categoryId}
                onChange={setCategoryId}
                options={[
                  { value: "", label: "Select category" },
                  ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </Field>
            <Field label="Request title" required>
              <TextInput value={title} onChange={setTitle} placeholder="Brief description" required />
            </Field>
            <Field label="Details as told by the resident" required>
              <TextArea value={description} onChange={setDescription} rows={4} required />
            </Field>
            <Field label="Location" required>
              <TextInput value={location} onChange={setLocation} placeholder="Street / landmark" required />
            </Field>
          </div>
          <div className="form-footer">
            <div>
              <span>Encoded requests are attributed to the front desk, not to an online account.</span>
            </div>
            <Button type="submit" icon="check" disabled={busy}>
              {busy ? "Saving…" : "Encode request"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
