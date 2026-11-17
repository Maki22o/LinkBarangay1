// ============================================================================
// LinkBarangay — form field primitives (same classes as the wireframe)
// ============================================================================

import { useState } from "react"
import type { ReactNode } from "react"
import { Icon } from "@/components/common/Icon"

export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span>
        {label} {required && <b>*</b>}
      </span>
      {children}
      {hint && !error && <em className="field-help">{hint}</em>}
      {error && <em className="field-help field-error">{error}</em>}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  name,
  required,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  name?: string
  required?: boolean
  disabled?: boolean
}) {
  return (
    <input
      name={name}
      type={type}
      value={value}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/** Password input with an accessible, local-only visibility toggle. */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  name,
  required,
}: Omit<Parameters<typeof TextInput>[0], "type" | "disabled">) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="password-input">
      <input
        name={name}
        type={visible ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="password-visibility"
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
      >
        <Icon name="eye" size={18} />
      </button>
    </span>
  )
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  required,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  required?: boolean
}) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      rows={rows}
      required={required}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option value={option.value} key={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
