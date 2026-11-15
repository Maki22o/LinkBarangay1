import { supabase } from "@/lib/supabase"

export interface AvailabilityWindow {
  id?: string
  dispatcher_id: string
  day_of_week: number
  start_time: string
  end_time: string
  is_available: boolean
}

export async function listAvailability(dispatcherId: string): Promise<AvailabilityWindow[]> {
  const { data, error } = await supabase.from("lb_dispatcher_availability")
    .select("id,dispatcher_id,day_of_week,start_time,end_time,is_available")
    .eq("dispatcher_id", dispatcherId).order("day_of_week").order("start_time")
  if (error) throw new Error(error.message)
  return (data ?? []) as AvailabilityWindow[]
}

export async function saveAvailability(dispatcherId: string, windows: Omit<AvailabilityWindow,"id"|"dispatcher_id">[]) {
  const { error } = await supabase.rpc("app_save_dispatcher_availability", {
    p_windows: windows.filter((window) => window.is_available).map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time })),
  })
  if (error) throw new Error(error.message)
}
