import { supabase } from "@/lib/supabase"
import { manilaInstant, shiftDay } from "@/lib/dateTime"
import type { DispatchPriority, RequestPriority, RequestStatus } from "@/types"

export interface RequestSchedule {
  status: "pending" | "confirmed" | "rescheduled" | "in_progress" | "completed" | "cancelled"
  preferred_at: string | null
  proposed_at: string | null
  scheduled_at: string | null
  end_at: string | null
  change_reason: string
}

export interface WorkingHours {
  day_of_week: number
  start_time: string
  end_time: string
}

export interface UnavailablePeriod {
  id: string
  starts_at: string
  ends_at: string
}

export interface FieldCapacity {
  id: string
  name: string
  status: "Available" | "Busy" | "Off duty" | "Unavailable"
  workload: number
  slots: string[]
  next_at: string | null
  blocks: Pick<UnavailablePeriod, "starts_at" | "ends_at">[]
  bookings: (Pick<UnavailablePeriod, "starts_at" | "ends_at"> & { reference: string; title: string })[]
}

export interface FieldBooking extends RequestSchedule {
  id: string
  request_id: string
  assignment_id: string | null
  scheduled_at: string
  request: { reference: string; title: string; priority: RequestPriority; status: RequestStatus } | null
  assignee: { full_name: string } | null
}

export interface DispatchQueueRow {
  id: string
  reference: string
  title: string
  description: string
  status: RequestStatus
  priority: RequestPriority
  resident_name: string | null
  category_name: string | null
  location: string
  created_at: string
  scheduled_at: string | null
  preferred_at: string | null
  appointment_status: RequestSchedule["status"] | null
  personnel_name: string | null
  estimated_completion_at: string | null
}

export interface DispatchOverview {
  scheduled: number
  pending: number
  active: number
  completed: number
  overdue: number
  unassigned: number
  priority: number
  workloads: { id: string; name: string; department: string | null; active: number }[]
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const getRequestSchedule = (id: string) =>
  rpc<RequestSchedule | null>("app_request_schedule", { p_request_id: id })

export const listResidentSlots = (categoryId: string, day: string) =>
  rpc<string[]>("app_resident_field_slots", { p_category: categoryId, p_day: day })

export const requestAppointment = (requestId: string, preferredAt: string) =>
  rpc<void>("app_request_field_appointment", { p_request_id: requestId, p_preferred_at: preferredAt })

export const cancelFieldAppointment = (requestId: string, reason: string) =>
  rpc<void>("app_cancel_field_appointment", { p_request_id: requestId, p_reason: reason })

export const proposeFieldAppointment = (requestId: string, date: string, reason: string) =>
  rpc<void>("app_propose_field_appointment", { p_request_id: requestId, p_start: date, p_reason: reason })

export const saveCompletionEstimate = (requestId: string, completionAt: string | null, minutes: number | null, reason: string) =>
  rpc<void>("app_set_completion_estimate", { p_request_id: requestId, p_completion_at: completionAt, p_minutes: minutes, p_reason: reason })

export const saveWorkingDayEstimate = (requestId: string, days: number, reason: string) =>
  rpc<void>("app_set_working_day_estimate", { p_request_id: requestId, p_days: days, p_reason: reason })

export const listFieldCapacity = (departmentId: string, day: string, minutes: number, requestId?: string) =>
  rpc<FieldCapacity[]>("app_field_roster", {
    p_department: departmentId, p_day: day, p_minutes: minutes, p_request_id: requestId ?? null,
  })

export interface FieldAssignmentInput {
  userId: string
  startAt: string | null
  minutes: number | null
  instructions: string
  reason: string
  priority: DispatchPriority
}

export const saveFieldAssignment = (requestId: string, input: FieldAssignmentInput) =>
  rpc<{ assignment_id: string }>("app_save_field_assignment", {
    p_request_id: requestId, p_field_user_id: input.userId, p_start: input.startAt,
    p_minutes: input.minutes, p_notes: input.instructions, p_reason: input.reason, p_priority: input.priority,
  })

export async function listFieldBookings(departmentId: string | null, start: string, end: string, pendingOnly = false) {
  let query = supabase.from("lb_appointments").select(
    "id,request_id,assignment_id,preferred_at,proposed_at,scheduled_at,end_at,status,change_reason,request:lb_service_requests!lb_appointments_request_id_fkey(reference,title,priority,status),assignee:lb_profiles!lb_appointments_field_assignee_id_fkey(full_name)",
  ).eq("is_field_booking", true).order("scheduled_at").order("id")
  if (departmentId) query = query.eq("department_id", departmentId)
  query = pendingOnly ? query.eq("status", "pending") : query
    .gte("scheduled_at", manilaInstant(`${start}T00:00`)).lt("scheduled_at", manilaInstant(`${end}T00:00`))
  const { data, error } = await query.limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as FieldBooking[]
}

export async function listDispatchQueue(departmentId: string, filters: {
  status: string
  priority: string
  category: string
  submitted: string
  scheduled: string
  sort: string
  page: number
}) {
  const pageSize = 25
  let query = supabase.from("lb_dispatch_queue").select("*", { count: "exact" }).eq("department_id", departmentId)
  if (filters.status === "pending") query = query.eq("appointment_status", "pending")
  else if (filters.status) query = query.eq("status", filters.status)
  if (filters.priority === "normal") query = query.in("priority", ["normal", "medium"])
  else if (filters.priority) query = query.eq("priority", filters.priority)
  if (filters.category) query = query.eq("category_id", filters.category)
  for (const [day, field] of [[filters.submitted, "created_at"], [filters.scheduled, "scheduled_at"]]) {
    if (day) query = query.gte(field, manilaInstant(`${day}T00:00`)).lt(field, manilaInstant(`${shiftDay(day, 1)}T00:00`))
  }
  const order = filters.sort === "priority" ? "dispatch_priority_order" : filters.sort
  const { data, count, error } = await query.order(order, { ascending: order === "scheduled_at", nullsFirst: false })
    .order("id").range(filters.page * pageSize, (filters.page + 1) * pageSize - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as DispatchQueueRow[], hasNext: (count ?? 0) > (filters.page + 1) * pageSize }
}

export async function listMyAvailability(userId: string) {
  const [hours, blocks] = await Promise.all([
    supabase.from("lb_field_working_hours").select("day_of_week,start_time,end_time").eq("personnel_id", userId).order("day_of_week"),
    supabase.from("lb_field_unavailability").select("id,starts_at,ends_at").eq("personnel_id", userId)
      .gt("ends_at", new Date().toISOString()).order("starts_at"),
  ])
  if (hours.error || blocks.error) throw new Error((hours.error ?? blocks.error)?.message)
  return { hours: (hours.data ?? []) as WorkingHours[], blocks: (blocks.data ?? []) as UnavailablePeriod[] }
}

export const saveFieldHours = (hours: WorkingHours[]) => rpc<void>("app_save_field_hours", { p_hours: hours })
export const setFieldBlock = (start: string | null, end: string | null, removeId?: string) =>
  rpc<void>("app_set_field_block", { p_start: start, p_end: end, p_remove_id: removeId ?? null })

export const getDispatchOverview = () => rpc<DispatchOverview>("app_dispatch_overview")
