/** A datetime-local control displays the browser's local wall-clock time. */
export function toLocalDateTimeInput(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  const pad = (part: number) => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const MANILA_TIMEZONE = "Asia/Manila"

const manilaParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: MANILA_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
})

export function manilaInput(value: string | number | Date | null | undefined): string {
  if (value == null) return ""
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  const parts = Object.fromEntries(manilaParts.formatToParts(date).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function manilaInstant(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const date = new Date(`${value}:00+08:00`)
  return manilaInput(date) === value ? date.toISOString() : null
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const manilaDisplay = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA_TIMEZONE, dateStyle: "medium", timeStyle: "short",
})

export function manilaDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? manilaDisplay.format(date) : "—"
}
