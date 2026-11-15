// ============================================================================
// LinkBarangay — dispatcher workspace: department queue (assign), personnel,
// and workload/SLA monitoring.
// ============================================================================

import { useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button, MetricCard, Status, formatRef, formatDateTime } from "@/components/common/ui"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/States"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { assignmentStateLabel, isActionableAssignment } from "@/lib/assignmentState"
import { listRequests } from "@/services/requestService"
import { listDepartmentAssignments } from "@/services/assignmentService"
import { listFieldPersonnel } from "@/services/profileService"
import type { ViewId } from "@/types"

export function DeptQueuePage({
  setView,
  openRequest,
}: {
  setView: (view: ViewId) => void
  openRequest: (id: string) => void
}) {
  const { profile } = useAuth()
  const list = useAsync(
    () =>
      profile
        ? listRequests(profile, { pageSize: 100 })
        : Promise.resolve({ requests: [], total: 0, page: 1, pageSize: 100 }),
    [profile?.id],
  )

  if (list.loading) return <LoadingState label="Loading department queue…" />
  if (list.error) return <ErrorState message={list.error} onRetry={list.refresh} />

  const rows = (list.data?.requests ?? [])
    .filter((r) => ["verified", "assigned", "in_progress"].includes(r.status))
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""))

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">DEPARTMENT OPERATIONS</span>
          <h1>Department Queue</h1>
          <p>
            Verified and routed requests for {profile?.department?.name ?? "your department"}.
          </p>
        </div>
      </div>
      <div className="panel">
        {rows.length === 0 ? (
          <EmptyState
            icon="check"
            title="Queue is clear"
            hint="Requests routed to your department appear here."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Request</th>
                  <th>Location</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((request) => {
                  const overdue =
                    request.due_at &&
                    new Date(request.due_at) < new Date() &&
                    request.status !== "in_progress"
                  return (
                    <tr key={request.id}>
                      <td className="ref">{formatRef(request.reference)}</td>
                      <td>
                        <div className="request-cell">
                          <strong>{request.title}</strong>
                          <small>{request.category?.name ?? "Uncategorized"}</small>
                        </div>
                      </td>
                      <td>{request.location || "—"}</td>
                      <td>
                        {request.due_at ? formatDateTime(request.due_at) : "—"}
                        {overdue && <em className="priority high"> overdue</em>}
                      </td>
                      <td>
                        <Status status={request.status} />
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label="Open request"
                          onClick={() => openRequest(request.id)}
                        >
                          <Icon name="eye" size={15} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
export function AssignmentsPage({
  setView,
  openRequest,
}: {
  setView: (view: ViewId) => void
  openRequest: (id: string) => void
}) {
  const { profile } = useAuth()
  const assignments = useAsync(
    () => listDepartmentAssignments(profile?.department_id ?? null),
    [profile?.id],
  )
  const [filter, setFilter] = useState<"active" | "completed" | "declined" | "all">("active")

  if (assignments.loading) return <LoadingState label="Loading assignments…" />
  if (assignments.error)
    return <ErrorState message={assignments.error} onRetry={assignments.refresh} />

  const all = assignments.data ?? []
  const rows = all.filter((job) => {
    if (filter === "active") return isActionableAssignment(job)
    if (filter === "completed") return job.status === "completed"
    if (filter === "declined") return job.status === "declined"
    return true
  })

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">DEPARTMENT OPERATIONS</span>
          <h1>Assignments</h1>
          <p>Jobs dispatched to field personnel. Assign new jobs from a request's detail page.</p>
        </div>
      </div>
      <div className="panel">
        <div className="queue-tabs">
          {(["active", "completed", "declined", "all"] as const).map((tab) => (
            <button className={filter === tab ? "active" : ""} key={tab} onClick={() => setFilter(tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              <b>
                {
                  all.filter((job) =>
                    tab === "active"
                      ? isActionableAssignment(job)
                      : tab === "completed"
                        ? job.status === "completed"
                        : tab === "declined"
                          ? job.status === "declined"
                          : true,
                  ).length
                }
              </b>
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="briefcase" title="Nothing here" hint="Assign jobs from the department queue." />
        ) : (
          <div className="job-list">
            {rows.map((job) => (
              <button key={job.id} onClick={() => openRequest(job.request_id)}>
                <span className="job-order">{formatRef(job.request?.reference).slice(-4)}</span>
                <div className="job-main">
                  <span>
                    <em className={`priority ${job.status === "declined" ? "high" : "normal"}`}>
                      {assignmentStateLabel(job)}
                    </em>
                    {job.status === "declined" && job.decline_reason && (
                      <small style={{ marginLeft: 8 }}>{job.decline_reason}</small>
                    )}
                  </span>
                  <h3>{job.request?.title ?? "Previous assignment"}</h3>
                  <p>
                    <Icon name="user" size={12} /> {job.assignee?.full_name ?? "Unknown"} ·{" "}
                    <Icon name="clock" size={12} />{" "}
                    {job.deadline_at ? formatDateTime(job.deadline_at) : "no deadline"}
                  </p>
                </div>
                <div className="job-time">
                  <small>CREATED</small>
                  <strong>{formatDateTime(job.created_at)}</strong>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
export function PersonnelPage() {
  const { profile } = useAuth()
  const staff = useAsync(() => listFieldPersonnel(profile?.department_id ?? null), [profile?.id])
  const assignments = useAsync(
    () => listDepartmentAssignments(profile?.department_id ?? null),
    [profile?.id],
  )

  if (staff.loading || assignments.loading) return <LoadingState />
  if (staff.error) return <ErrorState message={staff.error} onRetry={staff.refresh} />

  const openByUser = new Map<string, number>()
  for (const job of assignments.data ?? []) {
    if (isActionableAssignment(job)) {
      openByUser.set(job.assigned_to, (openByUser.get(job.assigned_to) ?? 0) + 1)
    }
  }

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">DEPARTMENT OPERATIONS</span>
          <h1>Personnel</h1>
          <p>Field personnel of {profile?.department?.name ?? "your department"}.</p>
        </div>
      </div>
      <div className="panel">
        {!staff.data || staff.data.length === 0 ? (
          <EmptyState
            icon="users"
            title="No field personnel yet"
            hint="Ask the administrator to create field staff accounts for this department."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Open jobs</th>
                </tr>
              </thead>
              <tbody>
                {staff.data.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <div className="request-cell">
                        <strong>{person.full_name || "(No name)"}</strong>
                      </div>
                    </td>
                    <td>{person.email}</td>
                    <td>
                      <Status status={person.status} />
                    </td>
                    <td>{openByUser.get(person.id) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
export function WorkloadPage() {
  const { profile } = useAuth()
  const assignments = useAsync(
    () => listDepartmentAssignments(profile?.department_id ?? null),
    [profile?.id],
  )
  const requests = useAsync(
    () =>
      profile
        ? listRequests(profile, { pageSize: 100, overdue: true })
        : Promise.resolve({ requests: [], total: 0, page: 1, pageSize: 100 }),
    [profile?.id],
  )

  if (assignments.loading || requests.loading) return <LoadingState />
  if (assignments.error)
    return <ErrorState message={assignments.error} onRetry={assignments.refresh} />

  const jobs = assignments.data ?? []
  const overdueRequests = requests.data?.requests ?? []
  const activeJobs = jobs.filter((j) => isActionableAssignment(j))
  const completedJobs = jobs.filter((j) => j.status === "completed")
  const declinedJobs = jobs.filter((j) => j.status === "declined")

  const perPerson = new Map<string, number>()
  for (const job of activeJobs) {
    perPerson.set(job.assigned_to, (perPerson.get(job.assigned_to) ?? 0) + 1)
  }
  const busiest = Array.from(perPerson.entries()).sort((a, b) => b[1] - a[1])

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">DEPARTMENT OPERATIONS</span>
          <h1>Workload &amp; SLA</h1>
          <p>Capacity and overdue monitoring for your department.</p>
        </div>
      </div>

      <div className="metrics-grid">
        <MetricCard label="Active jobs" value={activeJobs.length} icon="briefcase" />
        <MetricCard label="Completed jobs" value={completedJobs.length} tone="green" icon="check" />
        <MetricCard label="Declined jobs" value={declinedJobs.length} tone="red" icon="alert" />
        <MetricCard label="Overdue requests" value={overdueRequests.length} tone="amber" icon="clock" />
      </div>

      <div className="dashboard-grid">
        <section className="panel span-two">
          <div className="panel-head">
            <div>
              <h2>Load per field personnel</h2>
              <p>Active assignments right now</p>
            </div>
          </div>
          {busiest.length === 0 ? (
            <EmptyState icon="briefcase" title="No active assignments" />
          ) : (
            <div className="report-bars padded">
              {busiest.map(([userId, count]) => (
                <div className="report-row" key={userId}>
                  <span className="report-label">
                    {jobs.find((j) => j.assigned_to === userId)?.assignee?.full_name ?? "Personnel"}
                  </span>
                  <div className="meter">
                    <i
                      style={{
                        width: `${Math.min(100, count * 25)}%`,
                      }}
                    />
                  </div>
                  <b>{count}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel activity-panel">
          <div className="panel-head">
            <div>
              <h2>Overdue requests</h2>
              <p>Past SLA — escalate or reassign</p>
            </div>
          </div>
          {overdueRequests.length === 0 ? (
            <EmptyState icon="check" title="Nothing overdue" />
          ) : (
            <div className="alert-list">
              {overdueRequests.slice(0, 8).map((request) => (
                <p key={request.id}>
                  <i className="amber-dot" />
                  <span>
                    <strong>{request.title}</strong>
                    <small>
                      {formatRef(request.reference)} · due {formatDateTime(request.due_at)}
                    </small>
                  </span>
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
