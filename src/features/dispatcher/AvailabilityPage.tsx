import { useEffect, useState } from "react"
import { Button } from "@/components/common/ui"
import { ErrorState, LoadingState, Notice } from "@/components/common/States"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { listAvailability, saveAvailability } from "@/services/availabilityService"

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
type Window = { day_of_week: number; start_time: string; end_time: string; is_available: boolean }
const DEFAULTS = (): Window[] => DAYS.map((_, day_of_week) => ({ day_of_week, start_time: "08:00", end_time: "17:00", is_available: day_of_week > 0 && day_of_week < 6 }))

export function AvailabilityPage() {
  const { profile } = useAuth()
  const data = useAsync(() => profile ? listAvailability(profile.id) : Promise.resolve([]), [profile?.id])
  const [windows, setWindows] = useState<Window[]>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  useEffect(() => {
    if (data.data) setWindows(DEFAULTS().map((fallback) => {
      const stored = data.data?.find((window) => window.day_of_week === fallback.day_of_week)
      return stored ? { day_of_week: stored.day_of_week, start_time: stored.start_time.slice(0,5), end_time: stored.end_time.slice(0,5), is_available: stored.is_available } : { ...fallback, is_available: false }
    }))
  }, [data.data])
  if (data.loading) return <LoadingState label="Loading availability…" />
  if (data.error) return <ErrorState message={data.error} onRetry={data.refresh} />
  const save = async () => {
    if (!profile) return
    if (windows.some((window) => window.is_available && window.start_time >= window.end_time)) {
      setError("Each available day must end after it starts.")
      return
    }
    setSaving(true); setError(""); setNotice("")
    try {
      await saveAvailability(profile.id, windows)
      setNotice("Availability saved. New appointments will be checked against these hours.")
      data.refresh()
    } catch (err) { setError((err as Error).message) }
    finally { setSaving(false) }
  }
  return <div>
    <div className="welcome-row"><div><span className="page-kicker">DEPARTMENT OPERATIONS</span><h1>Dispatcher Availability</h1><p>Set the hours when appointments may be scheduled. Times use Philippine local time.</p></div></div>
    {notice && <Notice tone="success">{notice}</Notice>}{error && <Notice tone="error">{error}</Notice>}
    <section className="panel padded">
      <div className="table-wrap"><table><thead><tr><th>Day</th><th>Available</th><th>Start</th><th>End</th></tr></thead>
        <tbody>{windows.map((window) => <tr key={window.day_of_week}>
          <td><strong>{DAYS[window.day_of_week]}</strong></td>
          <td><input aria-label={`${DAYS[window.day_of_week]} available`} type="checkbox" checked={window.is_available} onChange={(event) => setWindows((current) => current.map((item) => item.day_of_week === window.day_of_week ? { ...item, is_available: event.target.checked } : item))} /></td>
          <td><input aria-label={`${DAYS[window.day_of_week]} start`} type="time" value={window.start_time} disabled={!window.is_available} onChange={(event) => setWindows((current) => current.map((item) => item.day_of_week === window.day_of_week ? { ...item, start_time: event.target.value } : item))} /></td>
          <td><input aria-label={`${DAYS[window.day_of_week]} end`} type="time" value={window.end_time} disabled={!window.is_available} onChange={(event) => setWindows((current) => current.map((item) => item.day_of_week === window.day_of_week ? { ...item, end_time: event.target.value } : item))} /></td>
        </tr>)}</tbody></table></div>
      <div className="modal-actions"><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save availability"}</Button></div>
    </section>
  </div>
}
