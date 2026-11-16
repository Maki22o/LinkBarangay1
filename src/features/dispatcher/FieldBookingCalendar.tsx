import { useState } from "react"
import { Button, Priority, Status } from "@/components/common/ui"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/States"
import { Field, Select } from "@/components/forms/fields"
import { useAsync } from "@/hooks/useAsync"
import { useRequestRealtimeRefresh } from "@/hooks/useRequestRealtime"
import { manilaDateTime, manilaInput, shiftDay } from "@/lib/dateTime"
import { listFieldBookings, listFieldCapacity } from "@/services/schedulingService"
import type { FieldBooking } from "@/services/schedulingService"

type CalendarView = "day" | "week" | "month" | "pending"

const dateHeading = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })

function rangeFor(day: string, view: CalendarView) {
  const date = new Date(`${day}T00:00:00Z`)
  if (view === "week") {
    const start = shiftDay(day, -((date.getUTCDay() + 6) % 7))
    return { start, end: shiftDay(start, 7), count: 7 }
  }
  if (view === "month") {
    const start = `${day.slice(0, 7)}-01`
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
    return { start, end, count: new Date(Date.parse(end) - 86_400_000).getUTCDate() }
  }
  return { start: day, end: shiftDay(day, 1), count: 1 }
}

export function FieldBookingCalendar({ departmentId, openRequest, openJob, includeCapacity = true }: {
  departmentId: string | null
  openRequest?: (id: string) => void
  openJob?: (id: string) => void
  includeCapacity?: boolean
}) {
  const [day, setDay] = useState(() => manilaInput(Date.now()).slice(0, 10))
  const [view, setView] = useState<CalendarView>("week")
  const range = rangeFor(day, view)
  const bookings = useAsync(() => listFieldBookings(departmentId, range.start, range.end, view === "pending"),
    [departmentId, range.start, range.end, view])
  useRequestRealtimeRefresh(bookings.refresh, {
    table: "lb_appointments", filter: departmentId ? `department_id=eq.${departmentId}` : undefined,
  })
  const [duration, setDuration] = useState("30")
  const minutes = Number(duration)
  const capacity = useAsync(() => includeCapacity && departmentId && view === "day" && Number.isInteger(minutes)
    && minutes >= 15 && minutes <= 480 ? listFieldCapacity(departmentId, day, minutes) : Promise.resolve([]),
    [includeCapacity, departmentId, view, day, minutes])
  useRequestRealtimeRefresh(capacity.refresh, {
    enabled: includeCapacity && view === "day" && Boolean(departmentId), table: "lb_assignments",
    filter: departmentId ? `department_id=eq.${departmentId}` : undefined,
  })

  const dayEntries = new Map<string, FieldBooking[]>()
  for (const item of bookings.data ?? []) {
    const key = manilaInput(item.scheduled_at).slice(0, 10)
    if (!dayEntries.has(key)) dayEntries.set(key, [])
    dayEntries.get(key)?.push(item)
  }
  const dates = Array.from({ length: range.count }, (_, index) => shiftDay(range.start, index))
  const offset = view === "month" ? (new Date(`${range.start}T00:00:00Z`).getUTCDay() + 6) % 7 : 0
  const openEntry = (entry: FieldBooking) => {
    if (openJob && entry.assignment_id) openJob(entry.assignment_id)
    else openRequest?.(entry.request_id)
  }
  const navigate = (direction: number) => {
    if (view === "month") setDay(direction > 0 ? range.end : shiftDay(range.start, -1))
    else setDay(shiftDay(day, direction * range.count))
  }
  return (
    <section className="panel field-calendar">
      <div className="panel-head"><div><h2>Field appointment calendar</h2><p>Philippine time (Asia/Manila)</p></div></div>
      <div className="schedule-controls">
        <Field label="View"><Select value={view} onChange={(value) => setView(value as CalendarView)} options={[
          { value: "day", label: "Day" }, { value: "week", label: "Week" },
          { value: "month", label: "Month" }, ...(openJob ? [] : [{ value: "pending", label: "Pending requests" }]),
        ]} /></Field>
        {view !== "pending" && <>
          <Field label="Calendar date"><input type="date" value={day} onChange={(event) => {
            if (event.target.value) setDay(event.target.value)
          }} /></Field>
          <div className="schedule-pagination"><Button variant="secondary" onClick={() => navigate(-1)}>Previous</Button>
            <Button variant="secondary" onClick={() => navigate(1)}>Next</Button></div>
        </>}
      </div>
      {bookings.error ? <ErrorState message={bookings.error} onRetry={bookings.refresh} /> :
        bookings.loading ? <LoadingState label="Loading appointments…" /> :
        view === "pending" ? (bookings.data?.length ? <div className="calendar-bookings">
          {bookings.data.map((entry) => <BookingCard key={entry.id} entry={entry} openEntry={openEntry} showDate />)}
        </div> : <EmptyState icon="check" title="No pending appointments" />) :
        <div className={`calendar-days calendar-${view}`}>
          {Array.from({ length: offset }, (_, index) => <div className="calendar-placeholder" key={index} aria-hidden="true" />)}
          {dates.map((date) => <div className="calendar-day" key={date}>
            <h3>{dateHeading.format(new Date(`${date}T00:00:00Z`))}</h3>
            {(dayEntries.get(date) ?? []).map((entry) => <BookingCard key={entry.id} entry={entry} openEntry={openEntry} />)}
            {!dayEntries.has(date) && <p className="muted-note">No appointments</p>}
          </div>)}
        </div>}
      {includeCapacity && view === "day" && departmentId && (
        <div className="schedule-form">
          <div className="schedule-controls">
            <Field label="Slot duration (minutes)"><input type="number" min={15} max={480}
              value={duration} onChange={(event) => setDuration(event.target.value)} /></Field>
            <Button variant="secondary" onClick={capacity.refresh}>Refresh availability</Button>
          </div>
          {capacity.error && <ErrorState message={capacity.error} onRetry={capacity.refresh} />}
          {!capacity.error && capacity.loading && <LoadingState label="Checking personnel availability…" />}
          {!capacity.loading && capacity.data?.map((person) => (
            <div key={person.id} className="schedule-person">
              <h3>{person.name} <Status status={person.status} /></h3>
              <p>{person.workload} open jobs · Next available {manilaDateTime(person.next_at)}</p>
              <div className="slot-list">{person.slots.map((slot) => <span key={slot}>{manilaInput(slot).slice(11)}</span>)}</div>
              {!person.slots.length && <p className="muted-note">No available time slots on this date.</p>}
              {person.blocks.map((block) => <p key={block.starts_at}>Unavailable {manilaDateTime(block.starts_at)} to {manilaDateTime(block.ends_at)}</p>)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function BookingCard({ entry, openEntry, showDate = false }: {
  entry: FieldBooking
  openEntry: (entry: FieldBooking) => void
  showDate?: boolean
}) {
  return (
    <button className="calendar-booking" onClick={() => openEntry(entry)}>
      <small>{showDate ? manilaDateTime(entry.scheduled_at) : manilaInput(entry.scheduled_at).slice(11)}{entry.end_at ? `–${manilaInput(entry.end_at).slice(11)}` : ""}</small>
      <strong>{entry.request?.reference ?? "Request"} · {entry.request?.title ?? "Field service"}</strong>
      <span>{entry.assignee?.full_name ?? "Unassigned"}</span>
      {entry.status === "pending" && entry.proposed_at && <span>Alternate: {manilaDateTime(entry.proposed_at)}</span>}
      <span className="calendar-badges"><Status status={entry.status} />{entry.request && <Priority level={entry.request.priority} />}</span>
    </button>
  )
}
