// ============================================================================
// LinkBarangay — barangay staff and dispatcher dashboards. Metrics are live counts from lb_service_requests within the
// caller's RLS scope; field and admin have their own dashboards.
// ============================================================================

import { Icon } from "@/components/common/Icon"
import { Button, MetricCard, Status, formatRef, formatDate } from "@/components/common/ui"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/States"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { useRequestRealtimeRefresh } from "@/hooks/useRequestRealtime"
import { listRequests, requestRealtimeFilter } from "@/services/requestService"
import { listBarangayStaff, listFieldPersonnel } from "@/services/profileService"
import { listAppointments } from "@/services/appointmentService"
import { WORKER_FUNCTION_LABELS } from "@/types"
import type { RequestStatus, WorkerFunction, ViewId } from "@/types"

interface QueueSlice {
  title: string
  subtitle: string
  statuses: RequestStatus[]
  escalatedOnly?: boolean
}

const SLICES: Record<string, QueueSlice> = {
  barangay_staff: {
    title: "Barangay request workflow",
    subtitle: "Intake, verification, priority review, escalations, and approvals",
    statuses: ["submitted", "for_verification", "needs_information", "for_inspection"],
  },
  dispatcher: {
    title: "Ready to assign",
    subtitle: "Verified and routed requests in your department",
    statuses: ["verified", "assigned"],
  },
}

export function StaffDashboard({
  setView,
  openRequest,
}: {
  setView: (view: ViewId) => void
  openRequest: (id: string) => void
}) {
  const { profile } = useAuth()
  const role = profile?.worker_function ?? "barangay_staff"
  const scopeName =
    profile?.barangay?.name ? `Barangay ${profile.barangay.name}` : profile?.department?.name ?? ""

  const requests = useAsync(
    () =>
      profile ? listRequests(profile, { pageSize: 200 }) : Promise.resolve({ requests: [], total: 0, page: 1, pageSize: 200 }),
    [profile?.id, profile?.role, profile?.worker_function, profile?.barangay_id, profile?.department_id],
  )
  const requestFilter = profile ? requestRealtimeFilter(profile) : undefined
  useRequestRealtimeRefresh(requests.refresh, {
    enabled: Boolean(profile && requestFilter),
    filter: requestFilter,
  })
  const staff = useAsync(
    () =>
      role === "barangay_staff"
        ? listBarangayStaff(profile?.barangay_id ?? null)
        : listFieldPersonnel(profile?.department_id ?? null),
    [profile?.id, profile?.role, profile?.worker_function, profile?.barangay_id, profile?.department_id],
  )
  const appointments = useAsync(
    () =>
      role === "barangay_staff" ? listAppointments(profile?.barangay_id ?? null) : Promise.resolve([]),
    [profile?.id, profile?.role, profile?.worker_function, profile?.barangay_id, profile?.department_id],
  )

  if (requests.loading) return <LoadingState label="Loading your workspace…" />
  if (requests.error) return <ErrorState message={requests.error} onRetry={requests.refresh} />

  const all = requests.data?.requests ?? []
  const count = (status: RequestStatus) => all.filter((r) => r.status === status).length
  const escalated = all.filter((r) => r.escalation_count > 0)
  const overdue = all.filter(
    (r) =>
      r.due_at &&
      new Date(r.due_at) < new Date() &&
      !["resolved", "closed", "rejected"].includes(r.status),
  )
  const today = new Date().toDateString()
  const appointmentsToday = (appointments.data ?? []).filter(
    (a) => new Date(a.scheduled_at).toDateString() === today && a.status === "scheduled",
  )

  const slice = SLICES[role] ?? SLICES.barangay_staff
  const queue = all
    .filter((r) =>
      slice.statuses.includes(r.status) || (role === "barangay_staff" && r.escalation_count > 0),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6)

  const metrics =
    role === "barangay_staff"
      ? [
          { label: "New (submitted)", value: count("submitted"), icon: "file" as const },
          { label: "In verification", value: count("for_verification") + count("needs_information"), tone: "amber" as const, icon: "shield" as const },
          { label: "For inspection", value: count("for_inspection"), tone: "purple" as const, icon: "eye" as const },
          { label: "Appointments today", value: appointmentsToday.length, tone: "purple" as const, icon: "clock" as const },
          { label: "Escalated / overdue", value: escalated.length + overdue.length, tone: "red" as const, icon: "alert" as const },
        ]
      : [
              { label: "Ready to assign", value: count("verified") + count("assigned"), icon: "route" as const },
              { label: "In progress", value: count("in_progress"), tone: "amber" as const, icon: "briefcase" as const },
              { label: "Overdue", value: overdue.length, tone: "red" as const, icon: "alert" as const },
              { label: "Field personnel", value: staff.data?.length ?? 0, tone: "green" as const, icon: "users" as const },
            ]

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">{scopeName.toUpperCase()}</span>
          <h1>
            {role === "barangay_staff" ? "Barangay Staff Dashboard" : role === "dispatcher" ? "Operations Dashboard" : "Field Team Dashboard"}
          </h1>
          <p>
            {scopeName ? `${scopeName} · ` : ""}
            {all.length} request{all.length === 1 ? "" : "s"} in your scope.
          </p>
        </div>
        {role === "barangay_staff" && (
          <Button icon="plus" onClick={() => setView("walk-in")}>
            Encode walk-in request
          </Button>
        )}
      </div>

      <div className={`metrics-grid${role === "barangay_staff" ? " staff-metrics-grid" : ""}`}>
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className={`dashboard-grid${role === "barangay_staff" ? " staff-dashboard-grid" : ""}`}>
        <section className={`panel span-two${role === "barangay_staff" ? " staff-workflow-panel" : ""}`}>
          <div className="panel-head">
            <div>
              <h2>{slice.title}</h2>
              <p>{slice.subtitle}</p>
            </div>
            <button
              onClick={() =>
                setView(
                  role === "dispatcher" ? "dept-queue" : role === "field" ? "jobs" : "intake",
                )
              }
            >
              View all <Icon name="arrow" size={14} />
            </button>
          </div>
          {queue.length === 0 ? (
            <EmptyState icon="check" title="Queue is clear" hint="Nothing needs your attention right now." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Request</th>
                    <th>Submitter</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {queue.map((request) => (
                    <tr key={request.id}>
                      <td className="ref">{formatRef(request.reference)}</td>
                      <td>
                        <div className="request-cell">
                          <strong>{request.title}</strong>
                          <small>{request.category?.name ?? "Uncategorized"}</small>
                        </div>
                      </td>
                      <td>
                        {request.is_anonymous
                          ? "Anonymous"
                          : (request.submitter?.full_name ?? request.submitter_name ?? "—")}
                      </td>
                      <td>{formatDate(request.created_at)}</td>
                      <td>
                        <Status status={request.status} />
                        {request.escalation_count > 0 && (
                          <em className="priority high" style={{ marginLeft: 6 }}>
                            escalated
                          </em>
                        )}
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`panel activity-panel${role === "barangay_staff" ? " staff-personnel-panel" : ""}`}>
          <div className="panel-head">
            <div>
              <h2>{role === "barangay_staff" ? "Barangay personnel" : role === "dispatcher" ? "Field team" : "Operations team"}</h2>
              <p>{staff.data?.length ?? 0} active</p>
            </div>
          </div>
          {staff.loading ? (
            <LoadingState />
          ) : (staff.data ?? []).length === 0 ? (
            <EmptyState icon="users" title="No staff found" hint="Ask an administrator to create staff accounts." />
          ) : (
            <div className="department-list">
              {(staff.data ?? []).slice(0, 6).map((person) => (
                <div key={person.id}>
                  <span className="dept-icon">
                    <Icon name="user" size={15} />
                  </span>
                  <p>
                    <strong>{person.full_name || person.email}</strong>
                    <small>
                      {person.worker_function ? WORKER_FUNCTION_LABELS[person.worker_function] : "Worker"}
                      {person.status !== "active" ? ` · ${person.status}` : ""}
                    </small>
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {(role === "barangay_staff" || role === "dispatcher") && overdue.length > 0 && (
        <section className="panel alert-list" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <div>
              <h2>Overdue attention</h2>
              <p>Past their SLA deadline</p>
            </div>
          </div>
          {overdue.slice(0, 5).map((request) => (
            <p key={request.id}>
              <i />
              <span>
                <strong>{request.title}</strong>
                <small>
                  {formatRef(request.reference)} · due {formatDate(request.due_at)}
                </small>
              </span>
              <button onClick={() => openRequest(request.id)}>Open</button>
            </p>
          ))}
        </section>
      )}
    </div>
  )
}
