// ============================================================================
// LinkBarangay — resident request submission (3-step wizard, real insert)
// ============================================================================

import { useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button } from "@/components/common/ui"
import { Notice } from "@/components/common/States"
import { Field, TextArea, TextInput } from "@/components/forms/fields"
import { GoogleLocationPicker, type RequestLocation } from "@/features/resident/GoogleLocationPicker"
import { ResidentAppointmentPicker } from "@/features/shared/RequestScheduling"
import { manilaDateTime } from "@/lib/dateTime"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { listCategories } from "@/services/configService"
import { removeStagedRequestEvidence, submitRequest, uploadStagedRequestEvidence } from "@/services/requestService"
import type { ServiceRequest, ViewId } from "@/types"

export function SubmitRequestPage({ setView }: { setView: (view: ViewId) => void }) {
  const { profile } = useAuth()
  const categories = useAsync(() => listCategories(), [])
  const [step, setStep] = useState(1)
  const [categoryId, setCategoryId] = useState("")
  const [categorySearch, setCategorySearch] = useState("")
  const [isCustom, setIsCustom] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [mapLocation, setMapLocation] = useState<RequestLocation | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<ServiceRequest | null>(null)
  const [preferredAt, setPreferredAt] = useState("")

  const category = categories.data?.find((c) => c.id === categoryId)
  const matchingCategories = (categories.data ?? []).filter((item) => {
    const term = categorySearch.trim().toLowerCase()
    return !term || `${item.name} ${item.description}`.toLowerCase().includes(term)
  })
  const steps = ["Select concern", "Set location", "Upload proof", "Review & submit", "Follow status"]

  if (created) {
    return (
      <div className="submission-receipt">
        <header className="receipt-hero">
          <span className="receipt-success"><Icon name="check" size={26} /></span>
          <div>
            <span className="page-kicker">REQUEST RECEIVED</span>
            <h1>Your request was submitted</h1>
            <p>Barangay staff will review your concern. We’ll show all updates in My Requests and Notifications.</p>
          </div>
        </header>
        <section className="receipt-reference">
          <span>TRACKING REFERENCE</span>
          <strong>{created.reference}</strong>
          <small>Keep this reference number for follow-up.</small>
        </section>
        <section className="receipt-details">
          <div><span>Concern</span><strong>{isCustom ? "Custom Request" : category?.name ?? "—"}</strong></div>
          <div><span>Submitted</span><strong>{manilaDateTime(created.created_at)}</strong></div>
          <div><span>Current status</span><strong>Submitted for review</strong></div>
          <div><span>Service target</span><strong>{category?.sla_hours ? `${category.sla_hours} hours` : "Standard SLA"}</strong></div>
          {preferredAt && <div className="wide"><span>Appointment request</span><strong>{manilaDateTime(preferredAt)} (Philippine time) · awaiting confirmation</strong></div>}
        </section>
        <section className="receipt-next">
          <Icon name="history" size={18} />
          <div><strong>What happens next?</strong><p>Staff verifies the request, then routes it to the appropriate team when action is needed.</p></div>
        </section>
        <div className="receipt-actions">
          <Button variant="secondary" onClick={() => setView("dashboard")}>Back to dashboard</Button>
          <Button onClick={() => setView("requests")}>Track request</Button>
        </div>
      </div>
    )
  }

  const submit = async () => {
    if (!profile) return
    if (!profile.barangay_id) {
      setError("Your account has no barangay assigned yet. Ask an administrator to assign your barangay before submitting a request.")
      return
    }
    if (profile.verification?.status !== "approved") {
      setError("Your resident account must be approved before submitting a request.")
      return
    }
    const cleanTitle = title.trim()
    const cleanDescription = description.trim()
    const cleanLocation = mapLocation?.address.trim() ?? ""
    if (cleanTitle.length < 4 || cleanTitle.length > 150) {
      setError("Enter a request title between 4 and 150 characters.")
      setStep(2)
      return
    }
    if (cleanDescription.length < 10 || cleanDescription.length > 4000) {
      setError("Enter a description between 10 and 4000 characters.")
      setStep(2)
      return
    }
    if (!cleanLocation || !mapLocation) {
      setError("Search for and confirm the exact request location on the map.")
      setStep(2)
      return
    }
    if (!file) {
      setError("Attach at least one photo or video as evidence before submitting.")
      setStep(2)
      return
    }
    setBusy(true)
    setError(null)
    let evidencePath: string | null = null
    try {
      evidencePath = await uploadStagedRequestEvidence(profile.id, file)
      const request = await submitRequest({
        title,
        description,
        category_id: isCustom ? null : categoryId,
        location: cleanLocation,
        is_custom: isCustom,
        latitude: mapLocation.latitude,
        longitude: mapLocation.longitude,
        location_details: { barangay: mapLocation.barangay, city: mapLocation.city, province: mapLocation.province, map_url: mapLocation.map_url },
      }, evidencePath, !isCustom && category?.field_appointment_minutes ? preferredAt || undefined : undefined)
      setCreated(request)
    } catch (err) {
      if (evidencePath) await removeStagedRequestEvidence(evidencePath, profile.id).catch(() => undefined)
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-heading">
        <button className="back-circle" onClick={() => setView("dashboard")}>
          <Icon name="arrow" size={15} />
        </button>
        <div>
          <span className="page-kicker">NEW REQUEST</span>
          <h1>Submit a request</h1>
          <p>Three quick steps — we route it to the right team for you.</p>
        </div>
      </div>

      <div className="stepper" aria-label="Request submission steps">
        {steps.map((label, index) => (
          <div className={index + 1 < (step === 1 ? 1 : step === 2 ? 3 : 4) ? "done" : index + 1 === (step === 1 ? 1 : step === 2 ? 3 : 4) ? "active" : ""} key={label}>
            <span>{index + 1}</span>
            <b>{label}</b>
            <i />
          </div>
        ))}
      </div>

      {profile && !profile.barangay_id && (
        <Notice tone="warning">
          Your account needs an assigned barangay before you can submit a request. Contact an administrator; this ensures the correct front desk receives it.
        </Notice>
      )}
      {profile?.role === "resident" && profile.verification?.status !== "approved" && (
        <Notice tone="warning">Your account is awaiting ID and address verification. Requests are available after admin approval.</Notice>
      )}

      <div className="form-panel">
        <div className="form-section">
          {error && <Notice tone="error">{error}</Notice>}

          {step === 1 && (
            <div className="request-form">
              <label className="category-search"><Icon name="search" size={17} /><input value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="Search for a concern or service..." aria-label="Search request categories" /></label>
              <div className="choice-grid">
                {matchingCategories.map((item) => (
                  <label key={item.id}>
                    <input
                      type="radio"
                      name="category"
                      checked={!isCustom && categoryId === item.id}
                      onChange={() => { setCategoryId(item.id); setIsCustom(false); setPreferredAt("") }}
                    />
                    <span>
                      <Icon name="file" size={20} />
                      <b>{item.name}</b>
                      <small>
                        {item.description}
                        {item.sla_hours ? ` · target ${item.sla_hours}h` : ""}
                      </small>
                    </span>
                  </label>
                ))}
                <label className="custom-request-choice">
                  <input type="radio" name="category" checked={isCustom} onChange={() => { setIsCustom(true); setCategoryId(""); setPreferredAt("") }} />
                  <span><Icon name="plus" size={20} /><b>Can't find your concern? Submit a Custom Request</b><small>Describe a legitimate barangay concern that is not listed above. It will follow the same review and dispatch process.</small></span>
                </label>
              </div>
              {!matchingCategories.length && <Notice tone="info">No matching category found. You can submit a Custom Request instead.</Notice>}
              {categories.loading && <p className="muted-note">Loading services…</p>}
              {categories.error && (
                <Notice tone="warning">
                  Could not load service categories: {categories.error}
                </Notice>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="request-form">
              <Field label="Request title" hint="4–150 characters" required>
                <TextInput
                  value={title}
                  onChange={setTitle}
                  placeholder="Briefly describe your concern"
                  required
                />
              </Field>
              <Field label="What happened?" hint="At least 10 characters. Include dates, effects, and what help you need." required>
                <TextArea value={description} onChange={setDescription} rows={5} required />
              </Field>
              {isCustom && <Notice tone="info">This will be submitted as a Custom Request for barangay staff assessment and priority review.</Notice>}
              <Field label="Exact location" hint="Search the address, use your current location, or click and drag the pin. A Google Maps link is optional." required>
                <GoogleLocationPicker value={mapLocation} onChange={(selected) => { setMapLocation(selected); setLocation(selected?.address ?? "") }} />
              </Field>
              <label className="upload-zone">
                <Icon name="upload" size={20} />
                <strong>{file ? file.name : "Attach required photo or video evidence"}</strong>
                <small>JPG, PNG, WebP, MP4, WebM, MOV · max 50 MB</small>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                  required
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              {!file && <p className="field-help">Evidence is required before you can continue.</p>}
            </div>
          )}

          {step === 3 && (
            <div className="request-form">
              <div className="review-card">
                <div>
                  <span>Service</span>
                  <strong>{isCustom ? "Custom Request" : category?.name ?? "—"}</strong>
                </div>
                <div>
                  <span>Target resolution</span>
                  <strong>{category ? `${category.sla_hours} hours` : "Standard SLA"}</strong>
                </div>
                <div>
                  <span>Title</span>
                  <strong>{title}</strong>
                </div>
                <div className="wide">
                  <span>Description</span>
                  <strong>{description}</strong>
                </div>
                <div className="wide">
                  <span>Location</span>
                  <strong>{location}</strong>
                </div>
                <div className="wide">
                  <span>Attachment</span>
                  <strong>{file ? file.name : "None"}</strong>
                </div>
              </div>
              {!isCustom && category?.field_appointment_minutes && profile?.verification?.status === "approved" && (
                <section>
                  <h3>Request an appointment (optional)</h3>
                  <ResidentAppointmentPicker key={category.id} categoryId={category.id} value={preferredAt} onChange={setPreferredAt} />
                </section>
              )}
              {busy && <Notice tone="info">Submitting your request…</Notice>}
            </div>
          )}
        </div>

        <div className="form-footer">
          <div>
            <span>Step {step} of 3</span>
            {step > 1 && (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
          </div>
          {step < 3 ? (
            <Button
              icon="arrow"
              disabled={
                (step === 1 && !categoryId && !isCustom) ||
                (step === 2 && (!title.trim() || !description.trim() || !mapLocation || !file))
              }
              onClick={() => setStep(step + 1)}
            >
              Continue
            </Button>
          ) : (
            <Button icon="check" disabled={busy || !profile?.barangay_id || profile?.verification?.status !== "approved" || !file} onClick={() => void submit()}>
              {busy ? "Submitting…" : "Submit request"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
