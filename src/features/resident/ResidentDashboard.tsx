// ============================================================================
// LinkBarangay — resident dashboard (live data from lb_service_requests)
// ============================================================================

import { Icon } from "@/components/common/Icon"
import { Button, MetricCard, Status, formatRef, formatDate } from "@/components/common/ui"
import { LoadingState, ErrorState, EmptyState } from "@/components/common/States"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { useRequestRealtimeRefresh } from "@/hooks/useRequestRealtime"
import { listRequests, requestRealtimeFilter } from "@/services/requestService"
import type { ViewId } from "@/types"

export function ResidentDashboard({
  setView,
  openRequest,
}: {
  setView: (view: ViewId) => void
  openRequest: (id: string) => void
}) {
  const { profile } = useAuth()
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "there"

  const summary = useAsync(
    () =>
      profile
        ? listRequests(profile, { pageSize: 100 })
        : Promise.resolve({ requests: [], total: 0, page: 1, pageSize: 100 }),
    [profile?.id],
  )
  const requestFilter = profile ? requestRealtimeFilter(profile) : undefined
  useRequestRealtimeRefresh(summary.refresh, { enabled: Boolean(profile), filter: requestFilter })

  const requests = summary.data?.requests ?? []
  const active = requests.filter(
    (r) => !["resolved", "closed", "rejected"].includes(r.status),
  )
  const resolved = requests.filter((r) => ["resolved", "closed"].includes(r.status))
  const needsYou = requests.filter((r) => r.status === "needs_information")
  const recent = [...requests]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">RESIDENT PORTAL</span>
          <h1>Welcome back, {firstName}</h1>
          <p>
            {profile?.barangay?.name
              ? `Barangay ${profile.barangay.name} · here's what's happening with your requests.`
              : "Here's what's happening with your requests."}
          </p>
        </div>
        <Button icon="plus" onClick={() => setView("submit")}>
          Submit a request
        </Button>
      </div>

      <div className="metrics-grid">
        <MetricCard label="Active requests" value={active.length} icon="file" />
        <MetricCard label="Needs your reply" value={needsYou.length} tone="amber" icon="help" />
        <MetricCard label="Resolved" value={resolved.length} tone="green" icon="check" />
        <MetricCard
          label="Total submitted"
          value={summary.data?.total ?? 0}
          tone="purple"
          icon="history"
        />
      </div>

      <div className="dashboard-grid">
        <section className="panel span-two">
          <div className="panel-head">
            <div>
              <h2>Recent requests</h2>
              <p>Your five most recent submissions</p>
            </div>
            <button onClick={() => setView("requests")}>
              View all <Icon name="arrow" size={14} />
            </button>
          </div>
          {summary.loading ? (
            <LoadingState />
          ) : summary.error ? (
            <ErrorState message={summary.error} onRetry={summary.refresh} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon="file"
              title="You haven't submitted anything yet"
              hint="Your first barangay request is a few clicks away."
              action={
                <Button icon="plus" onClick={() => setView("submit")}>
                  Submit a request
                </Button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Request</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((request) => (
                    <tr key={request.id}>
                      <td className="ref">{formatRef(request.reference)}</td>
                      <td>
                        <div className="request-cell">
                          <strong>{request.title}</strong>
                          <small>{request.category?.name ?? "Uncategorized"}</small>
                        </div>
                      </td>
                      <td>{formatDate(request.created_at)}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel activity-panel">
          <div className="panel-head">
            <div>
              <h2>Action needed</h2>
              <p>Waiting on you</p>
            </div>
          </div>
          {needsYou.length === 0 ? (
            <EmptyState icon="check" title="Nothing waiting on you" hint="You're all caught up." />
          ) : (
            <div className="queue-list">
              {needsYou.map((request) => (
                <button key={request.id} onClick={() => openRequest(request.id)}>
                  <div>
                    <strong>{request.title}</strong>
                    <small>The barangay asked for more information</small>
                  </div>
                  <Icon name="arrow" size={14} />
                </button>
              ))}
            </div>
          )}
          <div className="support-card" style={{ margin: 16 }}>
            <span className="support-icon">
              <Icon name="phone" />
            </span>
            <div>
              <h3>Need help?</h3>
              <p>Call the help desk at (049) 562-3221, Mon–Fri 8AM–5PM.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
