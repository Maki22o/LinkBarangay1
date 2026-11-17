import { supabase } from "@/lib/supabase"

export interface SupportRequestInput {
  subject: string
  category: "account" | "request" | "technical" | "other"
  description: string
  contact: string
}

/** Creates a support record owned by the signed-in account. RLS also enforces ownership. */
export async function submitSupportRequest(input: SupportRequestInput): Promise<void> {
  const { error } = await supabase.from("lb_support_requests").insert({
    subject: input.subject.trim(),
    category: input.category,
    description: input.description.trim(),
    contact: input.contact.trim() || null,
  })
  if (error) throw new Error(error.message)
}
