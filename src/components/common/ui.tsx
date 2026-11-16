// ============================================================================
// LinkBarangay — small shared UI primitives (same classes as the wireframe)
// ============================================================================

import type { ReactNode } from "react"
import { Icon, type IconName } from "@/components/common/Icon"
import { PRIORITY_LABELS, STATUS_LABELS } from "@/types"
import type { RequestPriority, RequestStatus } from "@/types"

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      {!compact && (
        <span className="brand-name">
          Link<span>Barangay</span>
        </span>
      )}
    </div>
  )
}

export function Button({
  children,
  variant = "primary",
  icon,
  onClick,
  type = "button",
  className = "",
  disabled,
}: {
  children: ReactNode
  variant?: "primary" | "secondary" | "ghost" | "danger"
  icon?: IconName
  onClick?: () => void
  type?: "button" | "submit"
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type={type}
      className={`button button-${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  )
}

export function Status({ status }: { status: string }) {
  const key = status.toLowerCase().replaceAll(" ", "-").replaceAll("_", "-")
  return (
    <span className={`status status-${key}`}>
      <i />
      {STATUS_LABELS[status as RequestStatus] ??
        status.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
    </span>
  )
}

export function Priority({ level }: { level: string }) {
  return <em className={`priority ${level === "medium" ? "normal" : level}`}>{PRIORITY_LABELS[level as RequestPriority] ?? level}</em>
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  icon?: IconName
  tone?: "amber" | "purple" | "green" | "red" | ""
}) {
  return (
    <div className={`metric-card ${tone ? `tone-${tone}` : ""}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
      {icon && (
        <i>
          <Icon name={icon} />
        </i>
      )}
    </div>
  )
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function formatRef(reference: string | null | undefined): string {
  return reference ?? "Pending reference"
}
