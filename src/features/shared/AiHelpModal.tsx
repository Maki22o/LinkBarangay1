import { useState } from "react"
import { Button } from "@/components/common/ui"
import { Modal } from "@/components/common/Modal"
import { Notice } from "@/components/common/States"
import { askLinkBarangayHelp } from "@/services/aiHelpService"
import type { HelpChatMessage } from "@/services/aiHelpService"

const greeting: HelpChatMessage = {
  role: "assistant",
  content: "Hi! I’m the LinkBarangay Help Assistant. I can explain how to use the portal, submit or track requests, account approval, appointments, notifications, and the Resident, Barangay Staff, Dispatcher, and Admin workflows.",
}

export function AiHelpModal({ onClose, onCreateSupport }: { onClose: () => void; onCreateSupport: () => void }) {
  const [messages, setMessages] = useState<HelpChatMessage[]>([greeting])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    const content = draft.trim()
    if (!content || busy) return
    const nextMessages = [...messages, { role: "user" as const, content }]
    setMessages(nextMessages)
    setDraft("")
    setBusy(true)
    setError(null)
    try {
      const answer = await askLinkBarangayHelp(nextMessages)
      setMessages((current) => [...current, { role: "assistant", content: answer }])
    } catch (reason) {
      setError((reason as Error).message || "The help assistant is currently unavailable.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="LinkBarangay Help Assistant" onClose={onClose} wide>
      <Notice tone="info">Do not share passwords, one-time codes, valid IDs, or other sensitive personal information in chat.</Notice>
      <div className="ai-help-messages" role="log" aria-live="polite">
        {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`ai-help-message ${message.role}`}><strong>{message.role === "assistant" ? "Help Assistant" : "You"}</strong><p>{message.content}</p></div>)}
        {busy && <div className="ai-help-message assistant"><strong>Help Assistant</strong><p>Thinking…</p></div>}
      </div>
      {error && <Notice tone="warning">{error}</Notice>}
      <label className="ai-help-input">
        <span className="sr-only">Ask the Help Assistant</span>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send() } }} maxLength={1200} rows={3} placeholder="Ask how to use LinkBarangay…" disabled={busy} />
        <small>Press Enter to send · Shift + Enter for a new line</small>
      </label>
      <div className="modal-actions ai-help-actions">
        <Button variant="secondary" onClick={onCreateSupport}>Create support ticket</Button>
        <Button disabled={busy || !draft.trim()} onClick={() => void send()}>{busy ? "Sending…" : "Ask assistant"}</Button>
      </div>
    </Modal>
  )
}
