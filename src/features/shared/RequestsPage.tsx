// ============================================================================
// LinkBarangay — shared requests list page (resident "My Requests", staff
// barangay/department lists). Row visibility is enforced by RLS.
// ============================================================================

import { useEffect, useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Status, Priority, formatRef, formatDate } from "@/components/common/ui"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/States"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { listRequests } from "@/services/requestService"
import { listCategories } from "@/services/configService"
import { STATUS_LABELS } from "@/types"
import type { RequestStatus, ViewId } from "@/types"

const PAGE_SIZE = 10

export function RequestsPage({
  setView,
  openRequest,
  title = "My Requests",
  kicker = "REQUEST HISTORY",
  subtitle = "Every request you submitted and its current status.",
  emptyTitle = "No requests yet",
  emptyHint = "Requests you submit will appear here with live status.",
  initialSearch = "",
}: {
  setView: (view: ViewId) => void
  openRequest: (requestId: string) => void
  title?: string
  kicker?: string
  subtitle?: string
  emptyTitle?: string
  emptyHint?: string
  initialSearch?: string
}) {
  const { profile } = useAuth()
  const [search, setSearch] = useState(initialSearch)
  const [status, setStatus] = useState<RequestStatus | "">("")
  const [page, setPage] = useState(1)

  useEffect(() => {
    setSearch(initialSearch)
    setPage(1)
  }, [initialSearch])

  const { data, error, loading, refresh } = useAsync(
    () =>
      profile
        ? listRequests(profile, {
            search,
            status,
            page,
            pageSize: PAGE_SIZE,
          })
        : Promise.resolve({ requests: [], total: 0, page: 1, pageSize: PAGE_SIZE }),
    [profile?.id, search, status, page],
  )

  const categories = useAsync(() => listCategories(), [])
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">{kicker}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {profile?.role === "resident" && (
          <button className="button button-primary" onClick={() => setView("submit")}>
            <Icon name="plus" size={18} />
            <span>New request</span>
          </button>
        )}
      </div>

      <div className="panel">
        <div className="toolbar">
          <label className="search-input">
            <Icon name="search" size={15} />
            <input
              placeholder="Search title or reference…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <select
            className="filter-select"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as RequestStatus | "")
              setPage(1)
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="filter-button" onClick={refresh}>
            <Icon name="filter" size={14} /> {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : !data || data.requests.length === 0 ? (
          <EmptyState icon="file" title={emptyTitle} hint={emptyHint} />
        ) : (
          <>
            <div className="results-summary">
              <span>
                {total} request{total === 1 ? "" : "s"} found
              </span>
              <span>
                Page {data.page} of {pages}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Request</th>
                    <th>Category</th>
                    {profile?.role !== "resident" && <th>Submitter</th>}
                    <th>Submitted</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.requests.map((request) => (
                    <tr key={request.id}>
                      <td className="ref">{formatRef(request.reference)}</td>
                      <td>
                        <div className="request-cell">
                          <strong>{request.title}</strong>
                          <small>{request.location || "No location given"}</small>
                        </div>
                      </td>
                      <td>{request.category?.name ?? "—"}</td>
                      {profile?.role !== "resident" && (
                        <td>
                          {request.is_anonymous
                            ? "Anonymous"
                            : (request.submitter?.full_name ?? request.submitter_name ?? "—")}
                        </td>
                      )}
                      <td>{formatDate(request.created_at)}</td>
                      <td>
                        <Priority level={request.priority} />
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
      {categories.error && null}
    </div>
  )
}
