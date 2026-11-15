// ============================================================================
// LinkBarangay — multi-status queue list (staff work queues)
// ============================================================================

import { Icon } from "@/components/common/Icon"
import { Button, Status, formatRef, formatDate } from "@/components/common/ui"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/States"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { useRequestRealtimeRefresh } from "@/hooks/useRequestRealtime"
import { listRequests, requestRealtimeFilter } from "@/services/requestService"
import type { RequestStatus, ViewId } from "@/types"

export function QueueListPage({
  kicker,
  title,
  subtitle,
  statuses,
  escalatedOnly,
  emptyTitle = "Nothing in this queue",
  emptyHint = "New items appear here automatically.",
  setView,
  openRequest,
}: {
  kicker: string
  title: string
  subtitle: string
  statuses?: RequestStatus[]
  escalatedOnly?: boolean
  emptyTitle?: string
  emptyHint?: string
  setView: (view: ViewId) => void
  openRequest: (id: string) => void
}) {
  const { profile } = useAuth()
  const list = useAsync(
    () =>
      profile
        ? listRequests(profile, { pageSize: 100 })
        : Promise.resolve({ requests: [], total: 0, page: 1, pageSize: 100 }),
    [profile?.id, profile?.role, profile?.worker_function, profile?.barangay_id, profile?.department_id],
  )
  const requestFilter = profile ? requestRealtimeFilter(profile) : undefined
  useRequestRealtimeRefresh(list.refresh, {
    enabled: Boolean(profile && (profile.role === "admin" || requestFilter)),
    filter: requestFilter,
  })

  if (list.loading) return <LoadingState label="Loading queue…" />
  if (list.error) return <ErrorState message={list.error} onRetry={list.refresh} />

  const all = list.data?.requests ?? []
  const rows = all
    .filter((request) => {
      if (escalatedOnly) return request.escalation_count > 0 && !["closed"].includes(request.status)
      if (!statuses) return true
      return statuses.includes(request.status)
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">{kicker}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <Button icon="history" onClick={list.refresh} variant="secondary">
          Refresh
        </Button>
      </div>
      <div className="panel">
        {rows.length === 0 ? (
          <EmptyState icon="check" title={emptyTitle} hint={emptyHint} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Request</th>
                  <th>Submitter</th>
                  <th>Submitted</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((request) => (
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
                      <em className={`priority ${request.priority}`}>{request.priority}</em>
                    </td>
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
      </div>
    </div>
  )
}
