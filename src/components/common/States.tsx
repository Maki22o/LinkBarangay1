// ============================================================================
// LinkBarangay — loading / empty / error / banner states
// ============================================================================

import type { ReactNode } from "react"
import { Icon } from "@/components/common/Icon"

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state-block" role="status">
      <div className="loading-lines" aria-hidden="true"><i /><i /><i /></div>
      <p>{label}</p>
    </div>
  )
}

export function EmptyState({
  title,
  hint,
  icon = "file",
  action,
}: {
  title: string
  hint?: string
  icon?: Parameters<typeof Icon>[0]["name"]
  action?: ReactNode
}) {
  return (
    <div className="state-block">
      <span className="state-icon">
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
      {action && <div className="state-action">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block error">
      <span className="state-icon">
        <Icon name="alert" />
      </span>
      <strong>Something went wrong</strong>
      <p>{message}</p>
      {onRetry && (
        <div className="state-action">
          <button className="link-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

/** Inline notice inside a panel/page (info | warning | success | error). */
export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "success" | "error"
  children: ReactNode
}) {
  return (
    <div className={`inline-notice tone-${tone}`}>
      <Icon name={tone === "success" ? "check" : tone === "error" || tone === "warning" ? "alert" : "help"} size={16} />
      <div>{children}</div>
    </div>
  )
}
