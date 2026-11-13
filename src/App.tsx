// ============================================================================
// LinkBarangay — application root.
//
// The signed-in user's role comes exclusively from their authenticated
// Supabase profile (lb_profiles). There is no role switching, no demo users,
// and no client-side permission grants. Navigation is guarded by the
// centralized permission system; row visibility is enforced by RLS.
// ============================================================================

import { useState } from "react"
import { AuthProvider, useAuth } from "@/hooks/useAuth"
import { AppShell } from "@/components/layout/AppShell"
import { LoadingState, ErrorState } from "@/components/common/States"
import { Landing } from "@/features/auth/Landing"
import { AuthLinkErrorScreen, AuthScreen, SetPasswordScreen } from "@/features/auth/AuthScreen"
import { RequestsPage } from "@/features/shared/RequestsPage"
import { RequestDetailPage } from "@/features/shared/RequestDetailPage"
import { NotificationsErrorBoundary, NotificationsPage } from "@/features/shared/NotificationsPage"
import { ProfilePage } from "@/features/shared/ProfilePage"
import { UnauthorizedPage } from "@/features/shared/UnauthorizedPage"
import { StaffDashboard } from "@/features/shared/StaffDashboard"
import { QueueListPage } from "@/features/shared/QueueListPage"
import { ResidentDashboard } from "@/features/resident/ResidentDashboard"
import { SubmitRequestPage } from "@/features/resident/SubmitRequestPage"
import { WalkInPage } from "@/features/secretary/WalkInPage"
import { AppointmentsPage } from "@/features/secretary/AppointmentsPage"
import { ResidentRecordsPage } from "@/features/secretary/ResidentRecordsPage"
import {
  FieldDashboard,
  JobsPage,
  JobDetailPage,
} from "@/features/field/FieldPages"
import {
  DeptQueuePage,
  AssignmentsPage,
  PersonnelPage,
  WorkloadPage,
} from "@/features/dispatcher/DispatcherPages"
import {
  UsersPage,
} from "@/features/admin/AdminPages"
import {
  RolesPage,
  ConfigurationPage,
  BarangaysPage,
  DepartmentsPage,
  CategoriesPage,
  RoutingPage,
  SlaSettingsPage,
  ReportsPage,
  AuditPage,
} from "@/features/admin/AdminConfigPages"
import { canAccessView } from "@/permissions/permissions"
import { listBarangayStaff } from "@/services/profileService"
import { useAsync } from "@/hooks/useAsync"
import { Status, formatDate } from "@/components/common/ui"
import { profileRoleLabel } from "@/types"
import type { ViewId } from "@/types"

const PUBLIC_VIEWS: ReadonlySet<string> = new Set([
  "landing",
  "login",
  "register",
  "anonymous",
  "track",
])

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}

function Root() {
  const { initializing, session, profile, authLinkFlow, authLinkError, clearAuthLink } = useAuth()
  const [view, setView] = useState<ViewId>("dashboard")
  const [globalRequestSearch, setGlobalRequestSearch] = useState("")
  const [requestId, setRequestId] = useState<string | null>(null)
  const [assignmentId, setAssignmentId] = useState<string | null>(null)

  if (initializing || (session && !profile)) {
    return (
      <div className="boot-screen">
        <LoadingState label="Loading LinkBarangay…" />
      </div>
    )
  }

  if (authLinkError && !session) {
    return (
      <AuthLinkErrorScreen
        onContinue={() => {
          clearAuthLink()
          setView("login")
        }}
      />
    )
  }

  if (authLinkFlow && session) {
    return (
      <SetPasswordScreen
        flow={authLinkFlow}
        onDone={() => {
          clearAuthLink()
          setView("dashboard")
        }}
      />
    )
  }

  // Public flow (not signed in)
  if (!session || !profile) {
    const current = PUBLIC_VIEWS.has(view) ? (view as "landing") : "landing"
    if (current === "landing") return <Landing navigate={setView} />
    return (
      <AuthScreen
        mode={current as "login" | "register" | "anonymous" | "track"}
        navigate={setView}
      />
    )
  }

  // Authenticated flow — route is guarded by the permission system
  const activeView: ViewId = PUBLIC_VIEWS.has(view) ? "dashboard" : view
  const openRequest = (id: string) => {
    setRequestId(id)
    setView("request-detail")
  }
  const openJob = (id: string) => {
    setAssignmentId(id)
    setView("job-detail")
  }
  const searchRequests = (query: string) => {
    setGlobalRequestSearch(query)
    setView("requests")
  }

  if (!canAccessView(profile, activeView) && activeView !== "unauthorized") {
    return (
      <AppShell view={activeView} setView={setView} onSearchRequests={searchRequests}>
        <UnauthorizedPage setView={setView} />
      </AppShell>
    )
  }

  const renderView = (): React.ReactNode => {
    switch (activeView) {
      // Dashboards
      case "dashboard":
        if (profile.role === "resident")
          return <ResidentDashboard setView={setView} openRequest={openRequest} />
        if (profile.role === "worker" && profile.worker_function === "field")
          return <FieldDashboard setView={setView} openJob={openJob} />
        if (profile.role === "admin") return <ReportsPage />
        return <StaffDashboard setView={setView} openRequest={openRequest} />

      // Shared
      case "requests":
        return (
          <RequestsPage
            setView={setView}
            openRequest={openRequest}
            initialSearch={globalRequestSearch}
            title={
              profile.role === "resident"
                ? "My Requests"
                : profile.role === "worker" && profile.worker_function === "dispatcher"
                  ? "Department Requests"
                  : profile.role === "admin"
                    ? "All Requests"
                    : "Barangay Requests"
            }
            kicker={
              profile.role === "resident" ? "REQUEST HISTORY" : "REQUEST RECORDS"
            }
            subtitle={
              profile.role === "resident"
                ? "Every request you submitted and its current status."
                : "Requests in your authorized scope — visibility is enforced by the database."
            }
            emptyTitle="No requests in this scope"
            emptyHint="New requests will appear here automatically."
          />
        )
      case "request-detail":
        return requestId ? (
          <RequestDetailPage requestId={requestId} setView={setView} />
        ) : (
          <UnauthorizedPage setView={setView} />
        )
      case "notifications":
        return (
          <NotificationsErrorBoundary setView={setView}>
            <NotificationsPage setView={setView} openRequest={openRequest} />
          </NotificationsErrorBoundary>
        )
      case "profile":
        return <ProfilePage />
      case "unauthorized":
        return <UnauthorizedPage setView={setView} />

      // Resident
      case "submit":
        return <SubmitRequestPage setView={setView} />

      // Secretary
      case "walk-in":
        return <WalkInPage setView={setView} />
      case "intake":
        return (
          <QueueListPage
            kicker="FRONT DESK"
            title="Incoming Requests"
            subtitle="New submissions awaiting intake review."
            statuses={["submitted"]}
            setView={setView}
            openRequest={openRequest}
          />
        )
      case "verification":
        return (
          <QueueListPage
            kicker="FRONT DESK"
            title="Document Verification"
            subtitle="Requests being verified and awaiting information."
            statuses={["for_verification", "needs_information"]}
            setView={setView}
            openRequest={openRequest}
          />
        )
      case "appointments":
        return <AppointmentsPage setView={setView} />
      case "residents":
        return <ResidentRecordsPage />

      // Officer / captain
      case "verify-queue":
        return (
          <QueueListPage
            kicker="VERIFICATION"
            title="Verification Queue"
            subtitle="Requests waiting for review, verification, or information."
            statuses={["submitted", "for_verification", "needs_information"]}
            setView={setView}
            openRequest={openRequest}
          />
        )
      case "escalated":
        return (
          <QueueListPage
            kicker="ATTENTION"
            title="Escalated Requests"
            subtitle="Requests flagged for priority handling."
            escalatedOnly
            setView={setView}
            openRequest={openRequest}
          />
        )
      case "approvals":
        return (
          <QueueListPage
            kicker="SUPERVISOR"
            title="Approval Queue"
            subtitle="Completed work for inspection and escalated concerns."
            statuses={["for_inspection"]}
            escalatedOnly={false}
            setView={setView}
            openRequest={openRequest}
          />
        )
      case "personnel-monitor":
        return <CaptainPersonnel />

      // Reports (captain barangay view + admin system view)
      case "barangay-reports":
      case "reports":
        return <ReportsPage />

      // Dispatcher
      case "dept-queue":
        return <DeptQueuePage setView={setView} openRequest={openRequest} />
      case "assignments":
        return <AssignmentsPage setView={setView} openRequest={openRequest} />
      case "personnel":
        return <PersonnelPage />
      case "workload":
        return <WorkloadPage />

      // Field personnel
      case "jobs":
        return <JobsPage setView={setView} openJob={openJob} />
      case "job-detail":
        return assignmentId ? (
          <JobDetailPage assignmentId={assignmentId} setView={setView} />
        ) : (
          <UnauthorizedPage setView={setView} />
        )

      // Admin
      case "users":
        return <UsersPage setView={setView} />
      case "roles":
        return <RolesPage />
      case "configuration":
        return <ConfigurationPage setView={setView} />
      case "barangays":
        return <BarangaysPage />
      case "departments":
        return <DepartmentsPage />
      case "categories":
        return <CategoriesPage />
      case "routing":
        return <RoutingPage />
      case "sla-settings":
        return <SlaSettingsPage />
      case "audit":
        return <AuditPage />

      default:
        return <UnauthorizedPage setView={setView} />
    }
  }

  return (
    <AppShell view={activeView} setView={setView} onSearchRequests={searchRequests}>
      {renderView()}
    </AppShell>
  )
}

// Captain's personnel monitoring — barangay-scoped staff list
function CaptainPersonnel() {
  const { profile } = useAuth()
  const staff = useAsync(() => listBarangayStaff(profile?.barangay_id ?? null), [profile?.id])

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">SUPERVISOR</span>
          <h1>Personnel Monitoring</h1>
          <p>Barangay staff handling resident requests.</p>
        </div>
      </div>
      <div className="panel">
        {staff.loading ? (
          <LoadingState />
        ) : staff.error ? (
          <ErrorState message={staff.error} onRetry={staff.refresh} />
        ) : !staff.data || staff.data.length === 0 ? (
          <p className="muted-note" style={{ padding: 20 }}>
            No staff assigned to this barangay yet. Ask the system administrator.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Since</th>
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
                    <td>{profileRoleLabel(person)}</td>
                    <td>{person.email}</td>
                    <td>
                      <Status status={person.status} />
                    </td>
                    <td>{formatDate(person.created_at)}</td>
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
