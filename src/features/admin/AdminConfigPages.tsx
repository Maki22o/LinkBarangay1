// ============================================================================
// LinkBarangay — admin: roles & permissions view, configuration management
// (barangays, departments, categories, routing, SLA), reports, audit logs.
// All writes are enforced again by RLS (admin-only) server-side.
// ============================================================================

import { useEffect, useState } from "react"
import { Icon, type IconName } from "@/components/common/Icon"
import { Button, MetricCard, Status, formatDateTime } from "@/components/common/ui"
import { Modal } from "@/components/common/Modal"
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/common/States"
import { Field, Select, TextArea, TextInput } from "@/components/forms/fields"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { useRequestRealtimeRefresh } from "@/hooks/useRequestRealtime"
import { FieldBookingCalendar } from "@/features/dispatcher/FieldBookingCalendar"
import { getDispatchOverview } from "@/services/schedulingService"
import { supabase } from "@/lib/supabase"
import { ROLE_PERMISSIONS } from "@/permissions/permissions"
import { hasPermission } from "@/permissions/permissions"
import {
  listAuditLogs,
} from "@/services/auditService"
import {
  getSettings,
  listBarangays,
  listCategories,
  listDepartments,
  upsertBarangay,
  upsertCategory,
  upsertDepartment,
  upsertSetting,
} from "@/services/configService"
import { listRequests } from "@/services/requestService"
import { ROLE_LABELS } from "@/types"
import type { Barangay, Department, ServiceCategory, ViewId } from "@/types"

// ---------------------------------------------------------------------------
// Roles & permissions (read-only matrix; server policies are the enforcer)
// ---------------------------------------------------------------------------
export function RolesPage() {
  const allPermissions = Array.from(
    new Set(Object.values(ROLE_PERMISSIONS).flat()),
  ).sort()

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">ADMINISTRATION</span>
          <h1>Roles &amp; Permissions</h1>
          <p>
            Canonical roles and what each may do. Frontend checks are a mirror — the same rules
            are enforced by row-level security policies and database triggers.
          </p>
        </div>
      </div>

      <Notice tone="info">
        Deny-by-default: anything not listed here is denied. Role assignment happens only in
        User Management (or the staff-invite service), and every change is audited.
      </Notice>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Permission</th>
                {Object.keys(ROLE_PERMISSIONS).map((role) => (
                  <th key={role}>{ROLE_LABELS[role as keyof typeof ROLE_LABELS]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allPermissions.map((permission) => (
                <tr key={permission}>
                  <td>
                    <div className="request-cell">
                      <strong>{permission}</strong>
                    </div>
                  </td>
                  {Object.keys(ROLE_PERMISSIONS).map((role) => (
                    <td key={role}>
                      {ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS].includes(
                        permission as never,
                      ) ? (
                        <Icon name="check" size={15} />
                      ) : (
                        <span className="muted-note">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Configuration hub + sub-pages
// ---------------------------------------------------------------------------
export function ConfigurationPage({ setView }: { setView: (view: ViewId) => void }) {
  const [connectingDrive, setConnectingDrive] = useState(false)
  const cards: { icon: IconName; title: string; text: string; view: ViewId }[] = [
    { icon: "pin", title: "Barangays", text: "Manage barangay records.", view: "barangays" },
    { icon: "briefcase", title: "Departments", text: "City departments and response teams.", view: "departments" },
    { icon: "file", title: "Service Categories", text: "Categories, routing, and SLA targets.", view: "categories" },
    { icon: "route", title: "Routing Rules", text: "How verified requests are routed.", view: "routing" },
    { icon: "clock", title: "SLA Settings", text: "Verification and resolution deadlines.", view: "sla-settings" },
  ]
  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">ADMINISTRATION</span>
          <h1>Configuration</h1>
          <p>System-wide reference data and workflow settings.</p>
        </div>
      </div>
      <div className="config-grid">
        {cards.map((card) => (
          <button className="config-card" key={card.title} onClick={() => setView(card.view)}>
            <span>
              <Icon name={card.icon} />
            </span>
            <div>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </div>
            <Icon name="chevron" size={16} />
          </button>
        ))}
      </div>
      <section className="backup-panel" aria-labelledby="backup-title">
        <div className="backup-panel-head">
          <div className="backup-heading">
            <span className="backup-icon"><Icon name="upload" size={21} /></span>
            <div>
              <span className="page-kicker">DATA PROTECTION</span>
              <h2 id="backup-title">Off-site backups</h2>
              <p>Your LinkBarangay data is copied securely to Google Drive every day.</p>
            </div>
          </div>
          <span className="backup-status"><Icon name="check" size={14} /> Backup enabled</span>
        </div>

        <div className="backup-details">
          <div>
            <span>Backup destination</span>
            <strong>Google Drive</strong>
          </div>
          <div>
            <span>Schedule</span>
            <strong>Daily, 2:00 AM</strong>
          </div>
          <div>
            <span>Included data</span>
            <strong>Database and private files</strong>
          </div>
        </div>

        <div className="backup-footer">
          <p>Automatic backups run in the background. Reconnect only if you change the Google Drive account.</p>
          <Button disabled={connectingDrive} onClick={async () => {
          setConnectingDrive(true)
          try {
            const { data: { session } } = await supabase.auth.getSession()
            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-oauth-start`, {
              method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
            })
            const body = await response.json()
            if (!response.ok || !body.authorizationUrl) throw new Error(body.error ?? "Could not start Google Drive authorization")
            window.location.assign(body.authorizationUrl)
          } catch (error) { window.alert(error instanceof Error ? error.message : "Could not connect Google Drive") }
          finally { setConnectingDrive(false) }
        }}>{connectingDrive ? "Opening Google…" : "Reconnect Google Drive"}</Button>
        </div>
      </section>
    </div>
  )
}

export function BarangaysPage() {
  return (
    <ReferenceManager
      kicker="CONFIGURATION"
      title="Barangays"
      subtitle="Barangay records used for registration and scoping."
      load={() => listBarangays()}
      renderName={(row: Barangay) => row.name}
      renderSub={(row: Barangay) => row.code || "—"}
      isActive={(row: Barangay) => row.is_active}
      onSave={async (row) => {
        await upsertBarangay({ id: row.id, name: row.name, code: row.code, is_active: row.is_active })
      }}
      fields={[
        { key: "name", label: "Barangay name", required: true },
        { key: "code", label: "Code" },
      ]}
      blank={{ name: "", code: "", city: "", is_active: true }}
    />
  )
}

export function DepartmentsPage() {
  return (
    <ReferenceManager
      kicker="CONFIGURATION"
      title="Departments"
      subtitle="City departments that receive routed requests."
      load={() => listDepartments()}
      renderName={(row: Department) => row.name}
      renderSub={(row: Department) => row.code || "—"}
      isActive={(row: Department) => row.is_active}
      onSave={async (row) => {
        await upsertDepartment({
          id: row.id,
          name: row.name,
          code: row.code,
          description: row.description,
          is_active: row.is_active,
        })
      }}
      fields={[
        { key: "name", label: "Department name", required: true },
        { key: "code", label: "Code" },
        { key: "description", label: "Description", multiline: true },
      ]}
      blank={{ name: "", code: "", description: "", is_active: true }}
    />
  )
}

export function CategoriesPage() {
  const departments = useAsync(() => listDepartments(), [])
  return (
    <ReferenceManager
      kicker="CONFIGURATION"
      title="Service Categories"
      subtitle="Each category routes to a department and carries an SLA target."
      load={() => listCategories(true)}
      renderName={(row: ServiceCategory) => row.name}
      renderSub={(row: ServiceCategory) =>
        `${row.department?.name ?? "Unrouted"} · ${row.sla_hours}h`
      }
      isActive={(row: ServiceCategory) => row.is_active}
      onSave={async (row) => {
        await upsertCategory({
          id: row.id,
          name: row.name,
          slug: row.slug,
          description: row.description,
          department_id: row.department_id,
          sla_hours: row.sla_hours,
          field_appointment_minutes: row.field_appointment_minutes ?? null,
          is_active: row.is_active,
        })
      }}
      fields={[
        { key: "name", label: "Category name", required: true },
        { key: "slug", label: "Slug (unique)", required: true },
        { key: "description", label: "Description", multiline: true },
        { key: "sla_hours", label: "SLA hours", kind: "number" },
      ]}
      extraField={(value, update) => (
        <>
        <Field label="Routed department">
          <Select
            value={value.department_id ?? ""}
            onChange={(next) => update({ ...value, department_id: next || null })}
            options={[
              { value: "", label: "None" },
              ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </Field>
        <Field label="Field appointment duration in minutes" hint="15–480 minutes. Leave empty to disable resident appointment requests.">
          <input type="number" min={15} max={480} step={1} value={value.field_appointment_minutes ?? ""}
            onChange={(event) => update({ ...value, field_appointment_minutes: event.target.value ? Number(event.target.value) : null })} />
        </Field>
        </>
      )}
      blank={{
        name: "",
        slug: "",
        description: "",
        department_id: null,
        sla_hours: 72,
        field_appointment_minutes: null,
        is_active: true,
      }}
    />
  )
}

export function RoutingPage() {
  const settings = useAsync(async () => {
    const [routing, categories] = await Promise.all([getSettings("routing"), listCategories(true)])
    return { routing, categories }
  }, [])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState("category_department")
  const [fallback, setFallback] = useState("")

  const current = settings.data?.routing as Record<string, unknown> | undefined
  const currentMode = (current?.mode as string) ?? mode
  const currentFallback = (current?.default_department as string) ?? fallback
  const categories = settings.data?.categories ?? []

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await upsertSetting("routing", {
        mode: currentMode,
        default_department: currentFallback || null,
      })
      setNotice("Routing rules saved.")
      settings.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminSubPage kicker="CONFIGURATION" title="Routing Rules" subtitle="How verified requests reach departments.">
      {settings.loading ? (
        <LoadingState />
      ) : settings.error ? (
        <ErrorState message={settings.error} onRetry={settings.refresh} />
      ) : (
        <>
          {notice && <Notice tone="success">{notice}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Routing mode">
            <Select
              value={currentMode}
              onChange={setMode}
              options={[
                { value: "category_department", label: "By service category → department" },
                { value: "manual", label: "Manual routing by officers" },
              ]}
            />
          </Field>
          <Field label="Fallback department" hint="Used when a category has no routing target">
            <Select
              value={currentFallback}
              onChange={setFallback}
              options={[
                { value: "", label: "None" },
                ...categories.map((c) => ({ value: c.department_id ?? "", label: c.name })),
              ]}
            />
          </Field>
          <Notice tone="info">
            Category→department routing is defined on each service category. The workflow RPC
            reads these values when requests are routed.
          </Notice>
          <div className="modal-actions">
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save routing rules"}
            </Button>
          </div>
        </>
      )}
    </AdminSubPage>
  )
}

export function SlaSettingsPage() {
  const settings = useAsync(() => getSettings("sla"), [])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = (settings.data ?? {}) as Record<string, unknown>

  const fields: { key: string; label: string; hint?: string }[] = [
    { key: "verification_hours", label: "Verification window (hours)" },
    { key: "routing_hours", label: "Routing window (hours)" },
    { key: "resolution_days", label: "Resolution target (days)" },
    { key: "reopen_days", label: "Reopen window after close (days)" },
  ]

  const save = async (values: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await upsertSetting("sla", values)
      setNotice("SLA settings saved.")
      settings.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminSubPage kicker="CONFIGURATION" title="SLA Settings" subtitle="Deadlines used across the request workflow.">
      {settings.loading ? (
        <LoadingState />
      ) : settings.error ? (
        <ErrorState message={settings.error} onRetry={settings.refresh} />
      ) : (
        <>
          {notice && <Notice tone="success">{notice}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          <SlaForm fields={fields} current={current} busy={busy} onSave={save} />
        </>
      )}
    </AdminSubPage>
  )
}

function SlaForm({
  fields,
  current,
  busy,
  onSave,
}: {
  fields: { key: string; label: string; hint?: string }[]
  current: Record<string, unknown>
  busy: boolean
  onSave: (values: Record<string, unknown>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const field of fields) {
      next[field.key] = String(current[field.key] ?? "")
    }
    setValues(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings_stable_key(current)])

  return (
    <>
      <div className="form-grid">
        {fields.map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint}>
            <input
              type="number"
              min={1}
              value={values[field.key] ?? ""}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
            />
          </Field>
        ))}
      </div>
      <div className="modal-actions">
        <Button
          disabled={busy}
          onClick={() =>
            onSave(
              Object.fromEntries(
                Object.entries(values)
                  .filter(([, value]) => value !== "")
                  .map(([key, value]) => [key, Number(value)]),
              ),
            )
          }
        >
          {busy ? "Saving…" : "Save SLA settings"}
        </Button>
      </div>
    </>
  )
}

function settings_stable_key(current: Record<string, unknown>): string {
  return JSON.stringify(current)
}

// ---------------------------------------------------------------------------
// Generic reference-table manager (barangays / departments / categories)
// ---------------------------------------------------------------------------
interface ReferenceField {
  key: string
  label: string
  required?: boolean
  multiline?: boolean
  kind?: "text" | "number"
}

function ReferenceManager<T extends { id?: string; is_active: boolean }>({
  kicker,
  title,
  subtitle,
  load,
  renderName,
  renderSub,
  isActive,
  onSave,
  fields,
  blank,
  extraField,
}: {
  kicker: string
  title: string
  subtitle: string
  load: () => Promise<T[]>
  renderName: (row: T) => string
  renderSub: (row: T) => string
  isActive: (row: T) => boolean
  onSave: (row: T) => Promise<void>
  fields: ReferenceField[]
  blank: Partial<T> & { is_active: boolean }
  extraField?: (value: T, update: (next: T) => void) => React.ReactNode
}) {
  const list = useAsync(load, [])
  const [editing, setEditing] = useState<T | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      await onSave(editing)
      setEditing(null)
      list.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">{kicker}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <Button
          icon="plus"
          onClick={() => {
            setIsNew(true)
            setEditing({ ...blank } as T)
          }}
        >
          Add new
        </Button>
      </div>
      <div className="panel">
        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.refresh} />
        ) : !list.data || list.data.length === 0 ? (
          <EmptyState icon="pin" title={`No ${title.toLowerCase()} yet`} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Details</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="request-cell">
                        <strong>{renderName(row)}</strong>
                      </div>
                    </td>
                    <td>{renderSub(row)}</td>
                    <td>
                      <Status status={isActive(row) ? "active" : "inactive"} />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        title="Edit"
                        onClick={() => {
                          setIsNew(false)
                          setEditing({ ...row })
                        }}
                      >
                        <Icon name="settings" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <Modal title={isNew ? `New ${title.replace(/s$/, "")}` : `Edit ${renderName(editing)}`} onClose={() => setEditing(null)}>
          {error && <Notice tone="error">{error}</Notice>}
          {fields.map((field) => (
            <Field key={field.key} label={field.label} required={field.required}>
              {field.multiline ? (
                <TextArea
                  value={String(editing[field.key as keyof T] ?? "")}
                  onChange={(next) => setEditing({ ...editing, [field.key]: next })}
                  rows={3}
                />
              ) : (
                <input
                  type={field.kind === "number" ? "number" : "text"}
                  value={String(editing[field.key as keyof T] ?? "")}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      [field.key]:
                        field.kind === "number" ? Number(event.target.value) : event.target.value,
                    })
                  }
                />
              )}
            </Field>
          ))}
          {extraField?.(editing, setEditing)}
          <Field label="Active">
            <Select
              value={editing.is_active ? "true" : "false"}
              onChange={(next) => setEditing({ ...editing, is_active: next === "true" })}
              options={[
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ]}
            />
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function AdminSubPage({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker: string
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="generic-page">
      <div className="welcome-row">
        <div>
          <span className="page-kicker">{kicker}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="panel form-section">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reports & analytics (admin: system-wide; uses the caller's RLS scope)
// ---------------------------------------------------------------------------
export function ReportsPage({ openRequest }: { openRequest: (id: string) => void }) {
  const { profile } = useAuth()
  const canAudit = hasPermission(profile, "audit.view")
  const report = useAsync(async () => {
    if (!profile) throw new Error("Not signed in")
    const firstPage = await listRequests(profile, { pageSize: 100 })
    const pageCount = Math.ceil(firstPage.total / firstPage.pageSize)
    const remainingPages = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        listRequests(profile, { page: index + 2, pageSize: 100 }),
      ),
    )
    const requests = [firstPage, ...remainingPages].flatMap((page) => page.requests)
    const byStatus = new Map<string, number>()
    const byCategory = new Map<string, number>()
    const byDepartment = new Map<string, number>()
    let overdue = 0
    let escalated = 0
    for (const request of requests) {
      byStatus.set(request.status, (byStatus.get(request.status) ?? 0) + 1)
      const category = request.category?.name ?? "Uncategorized"
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1)
      const department = request.department?.name ?? "Not routed"
      byDepartment.set(department, (byDepartment.get(department) ?? 0) + 1)
      if (
        request.due_at &&
        new Date(request.due_at) < new Date() &&
        !["resolved", "closed", "rejected"].includes(request.status)
      )
        overdue += 1
      if (request.escalation_count > 0) escalated += 1
    }
    return { requests, byStatus, byCategory, byDepartment, overdue, escalated }
  }, [profile?.id])

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refreshSoon = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(report.refresh, 200)
    }
    const channel = supabase
      .channel(`admin-report-${profile?.id ?? "anonymous"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lb_service_requests" }, refreshSoon)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") report.refresh()
      })
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      void supabase.removeChannel(channel)
    }
  }, [profile?.id, report.refresh])

  if (report.loading) return <LoadingState label="Building report…" />
  if (report.error) return <ErrorState message={report.error} onRetry={report.refresh} />
  if (!report.data) return null

  const { requests, byStatus, byCategory, byDepartment, overdue, escalated } = report.data
  const total = requests.length || 1

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">ADMINISTRATION</span>
          <h1>Reports &amp; Analytics</h1>
          <p>
            {requests.length} requests in scope · {overdue} overdue · {escalated} escalated.
          </p>
        </div>
        <Button icon="history" variant="secondary" onClick={report.refresh}>
          Refresh
        </Button>
      </div>

      {profile?.role === "admin" && <DispatchMonitoring openRequest={openRequest} />}

      <div className="dashboard-grid">
        <section className="panel span-two">
          <div className="panel-head">
            <div>
              <h2>Status distribution</h2>
              <p>Share of requests by workflow stage</p>
            </div>
          </div>
          <div className="report-bars">
            {Array.from(byStatus.entries()).map(([status, count]) => (
              <div className="report-row" key={status}>
                <span className="report-label">{status.replaceAll("_", " ")}</span>
                <div className="meter">
                  <i style={{ width: `${Math.round((count / total) * 100)}%` }} />
                </div>
                <b>{count}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel activity-panel">
          <div className="panel-head">
            <div>
              <h2>Top categories</h2>
              <p>Where requests come from</p>
            </div>
          </div>
          <div className="report-bars padded">
            {Array.from(byCategory.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([category, count]) => (
                <div className="report-row" key={category}>
                  <span className="report-label">{category}</span>
                  <b>{count}</b>
                </div>
              ))}
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <div>
            <h2>Department load</h2>
            <p>Routed requests per department</p>
          </div>
        </div>
        <div className="report-bars padded">
          {Array.from(byDepartment.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([department, count]) => (
              <div className="report-row" key={department}>
                <span className="report-label">{department}</span>
                <div className="meter">
                  <i style={{ width: `${Math.round((count / total) * 100)}%` }} />
                </div>
                <b>{count}</b>
              </div>
            ))}
        </div>
      </section>

      {canAudit && (
        <Notice tone="info">
          Tip: audit-sensitive actions are in Audit Logs. Sensitive administrative actions are
          recorded there automatically.
        </Notice>
      )}
    </div>
  )
}

function DispatchMonitoring({ openRequest }: { openRequest: (id: string) => void }) {
  const overview = useAsync(getDispatchOverview, [])
  useRequestRealtimeRefresh(overview.refresh)
  useRequestRealtimeRefresh(overview.refresh, { table: "lb_assignments" })
  useRequestRealtimeRefresh(overview.refresh, { table: "lb_appointments" })
  const [showHistory, setShowHistory] = useState(false)
  const data = overview.data
  return (
    <section className="schedule-form">
      <div className="panel schedule-form">
        <div className="panel-head">
          <div><h2>Field scheduling and workloads</h2></div>
          <Button variant="secondary" onClick={() => setShowHistory((shown) => !shown)}>
            {showHistory ? "Hide appointment history" : "View appointment history"}
          </Button>
        </div>
        {overview.error && <ErrorState message={overview.error} onRetry={overview.refresh} />}
        {!data && overview.loading && <LoadingState />}
        {data && <>
          <div className="metrics-grid">
            <MetricCard label="Scheduled appointments" value={data.scheduled} icon="clock" />
            <MetricCard label="Pending appointments" value={data.pending} icon="clock" tone="amber" />
            <MetricCard label="Active jobs" value={data.active} icon="briefcase" />
            <MetricCard label="Completed jobs" value={data.completed} icon="check" tone="green" />
            <MetricCard label="Overdue jobs" value={data.overdue} icon="alert" tone="amber" />
            <MetricCard label="Unassigned requests" value={data.unassigned} icon="route" />
            <MetricCard label="High and urgent requests" value={data.priority} icon="alert" />
          </div>
          {data.workloads.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Personnel</th><th>Department</th><th>Open jobs</th></tr></thead>
            <tbody>{data.workloads.map((worker) => <tr key={worker.id}>
              <td>{worker.name}</td><td>{worker.department ?? "—"}</td><td>{worker.active}</td>
            </tr>)}</tbody>
          </table></div>}
        </>}
      </div>
      {showHistory && <FieldBookingCalendar departmentId={null} openRequest={openRequest} includeCapacity={false} />}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------
export function AuditPage() {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const logs = useAsync(
    () => listAuditLogs({ search, page, pageSize: 30 }),
    [search, page],
  )
  const pages = Math.max(1, Math.ceil((logs.data?.total ?? 0) / 30))

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">ADMINISTRATION</span>
          <h1>Audit Logs</h1>
          <p>Account changes, role updates, and administrative actions.</p>
        </div>
      </div>
      <div className="panel">
        <div className="toolbar">
          <label className="search-input">
            <Icon name="search" size={15} />
            <input
              placeholder="Search actor or entity id…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />
          </label>
        </div>
        {logs.loading ? (
          <LoadingState />
        ) : logs.error ? (
          <ErrorState message={logs.error} onRetry={logs.refresh} />
        ) : !logs.data || logs.data.logs.length === 0 ? (
          <EmptyState
            icon="history"
            title="No audit entries yet"
            hint="Role and status changes, staff invites, and admin transitions appear here."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.created_at)}</td>
                      <td>{log.actor_name}</td>
                      <td>
                        <div className="request-cell">
                          <strong>{log.action}</strong>
                        </div>
                      </td>
                      <td>
                        {log.entity_type}
                        <br />
                        <small className="ref">{log.entity_id.slice(0, 8)}</small>
                      </td>
                      <td>
                        <code className="audit-details">
                          {JSON.stringify(log.details).slice(0, 90)}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="pagination">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  ‹
                </button>
                <span className="current">{page}</span>
                <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  ›
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
