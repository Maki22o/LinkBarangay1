// ============================================================================
// LinkBarangay — appointment scheduling service (secretary front desk)
// ============================================================================

import { supabase } from "@/lib/supabase"
import type { Appointment } from "@/types"

const APPOINTMENT_SELECT = `
  id, barangay_id, resident_id, request_id, scheduled_at, purpose, status,
  created_by, notes, created_at,
  resident:lb_profiles!lb_appointments_resident_id_profile_fkey(id, full_name)
`

export async function listAppointments(barangayId: string | null): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from("lb_appointments")
    .select(APPOINTMENT_SELECT)
    .eq("is_field_booking", false)
    .eq("barangay_id", barangayId ?? "00000000-0000-0000-0000-000000000000")
    .order("scheduled_at", { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Appointment[]
}

export async function createAppointment(input: {
  barangayId: string
  residentId?: string | null
  requestId?: string | null
  scheduledAt: string
  purpose: string
  notes?: string
}): Promise<void> {
  const { error } = await supabase.from("lb_appointments").insert({
    barangay_id: input.barangayId,
    resident_id: input.residentId ?? null,
    request_id: input.requestId ?? null,
    scheduled_at: input.scheduledAt,
    purpose: input.purpose.trim(),
    notes: (input.notes ?? "").trim(),
    status: "scheduled",
  })
  if (error) throw new Error(error.message)
}

export async function updateAppointmentStatus(
  id: string,
  status: "completed" | "cancelled" | "no_show",
): Promise<void> {
  const { error } = await supabase.from("lb_appointments").update({ status }).eq("id", id)
  if (error) throw new Error(error.message)
}
