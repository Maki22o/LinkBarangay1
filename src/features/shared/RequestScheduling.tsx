import { useState } from "react"
import { Button, Status } from "@/components/common/ui"
import { Modal } from "@/components/common/Modal"
import { Notice } from "@/components/common/States"
import { Field, Select, TextArea } from "@/components/forms/fields"
import { useAsync } from "@/hooks/useAsync"
import { manilaDateTime, manilaInput, manilaInstant, shiftDay } from "@/lib/dateTime"
import { listFieldCapacity, listResidentSlots } from "@/services/schedulingService"
import type { FieldAssignmentInput, RequestSchedule } from "@/services/schedulingService"
import { DISPATCH_PRIORITIES, PRIORITY_LABELS } from "@/types"
import type { Assignment, DispatchPriority, RequestPriority, ServiceRequest } from "@/types"

const priorityOptions = DISPATCH_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))

function canonicalPriority(priority: RequestPriority): DispatchPriority {
  return priority === "medium" ? "normal" : priority
}

export function ResidentAppointmentPicker({ categoryId, value, onChange }: {
  categoryId: string
  value: string
  onChange: (value: string) => void
}) {
  const today = manilaInput(Date.now()).slice(0, 10)
  const [day, setDay] = useState(() => manilaInput(value).slice(0, 10) || today)
  const slots = useAsync(() => day ? listResidentSlots(categoryId, day) : Promise.resolve([]), [categoryId, day])
  return (
    <div className="schedule-form">
      <div className="form-grid">
        <Field label="Preferred date" hint="Philippine time (Asia/Manila)">
          <input type="date" min={today} max={shiftDay(today, 90)} value={day} onChange={(event) => {
            setDay(event.target.value)
            onChange("")
          }} />
        </Field>
        <Field label="Preferred time">
          <Select value={value} onChange={onChange} disabled={slots.loading} options={[
            { value: "", label: slots.loading ? "Loading times…" : "Select an available time" },
            ...(slots.data ?? []).map((slot) => ({ value: slot, label: manilaInput(slot).slice(11) })),
          ]} />
        </Field>
      </div>
      {slots.error && <Notice tone="warning">{slots.error} <button onClick={slots.refresh}>Refresh times</button></Notice>}
      {!slots.loading && !slots.error && !slots.data?.length && <p className="muted-note">No available times on this date.</p>}
      <p className="field-help">Your preferred time is held only after dispatch confirms it.</p>
    </div>
  )
}

export function RequestScheduleSummary({ schedule, estimate, minutes }: {
  schedule: RequestSchedule | null
  estimate?: string | null
  minutes?: number | null
}) {
  return (
    <dl className="schedule-summary">
      <div><dt>Appointment status</dt><dd>{schedule ? <Status status={schedule.status} /> : "No appointment"}</dd></div>
      {schedule?.preferred_at && <div><dt>Preferred time</dt><dd>{manilaDateTime(schedule.preferred_at)}</dd></div>}
      {schedule?.proposed_at && <div><dt>Alternate proposed time</dt><dd>{manilaDateTime(schedule.proposed_at)}</dd></div>}
      {schedule?.scheduled_at && <div><dt>{schedule.status === "cancelled" ? "Previous booking" : "Scheduled start"}</dt>
        <dd>{manilaDateTime(schedule.scheduled_at)}</dd></div>}
      {schedule?.end_at && schedule.status !== "cancelled" && <div><dt>Scheduled end</dt><dd>{manilaDateTime(schedule.end_at)}</dd></div>}
      <div><dt>Estimated completion</dt><dd>{estimate ? manilaDateTime(estimate) : "Awaiting estimate"}</dd></div>
      {minutes != null && <div><dt>Estimated work duration</dt><dd>{minutes} min</dd></div>}
      {schedule?.change_reason && <div><dt>Schedule change</dt><dd>{schedule.change_reason}</dd></div>}
    </dl>
  )
}

export function FieldAssignmentModal({ request, schedule, current, departmentId, canConfirm, busy, error, onEdit, onClose, onSave, onPropose }: {
  request: ServiceRequest
  schedule: RequestSchedule | null
  current?: Assignment
  departmentId: string
  canConfirm: boolean
  busy: boolean
  error: string | null
  onEdit: () => void
  onClose: () => void
  onSave: (value: FieldAssignmentInput) => void
  onPropose: (date: string, reason: string) => void
}) {
  const currentStart = current?.schedule_at ?? (schedule?.status === "pending" ? schedule.proposed_at ?? schedule.preferred_at : null)
  const [userId, setUserId] = useState(current?.assigned_to ?? "")
  // null is an unscheduled assignment; an empty time is a booking awaiting a time.
  const [time, setTime] = useState<string | null>(() => manilaInput(currentStart).slice(11) || null)
  const [minutes, setMinutes] = useState(String(current?.duration_minutes ?? request.category?.field_appointment_minutes ?? ""))
  const [day, setDay] = useState(manilaInput(currentStart ?? new Date()).slice(0, 10))
  const [instructions, setInstructions] = useState(current?.notes ?? "")
  const [reason, setReason] = useState("")
  const [priority, setPriority] = useState<DispatchPriority>(canonicalPriority(request.priority))
  const duration = Number(minutes)
  const validDuration = Number.isInteger(duration) && duration >= 15 && duration <= 480
  const lookupMinutes = validDuration ? duration : 30
  const capacity = useAsync(async () => ({
    departmentId,
    day,
    minutes: lookupMinutes,
    people: departmentId && day ? await listFieldCapacity(departmentId, day, lookupMinutes, request.id) : [],
  }), [departmentId, day, lookupMinutes, request.id])
  const people = capacity.data?.departmentId === departmentId ? capacity.data.people : []
  const worker = people.find((person) => person.id === userId)
  const timesLoaded = !capacity.loading && !capacity.error
    && capacity.data?.departmentId === departmentId && capacity.data.day === day && capacity.data.minutes === lookupMinutes
  const slots = timesLoaded && validDuration ? worker?.slots ?? [] : []
  const roster = [...people].sort((a, b) => {
    const earlier = (a.next_at ? Date.parse(a.next_at) : Infinity) - (b.next_at ? Date.parse(b.next_at) : Infinity)
    return priority === "urgent" || priority === "high" ? earlier || a.workload - b.workload : a.workload - b.workload || earlier
  })
  const startAt = time ? manilaInstant(`${day}T${time}`) : null
  const hasAppointment = schedule != null && ["pending", "confirmed", "rescheduled", "in_progress"].includes(schedule.status)
  const needsAppointmentTime = hasAppointment || time !== null
  const estimatedEnd = startAt && validDuration ? manilaDateTime(new Date(Date.parse(startAt) + duration * 60_000).toISOString()) : ""
  const action = schedule?.status === "pending" ? "Confirm appointment and assign" : current ? "Save assignment" : "Assign personnel"
  const confirm = () => onSave({ userId, startAt, minutes: startAt ? duration : null, instructions, reason, priority })
  const useSlot = (slot: string) => {
    const local = manilaInput(slot)
    setDay(local.slice(0, 10))
    setTime(local.slice(11))
    onEdit()
  }

  return (
    <Modal title={canConfirm ? action : "Propose an appointment time"} onClose={onClose} wide>
      {error && <Notice tone="error">
        {error} <button type="button" className="link-button" onClick={() => { onEdit(); capacity.refresh() }}>Refresh available times</button>
      </Notice>}
      {!departmentId && <Notice tone="warning">Route this request to a department before assigning personnel.</Notice>}
      {capacity.error && <Notice tone="error">{capacity.error}</Notice>}
      {timesLoaded && departmentId && !people.length && <Notice tone="warning">No active field personnel in this department.</Notice>}
      {schedule?.status === "pending" && <Notice tone="info">Resident preference: {manilaDateTime(schedule.preferred_at)} (Philippine time).</Notice>}
      {!canConfirm && <Notice tone="info">Barangay staff must verify the request before you can confirm an assignment.</Notice>}
      <Field label="Field personnel" required>
        <Select value={userId} onChange={(value) => { setUserId(value); onEdit() }} options={[
          { value: "", label: "Select personnel" },
          ...roster.map((person) => ({
            value: person.id, label: `${person.name} · ${person.status} now · ${person.workload} open jobs`,
          })),
        ]} />
      </Field>
      <div className="form-grid">
        <Field label="Appointment date" hint="Philippine time (Asia/Manila)">
          <input type="date" value={day} onChange={(event) => {
            setDay(event.target.value)
            setTime("")
            onEdit()
          }} />
        </Field>
        <Field label="Appointment start time">
          <input type="time" value={time ?? ""} onChange={(event) => { setTime(event.target.value); onEdit() }} />
        </Field>
        <Field label="Duration in minutes">
          <input type="number" min={15} max={480} value={minutes} onChange={(event) => { setMinutes(event.target.value); onEdit() }} />
        </Field>
        <Field label="Available times for selected personnel">
          <Select value={slots.find((slot) => Date.parse(slot) === Date.parse(startAt ?? "")) ?? ""}
            onChange={(slot) => { if (slot) useSlot(slot) }}
            disabled={!slots.length}
            options={[{ value: "", label: capacity.loading ? "Checking availability…" : "Choose an available time" }, ...slots.map((slot) => ({
              value: slot, label: manilaInput(slot).slice(11),
            }))]} />
        </Field>
      </div>
      {worker && day && validDuration && timesLoaded && !slots.length && <Notice tone="warning">
        No suggested times fit {duration} minutes on this date. Check the worker’s saved hours in My Availability,
        your dispatcher hours, and any blocked time or bookings.
      </Notice>}
      {worker?.next_at && validDuration && timesLoaded && <div className="schedule-block">
        <p className="muted-note">Next available {manilaDateTime(worker.next_at)}</p>
        <Button variant="secondary" onClick={() => { if (worker.next_at) useSlot(worker.next_at) }}>
          Use this time
        </Button>
      </div>}
      {timesLoaded && worker && worker.blocks.length > 0 && <div className="schedule-form">
        <h3>Unavailable periods on this date</h3>
        {worker.blocks.map((block) => <p className="muted-note" key={block.starts_at + block.ends_at}>
          {manilaDateTime(block.starts_at)} to {manilaDateTime(block.ends_at)}
        </p>)}
      </div>}
      {timesLoaded && worker && worker.bookings.length > 0 && <div className="schedule-form">
        <h3>Existing bookings on this date</h3>
        {worker.bookings.map((booking) => <p className="muted-note" key={booking.starts_at + booking.reference}>
          {manilaInput(booking.starts_at).slice(11)}–{manilaInput(booking.ends_at).slice(11)} · {booking.reference} · {booking.title}
        </p>)}
      </div>}
      {estimatedEnd && <p className="muted-note">Estimated completion: {estimatedEnd}</p>}
      <Field label="Priority"><Select value={priority} onChange={(value) => setPriority(value as DispatchPriority)} options={priorityOptions} /></Field>
      <Field label="Work instructions" hint="Visible to authorized staff and the assigned worker">
        <TextArea value={instructions} onChange={setInstructions} rows={3} />
      </Field>
      <Field label="Change reason" hint="Required for reassignment, moving a booking, or increasing urgency">
        <TextArea value={reason} onChange={setReason} rows={2} />
      </Field>
      {canConfirm && !hasAppointment && time !== null && <div>
        <Button variant="ghost" onClick={() => { setTime(null); onEdit() }}>Leave unscheduled</Button>
      </div>}
      {canConfirm && !needsAppointmentTime && <p className="muted-note">This assignment will be saved without an appointment.</p>}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        {schedule?.status === "pending" && <Button variant="secondary"
          disabled={busy || !startAt || Date.parse(startAt) === Date.parse(schedule.preferred_at ?? "") || !reason.trim()}
          onClick={() => { if (startAt) onPropose(startAt, reason) }}>Propose alternate time</Button>}
        {canConfirm && <Button disabled={busy || !worker || (needsAppointmentTime && (!startAt || !validDuration))}
          onClick={confirm}>{action}</Button>}
      </div>
    </Modal>
  )
}

export function PriorityModal({ priority, busy, error, onClose, onSave }: {
  priority: RequestPriority
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (priority: DispatchPriority, reason: string) => void
}) {
  const [value, setValue] = useState<DispatchPriority>(canonicalPriority(priority))
  const [reason, setReason] = useState("")
  const increased = DISPATCH_PRIORITIES.indexOf(value) > DISPATCH_PRIORITIES.indexOf(canonicalPriority(priority))
  return (
    <Modal title="Change request priority" onClose={onClose}>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Priority"><Select value={value} onChange={(next) => setValue(next as DispatchPriority)} options={priorityOptions} /></Field>
      <Field label="Reason" required={increased}><TextArea value={reason} onChange={setReason} rows={3} /></Field>
      <div className="modal-actions"><Button onClick={() => onSave(value, reason)} disabled={busy || (increased && !reason.trim())}>Save priority</Button></div>
    </Modal>
  )
}

export function EstimateModal({ request, busy, error, onClose, onSave, onSaveDays }: {
  request: ServiceRequest
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (estimate: string | null, minutes: number | null, reason: string) => void
  onSaveDays: (days: number, reason: string) => void
}) {
  const [estimate, setEstimate] = useState(manilaInput(request.estimated_completion_at))
  const [minutes, setMinutes] = useState(String(request.estimated_duration_minutes ?? ""))
  const [reason, setReason] = useState("")
  const [method, setMethod] = useState("manual")
  const [days, setDays] = useState("")
  const instant = manilaInstant(estimate)
  const validDays = Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 30
  return (
    <Modal title="Update completion estimate" onClose={onClose}>
      {error && <Notice tone="error">{error}</Notice>}
      {request.assigned_to && <Field label="Estimate method"><Select value={method} onChange={setMethod} options={[
        { value: "manual", label: "Enter a date and time" }, { value: "days", label: "Calculate from working days" },
      ]} /></Field>}
      {method === "days" ? <Field label="Working days" hint="Uses the assigned worker’s hours and unavailable periods.">
        <input type="number" min={1} max={30} value={days} onChange={(event) => setDays(event.target.value)} />
      </Field> : <>
        <Field label="Estimated completion" hint="Philippine time. Leave empty if still awaiting an estimate.">
          <input type="datetime-local" value={estimate} onChange={(event) => setEstimate(event.target.value)} />
        </Field>
        {estimate && <Field label="Estimated work minutes"><input type="number" min={1} value={minutes} onChange={(event) => setMinutes(event.target.value)} /></Field>}
      </>}
      <Field label="Reason" required><TextArea value={reason} onChange={setReason} rows={3} /></Field>
      <div className="modal-actions"><Button onClick={() => method === "days" ? onSaveDays(Number(days), reason) : onSave(instant, instant && minutes ? Number(minutes) : null, reason)}
        disabled={busy || !reason.trim() || (method === "days" ? !validDays : Boolean(estimate && !instant))}>Save estimate</Button></div>
    </Modal>
  )
}
