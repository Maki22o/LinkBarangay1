// ============================================================================
// LinkBarangay — resident request submission (3-step wizard, real insert)
// ============================================================================

import { useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button } from "@/components/common/ui"
import { Notice } from "@/components/common/States"
import { Field, TextArea, TextInput } from "@/components/forms/fields"
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
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<ServiceRequest | null>(null)

  const category = categories.data?.find((c) => c.id === categoryId)
  const steps = ["Choose service", "Describe & locate", "Review & submit"]

  if (created) {
    return (
      <div className="success-state">
        <span>
          <Icon name="check" size={30} />
        </span>
        <h1>Request submitted!</h1>
        <p>
          Your concern is now in the barangay verification queue. Keep your reference number to
          track progress — updates will appear under My Requests and in your notifications.
        </p>
        <div className="reference-box">
          <small>REFERENCE NUMBER</small>
          <strong>{created.reference}</strong>
        </div>
        <div>
          <Button variant="secondary" onClick={() => setView("requests")}>
            View my requests
          </Button>
          <Button onClick={() => setView("dashboard")}>Back to dashboard</Button>
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
    const cleanLocation = location.trim()
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
    if (!cleanLocation || cleanLocation.length > 300) {
      setError("Enter a location using up to 300 characters.")
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
        category_id: categoryId,
        location,
      }, evidencePath)
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

      <div className="stepper">
        {steps.map((label, index) => (
          <div className={step >= index + 1 ? "active" : ""} key={label}>
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
              <div className="choice-grid">
                {(categories.data ?? []).map((item) => (
                  <label key={item.id}>
                    <input
                      type="radio"
                      name="category"
                      checked={categoryId === item.id}
                      onChange={() => setCategoryId(item.id)}
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
              </div>
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
              <Field label="Location" hint="Street or landmark, up to 300 characters" required>
                <TextInput
                  value={location}
                  onChange={setLocation}
                  placeholder="e.g. Rizal St., near the covered court"
                  required
                />
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
                  <strong>{category?.name ?? "—"}</strong>
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
                (step === 1 && !categoryId) ||
                (step === 2 && (!title.trim() || !description.trim() || !location.trim() || !file))
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
