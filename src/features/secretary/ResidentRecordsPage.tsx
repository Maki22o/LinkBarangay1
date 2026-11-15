// ============================================================================
// LinkBarangay — resident records (secretary / officer / captain views).
// Scoped to the caller's barangay by RLS.
// ============================================================================

import { useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Status, formatDate } from "@/components/common/ui"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/States"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { listBarangayResidents } from "@/services/profileService"

export function ResidentRecordsPage() {
  const { profile } = useAuth()
  const [search, setSearch] = useState("")
  const [term, setTerm] = useState("")
  const residents = useAsync(
    () => listBarangayResidents(profile?.barangay_id ?? null, term),
    [profile?.id, profile?.barangay_id, term],
  )

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">RECORDS</span>
          <h1>Resident Records</h1>
          <p>
            Registered residents of {profile?.barangay?.name ?? "your barangay"}.
          </p>
        </div>
      </div>
      <div className="panel">
        <div className="toolbar">
          <label className="search-input">
            <Icon name="search" size={15} />
            <input
              placeholder="Search name or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setTerm(search)
              }}
            />
          </label>
          <button className="filter-button" onClick={() => setTerm(search)}>
            <Icon name="search" size={14} /> Search
          </button>
        </div>
        {residents.loading ? (
          <LoadingState />
        ) : residents.error ? (
          <ErrorState message={residents.error} onRetry={residents.refresh} />
        ) : !residents.data || residents.data.length === 0 ? (
          <EmptyState
            icon="users"
            title="No residents found"
            hint="Residents appear here after they register online."
          />
        ) : (
          <>
            <div className="results-summary">
              <span>
                {residents.data.length} resident{residents.data.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Mobile</th>
                    <th>Address</th>
                    <th>Status</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {residents.data.map((resident) => (
                    <tr key={resident.id}>
                      <td>
                        <div className="request-cell">
                          <strong>{resident.full_name || "(No name)"}</strong>
                        </div>
                      </td>
                      <td>{resident.email}</td>
                      <td>{resident.mobile || "—"}</td>
                      <td>{resident.address || "—"}</td>
                      <td>
                        <Status status={resident.status} />
                      </td>
                      <td>{formatDate(resident.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
