// ============================================================================
// LinkBarangay — admin: user management (search, filters, invite via Edge
// Function with graceful unavailable state, edit/suspend/role assignment)
// ============================================================================

import { useEffect, useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button, Status, formatDate } from "@/components/common/ui"
import { Modal } from "@/components/common/Modal"
import { ConfirmDialog } from "@/components/common/Modal"
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/common/States"
import { Field, Select, TextInput } from "@/components/forms/fields"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/lib/supabase"
import { listUsers, adminUpdateUser } from "@/services/profileService"
import { listBarangays, listDepartments } from "@/services/configService"
import {
  createStaffAccount,
  EdgeFunctionUnavailableError,
} from "@/services/staffInviteService"
import { profileRoleLabel, ROLE_LABELS, WORKER_FUNCTION_LABELS } from "@/types"
import type { AccountStatus, Profile, Role, ViewId, WorkerFunction } from "@/types"

const PAGE_SIZE = 10

export function UsersPage({ setView }: { setView: (view: ViewId) => void }) {
  const { profile } = useAuth()
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<Role | "">("")
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "">("")
  const [page, setPage] = useState(1)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<Profile | null>(null)

  const list = useAsync(
    () => listUsers({ search, role: roleFilter, status: statusFilter, page, pageSize: PAGE_SIZE }),
    [search, roleFilter, statusFilter, page],
  )

  // Keep this paginated admin view current without polling the full directory.
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const channel = supabase
      .channel(`admin-users-${profile?.id ?? "anonymous"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lb_profiles" }, () => {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(list.refresh, 180)
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") list.refresh()
      })
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      void supabase.removeChannel(channel)
    }
  }, [profile?.id, list.refresh])

  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const toggleStatus = async (user: Profile) => {
    setActionError(null)
    try {
      await adminUpdateUser(user.id, { status: user.status === "active" ? "suspended" : "active" })
      list.refresh()
    } catch (err) {
      setActionError((err as Error).message)
    }
    setSuspendTarget(null)
  }

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">ADMINISTRATION</span>
          <h1>User Management</h1>
          <p>{total} account{total === 1 ? "" : "s"} registered.</p>
        </div>
        <Button icon="plus" onClick={() => setInviteOpen(true)}>
          Add / invite user
        </Button>
      </div>

      {actionError && <Notice tone="error">{actionError}</Notice>}

      <div className="panel">
        <div className="toolbar">
          <label className="search-input">
            <Icon name="search" size={15} />
            <input
              placeholder="Search name or email…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <select
            className="filter-select"
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value as Role | "")
              setPage(1)
            }}
          >
            <option value="">All roles</option>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as AccountStatus | "")
              setPage(1)
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.refresh} />
        ) : !list.data || list.data.users.length === 0 ? (
          <EmptyState icon="users" title="No accounts match" hint="Adjust the filters above." />
        ) : (
          <>
            <div className="results-summary">
              <span>
                Page {page} of {pages}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th>Registered</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="request-cell">
                          <strong>{user.full_name || "(No name)"}</strong>
                          <small>{user.email}</small>
                        </div>
                      </td>
                      <td>{profileRoleLabel(user)}</td>
                      <td>
                        {user.barangay?.name
                          ? `Brgy ${user.barangay.name}`
                          : user.department?.name ?? "—"}
                      </td>
                      <td>
                        <Status status={user.status} />
                      </td>
                      <td>{formatDate(user.created_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            title="Edit user"
                            onClick={() => setEditing(user)}
                          >
                            <Icon name="settings" size={14} />
                          </button>
                          <button
                            className="icon-button"
                            title={user.status === "active" ? "Suspend" : "Reactivate"}
                            onClick={() => setSuspendTarget(user)}
                          >
                            <Icon name={user.status === "active" ? "close" : "check"} size={14} />
                          </button>
                        </div>
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

      {inviteOpen && (
        <InviteStaffModal
          onClose={() => setInviteOpen(false)}
          onDone={() => {
            setInviteOpen(false)
            list.refresh()
          }}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.refresh()
          }}
          onError={(message) => setActionError(message)}
        />
      )}
      {suspendTarget && (
        <ConfirmDialog
          title={suspendTarget.status === "active" ? "Suspend account" : "Reactivate account"}
          message={
            suspendTarget.status === "active"
              ? `${suspendTarget.full_name || suspendTarget.email} will immediately lose access to all workspaces and data (enforced by row-level security).`
              : `${suspendTarget.full_name || suspendTarget.email} will regain access with their current role.`
          }
          confirmLabel={suspendTarget.status === "active" ? "Suspend" : "Reactivate"}
          danger={suspendTarget.status === "active"}
          onCancel={() => setSuspendTarget(null)}
          onConfirm={() => void toggleStatus(suspendTarget)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function InviteStaffModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const barangays = useAsync(() => listBarangays(), [])
  const departments = useAsync(() => listDepartments(), [])
  const [mode, setMode] = useState<"invite" | "create">("create")
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [mobile, setMobile] = useState("")
  const [role, setRole] = useState<"resident" | "worker">("worker")
  const [workerFunction, setWorkerFunction] = useState<WorkerFunction>("officer")
  const [barangayId, setBarangayId] = useState("")
  const [departmentId, setDepartmentId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string; temporaryPassword?: string } | null>(null)

  const submit = async () => {
    const barangayScoped = role === "worker" && ["secretary", "officer", "captain"].includes(workerFunction)
    const departmentScoped = role === "worker" && ["dispatcher", "field"].includes(workerFunction)
    if (barangayScoped && !barangayId) {
      setError("Select a barangay for this worker function.")
      return
    }
    if (departmentScoped && !departmentId) {
      setError("Select a department for this worker function.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await createStaffAccount({
        mode,
        role,
        email,
        fullName,
        mobile,
        workerFunction: role === "worker" ? workerFunction : null,
        barangayId: role === "worker" ? barangayId || null : null,
        departmentId: role === "worker" ? departmentId || null : null,
      })
      setCreated({ email: result.email, temporaryPassword: result.temporaryPassword })
    } catch (err) {
      if (err instanceof EdgeFunctionUnavailableError) {
        setError(
          `${err.message} Alternative: ask the staff member to register online, then elevate their account here.`,
        )
      } else {
        setError((err as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Modal title="Account ready" onClose={onDone}>
        <Notice tone="success">
          Account created for <b>{created.email}</b>
          {mode === "create" ? " with a confirmed email." : " — they will receive an invitation email."}
        </Notice>
        {created.temporaryPassword && (
          <div className="reference-box">
            <small>TEMPORARY PASSWORD (shown once)</small>
            <strong>{created.temporaryPassword}</strong>
            <button onClick={() => navigator.clipboard?.writeText(created.temporaryPassword ?? "")}>
              Copy
            </button>
          </div>
        )}
        <div className="modal-actions">
          <Button onClick={onDone}>Done</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Add / invite user" onClose={onClose} wide>
      <Field label="How to create the account">
        <Select
          value={mode}
          onChange={(value) => setMode(value as "invite" | "create")}
          options={[
            { value: "create", label: "Create now (admin sets a temporary password)" },
            { value: "invite", label: "Send invitation email (user sets own password)" },
          ]}
        />
      </Field>
      <div className="form-grid">
        <Field label="Full name" required>
          <TextInput value={fullName} onChange={setFullName} required />
        </Field>
        <Field label="Email" required>
          <TextInput type="email" value={email} onChange={setEmail} required />
        </Field>
        <Field label="Role" required>
          <Select
            value={role}
            onChange={(value) => setRole(value as "resident" | "worker")}
            options={[
              { value: "resident", label: "Resident" },
              { value: "worker", label: "Worker" },
            ]}
          />
        </Field>
        {role === "worker" && <Field label="Worker function" required>
          <Select
            value={workerFunction}
            onChange={(value) => setWorkerFunction(value as WorkerFunction)}
            options={Object.entries(WORKER_FUNCTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>}
        <Field label="Mobile (optional)">
          <TextInput value={mobile} onChange={setMobile} />
        </Field>
        {role === "worker" && <Field label="Barangay" hint="Required for front desk, officer, and supervisor workers">
          <Select
            value={barangayId}
            onChange={setBarangayId}
            options={[
              { value: "", label: "None" },
              ...(barangays.data ?? []).map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </Field>}
        {role === "worker" && <Field label="Department" hint="Required for dispatcher and field workers">
          <Select
            value={departmentId}
            onChange={setDepartmentId}
            options={[
              { value: "", label: "None" },
              ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </Field>}
      </div>
      {error && <Notice tone="warning">{error}</Notice>}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !email.trim() || !fullName.trim()} onClick={() => void submit()}>
          {busy ? "Creating…" : mode === "invite" ? "Send invitation" : "Create account"}
        </Button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
function EditUserModal({
  user,
  onClose,
  onSaved,
  onError,
}: {
  user: Profile
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const { profile } = useAuth()
  const barangays = useAsync(() => listBarangays(), [])
  const departments = useAsync(() => listDepartments(), [])
  const [role, setRole] = useState<Role>(user.role)
  const [workerFunction, setWorkerFunction] = useState<WorkerFunction | null>(user.worker_function)
  const [status, setStatus] = useState<AccountStatus>(user.status)
  const [barangayId, setBarangayId] = useState(user.barangay_id ?? "")
  const [departmentId, setDepartmentId] = useState(user.department_id ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The database trigger blocks users from changing their own role/status —
  // mirror that in the UI for clarity.
  const isSelf = profile?.id === user.id

  const save = async () => {
    setError(null)
    if (role === "worker" && !workerFunction) {
      setError("Select a worker function.")
      return
    }
    if (role === "worker" && ["secretary", "officer", "captain"].includes(workerFunction ?? "") && !barangayId) {
      setError("Select a barangay for this worker function.")
      return
    }
    if (role === "worker" && ["dispatcher", "field"].includes(workerFunction ?? "") && !departmentId) {
      setError("Select a department for this worker function.")
      return
    }
    setBusy(true)
    try {
      await adminUpdateUser(user.id, {
        role,
        worker_function: role === "worker" ? workerFunction : null,
        status,
        barangay_id: barangayId || null,
        department_id: departmentId || null,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Edit ${user.full_name || user.email}`} onClose={onClose}>
      {error && <Notice tone="error">{error}</Notice>}
      {isSelf && (
        <Notice tone="warning">
          This is your own account. The database trigger prevents anyone (including
          administrators) from changing their own role, status, or scope.
        </Notice>
      )}
      <Field label="Role">
        {user.role === "admin" ? (
          <div className="reference-box"><strong>System Administrator</strong><small>Admin roles are assigned only through trusted setup.</small></div>
        ) : (
        <Select
          value={role}
          onChange={(value) => {
            const nextRole = value as Role
            setRole(nextRole)
            if (nextRole === "worker" && !workerFunction) setWorkerFunction("officer")
            if (nextRole !== "worker") setWorkerFunction(null)
          }}
          disabled={isSelf}
          options={[
            { value: "resident", label: ROLE_LABELS.resident },
            { value: "worker", label: ROLE_LABELS.worker },
          ]}
        />
        )}
      </Field>
      {role === "worker" && (
        <Field label="Worker function" required>
          <Select
            value={workerFunction ?? ""}
            onChange={(value) => setWorkerFunction(value as WorkerFunction)}
            disabled={isSelf}
            options={Object.entries(WORKER_FUNCTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
      )}
      <Field label="Account status">
        <Select
          value={status}
          onChange={(value) => setStatus(value as AccountStatus)}
          disabled={isSelf}
          options={[
            { value: "active", label: "Active" },
            { value: "suspended", label: "Suspended" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
      </Field>
      <Field label="Barangay">
        <Select
          value={barangayId}
          onChange={setBarangayId}
          disabled={isSelf}
          options={[
            { value: "", label: "None" },
            ...(barangays.data ?? []).map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
      </Field>
      <Field label="Department">
        <Select
          value={departmentId}
          onChange={setDepartmentId}
          disabled={isSelf}
          options={[
            { value: "", label: "None" },
            ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </Field>
      <Notice tone="info">
        Role and status changes are recorded in the audit log. Users can never change their own
        role — this is enforced by a database trigger, not just this form.
      </Notice>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Modal>
  )
}
