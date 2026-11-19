// ============================================================================
// LinkBarangay — modal & confirmation dialog (new, styled like the wireframe)
// ============================================================================

import { useEffect } from "react"
import type { ReactNode } from "react"
import { Icon } from "@/components/common/Icon"
import { Button } from "@/components/common/ui"
import { createPortal } from "react-dom"

export function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal-card ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
      </div>,
    document.body
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="confirm-message">{message}</p>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
