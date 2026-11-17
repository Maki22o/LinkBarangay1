import { useState } from "react"
import { Button } from "@/components/common/ui"
import { Modal } from "@/components/common/Modal"
import { Notice } from "@/components/common/States"
import { Field, Select, TextArea, TextInput } from "@/components/forms/fields"
import { submitSupportRequest } from "@/services/supportService"

export function SupportRequestModal({ onClose }: { onClose: () => void }) {
  const [subject, setSubject] = useState("")
  const [category, setCategory] = useState<"account" | "request" | "technical" | "other">("request")
  const [description, setDescription] = useState("")
  const [contact, setContact] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    if (subject.trim().length < 4) { setError("Enter a subject of at least 4 characters."); return }
    if (description.trim().length < 10) { setError("Describe the concern in at least 10 characters."); return }
    setBusy(true)
    setError(null)
    try {
      await submitSupportRequest({ subject, category, description, contact })
      setSent(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Need assistance?" onClose={onClose}>
      {sent ? (
        <>
          <Notice tone="success">Your support request was sent. The help desk will review it using the contact details on your account or the details you supplied.</Notice>
          <div className="modal-actions"><Button onClick={onClose}>Done</Button></div>
        </>
      ) : (
        <>
          <Notice tone="info">For urgent public-safety emergencies, contact local emergency services first.</Notice>
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Subject" required><TextInput value={subject} onChange={setSubject} placeholder="Briefly describe what you need" required /></Field>
          <Field label="Category" required>
            <Select value={category} onChange={(value) => setCategory(value as typeof category)} options={[
              { value: "request", label: "Service request" },
              { value: "account", label: "Account or access" },
              { value: "technical", label: "Technical problem" },
              { value: "other", label: "Other" },
            ]} />
          </Field>
          <Field label="Description" required><TextArea value={description} onChange={setDescription} rows={5} placeholder="Include the relevant request reference, error, or details." required /></Field>
          <Field label="Preferred contact details" hint="Optional — email or mobile number"><TextInput value={contact} onChange={setContact} placeholder="How the help desk can reach you" /></Field>
          <div className="modal-actions">
            <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button disabled={busy} onClick={() => void submit()}>{busy ? "Sending…" : "Send support request"}</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
