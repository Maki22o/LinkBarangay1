// ============================================================================
// LinkBarangay — appointments page (secretary front desk)
// ============================================================================

import { useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button, Status, formatDateTime } from "@/components/common/ui"
import { Modal } from "@/components/common/Modal"
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/common/States"
import { Field, Select, TextArea, TextInput } from "@/components/forms/fields"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import {
  createAppointment,
  listAppointments,
  updateAppointmentStatus,
} from "@/services/appointmentService"
import { listBarangayResidents } from "@/services/profileService"
import type { Appointment, ViewId } from "@/types"

export function AppointmentsPage({ setView }: { setView: (view: ViewId) => void }) {
  const { profile } = useAuth()
  const list = useAsync(
    () => listAppointments(profile?.barangay_id ?? null),
    [profile?.id],
  )
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const changeStatus = async (appointment: Appointment, status: Appointment["status"]) => {
    if (status === "scheduled") return
    setActionError(null)
    try {
      await updateAppointmentStatus(appointment.id, status)
      list.refresh()
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">FRONT DESK</span>
          <h1>Appointments</h1>
          <p>Scheduled visits for your barangay office.</p>
        </div>
        <Button icon="plus" onClick={() => setCreating(true)}>
          New appointment
        </Button>
      </div>

      {actionError && <Notice tone="error">{actionError}</Notice>}

      <div className="panel">
        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.refresh} />
        ) : !list.data || list.data.length === 0 ? (
          <EmptyState
            icon="clock"
            title="No appointments scheduled"
            hint="Create one with the button above."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Purpose</th>
                  <th>Resident</th>
                  <th>Notes</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((appointment) => (
                  <tr key={appointment.id}>
                    <td>{formatDateTime(appointment.scheduled_at)}</td>
                    <td>
                      <div className="request-cell">
                        <strong>{appointment.purpose}</strong>
                      </div>
                    </td>
                    <td>{appointment.resident?.full_name ?? "Walk-in"}</td>
                    <td>{appointment.notes || "—"}</td>
                    <td>
                      <Status status={appointment.status} />
                    </td>
                    <td>
                      {appointment.status === "scheduled" && (
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            title="Mark completed"
                            onClick={() => void changeStatus(appointment, "completed")}
                          >
                            <Icon name="check" size={14} />
                          </button>
                          <button
                            className="icon-button"
                            title="Mark no-show"
                            onClick={() => void changeStatus(appointment, "no_show")}
                          >
                            <Icon name="close" size={14} />
                          </button>
                          <button
                            className="icon-button"
                            title="Cancel"
                            onClick={() => void changeStatus(appointment, "cancelled")}
                          >
                            <Icon name="alert" size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <NewAppointmentModal
          barangayId={profile?.barangay_id ?? null}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            list.refresh()
          }}
        />
      )}
    </div>
  )
}

function NewAppointmentModal({
  barangayId,
  onClose,
  onCreated,
}: {
  barangayId: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const residents = useAsync(() => listBarangayResidents(barangayId), [barangayId])
  const [residentId, setResidentId] = useState("")
  const [purpose, setPurpose] = useState("")
  const [scheduledAt, setScheduledAt] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!barangayId) {
      setError("Your account has no barangay assignment — ask an administrator to assign one.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createAppointment({
        barangayId,
        residentId: residentId || null,
        scheduledAt: new Date(scheduledAt).toISOString(),
        purpose,
        notes,
      })
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="New appointment" onClose={onClose}>
      <Field label="Resident (optional — walk-ins can leave this blank)">
        <Select
          value={residentId}
          onChange={setResidentId}
          options={[
            { value: "", label: "Walk-in / not listed" },
            ...(residents.data ?? []).map((resident) => ({
              value: resident.id,
              label: resident.full_name || resident.email,
            })),
          ]}
        />
      </Field>
      <Field label="Purpose" required>
        <TextInput
          value={purpose}
          onChange={setPurpose}
          placeholder="e.g. Clearance signing, site inspection briefing"
          required
        />
      </Field>
      <Field label="Date & time" required>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(event) => setScheduledAt(event.target.value)}
          required
        />
      </Field>
      <Field label="Notes">
        <TextArea value={notes} onChange={setNotes} rows={3} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !purpose.trim() || !scheduledAt} onClick={() => void save()}>
          {busy ? "Saving…" : "Create appointment"}
        </Button>
      </div>
    </Modal>
  )
}
