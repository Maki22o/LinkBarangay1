import { supabase } from "@/lib/supabase"

export type HelpChatMessage = { role: "user" | "assistant"; content: string }

/** Sends only the support conversation to the server-side OpenRouter proxy. */
export async function askLinkBarangayHelp(messages: HelpChatMessage[]): Promise<string> {
  // Supabase's Functions client attaches the active session and handles the
  // browser preflight/CORS contract for the project endpoint.
  const { data, error } = await supabase.functions.invoke("linkbarangay-help-chat", { body: { messages } })
  if (error) {
    let message = error.message || "The help assistant is unavailable."
    if (error.context instanceof Response) {
      const body = await error.context.clone().json().catch(() => null)
      if (typeof body?.error === "string") message = body.error
    }
    throw new Error(message)
  }
  if (!data?.answer || typeof data.answer !== "string") {
    throw new Error(data?.error || "The help assistant returned an invalid response.")
  }
  return data.answer
}
