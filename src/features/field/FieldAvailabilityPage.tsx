import { useState } from "react"
import { Button } from "@/components/common/ui"
import { ErrorState, LoadingState, Notice } from "@/components/common/States"
import { Field } from "@/components/forms/fields"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { manilaDateTime, manilaInput, manilaInstant, shiftDay } from "@/lib/dateTime"
import { listMyAvailability, saveFieldHours, setFieldBlock } from "@/services/schedulingService"
import type { WorkingHours } from "@/services/schedulingService"

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function FieldAvailabilityPage() {
  const { profile } = useAuth()
  const availability = useAsync(() => profile ? listMyAvailability(profile.id) : Promise.resolve(null), [profile?.id])
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [allDay, setAllDay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const run = async (message: string, action: () => Promise<unknown>) => {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await action()
      setNotice(message)
      availability.refresh()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const block = () => void run("Unavailable period saved.", async () => {
    const from = manilaInstant(allDay ? `${start}T00:00` : start)
    const until = manilaInstant(allDay ? `${shiftDay(start, 1)}T00:00` : end)
    if (!from || !until || until <= from) throw new Error("Enter a valid start and end.")
    await setFieldBlock(from, until)
    setStart("")
    setEnd("")
  })

  return (
    <div>
      <div className="welcome-row"><div><h1>My Availability</h1><p>Set working hours and unavailable periods in Philippine time (Asia/Manila).</p></div></div>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {availability.error && <ErrorState message={availability.error} onRetry={availability.refresh} />}
      {!availability.data && availability.loading && <LoadingState />}
      {availability.data && (
        <>
          <HoursEditor key={JSON.stringify(availability.data.hours)} hours={availability.data.hours} busy={busy}
            onSave={(hours) => void run("Working hours saved.", () => saveFieldHours(hours))} />
          <section className="panel schedule-form">
            <h2>Unavailable periods</h2>
            <label className="schedule-check"><input type="checkbox" checked={allDay} onChange={(event) => {
              setAllDay(event.target.checked)
              setStart("")
              setEnd("")
            }} /> Block an entire date</label>
            <div className="form-grid">
              <Field label={allDay ? "Unavailable date" : "Unavailable from"}>
                <input type={allDay ? "date" : "datetime-local"} value={start}
                  min={allDay ? manilaInput(Date.now()).slice(0, 10) : undefined}
                  onChange={(event) => setStart(event.target.value)} />
              </Field>
              {!allDay && <Field label="Unavailable until"><input type="datetime-local" value={end}
                onChange={(event) => setEnd(event.target.value)} /></Field>}
            </div>
            <div><Button disabled={busy || !start || (!allDay && !end)} onClick={block}>Block time</Button></div>
            {availability.data.blocks.map((period) => <div key={period.id} className="schedule-block">
              <span>{manilaDateTime(period.starts_at)} to {manilaDateTime(period.ends_at)}</span>
              <Button variant="secondary" disabled={busy} onClick={() => void run("Unavailable period removed.",
                () => setFieldBlock(null, null, period.id))}>Remove</Button>
            </div>)}
          </section>
        </>
      )}
    </div>
  )
}

function HoursEditor({ hours, busy, onSave }: { hours: WorkingHours[]; busy: boolean; onSave: (hours: WorkingHours[]) => void }) {
  const [days, setDays] = useState(() => weekdays.map((_, index) => {
    const window = hours.find((item) => item.day_of_week === index)
    return { day_of_week: index, enabled: Boolean(window), start_time: window?.start_time.slice(0, 5) ?? "", end_time: window?.end_time.slice(0, 5) ?? "" }
  }))
  const invalid = days.some((day) => day.enabled && (!day.start_time || day.end_time <= day.start_time))
  const set = (index: number, patch: Partial<(typeof days)[number]>) =>
    setDays((previous) => previous.map((day) => day.day_of_week === index ? { ...day, ...patch } : day))
  return (
    <section className="panel schedule-form">
      <h2>Regular working hours</h2>
      {days.map((day) => <div className="working-hours-row" key={day.day_of_week}>
        <label className="schedule-check"><input type="checkbox" checked={day.enabled}
          onChange={(event) => set(day.day_of_week, { enabled: event.target.checked })} />{weekdays[day.day_of_week]}</label>
        <Field label="Start"><input type="time" disabled={!day.enabled} value={day.start_time}
          aria-label={`${weekdays[day.day_of_week]} start`} onChange={(event) => set(day.day_of_week, { start_time: event.target.value })} /></Field>
        <Field label="End"><input type="time" disabled={!day.enabled} value={day.end_time}
          aria-label={`${weekdays[day.day_of_week]} end`} onChange={(event) => set(day.day_of_week, { end_time: event.target.value })} /></Field>
      </div>)}
      {invalid && <Notice tone="warning">Set a start and a later end time for each working day.</Notice>}
      <div><Button disabled={busy || invalid} onClick={() => onSave(days.filter((day) => day.enabled).map(({ day_of_week, start_time, end_time }) =>
        ({ day_of_week, start_time, end_time })))}>Save working hours</Button></div>
    </section>
  )
}
