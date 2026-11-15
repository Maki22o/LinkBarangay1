// ============================================================================
// LinkBarangay — notifications page (real rows from lb_notifications)
// ============================================================================

import { Component, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Icon } from "@/components/common/Icon"
import { Modal } from "@/components/common/Modal"
import { Button, Status, formatDateTime } from "@/components/common/ui"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/States"
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/lib/supabase"
import { notificationDestination, type NotificationDestination } from "@/lib/notificationNavigation"
import { useNotifications } from "@/hooks/useNotifications"
import type { Appointment, Notification, Profile, ViewId } from "@/types"

export class NotificationsErrorBoundary extends Component<
  { children: ReactNode; setView: (view: ViewId) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error("Notifications page failed to render", error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="generic-page">
          <div className="welcome-row">
            <div>
              <span className="page-kicker">YOUR INBOX</span>
              <h1>Notifications</h1>
            </div>
          </div>
          <div className="panel">
            <ErrorState
              message={`The notifications page could not be displayed. ${this.state.error.message}`}
              onRetry={() => this.setState({ error: null })}
            />
            <div className="state-action">
              <Button variant="secondary" onClick={() => this.props.setView("dashboard")}>
                Back to dashboard
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

type AppointmentPreview = Pick<Appointment, "id" | "resident_id" | "scheduled_at" | "purpose" | "status">

export function NotificationsPage({
  setView,
  openRequest,
  openJob,
}: {
  setView: (view: ViewId) => void
  openRequest: (requestId: string) => void
  openJob: (assignmentId: string) => void
}) {
  const { profile, session } = useAuth()
  const {
    notifications, unreadCount, loading, error: loadError, refresh, markRead, markAllRead,
    hasMore, loadingMore, loadMore, refreshing, markingIds, markingAll,
  } = useNotifications()
  const [actionError, setActionError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [appointment, setAppointment] = useState<AppointmentPreview | null>(null)
  const latestProfile = useRef(profile)
  latestProfile.current = profile
  const currentUser = useRef(session?.user.id)
  currentUser.current = session?.user.id
  const mounted = useRef(true)
  const pendingClick = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const error = actionError ?? loadError

  const markOne = async (id: string) => {
    const userId = currentUser.current
    setActionError(null)
    try {
      await markRead(id)
    } catch (err) {
      if (mounted.current && currentUser.current === userId) setActionError(errorMessage(err))
    }
  }

  const open = async (item: Notification) => {
    if (pendingClick.current || !profile || session?.user.id !== profile.id) return
    const userId = profile.id
    const stillCurrent = () => mounted.current && currentUser.current === userId
    pendingClick.current = true
    setOpeningId(item.id)
    setActionError(null)
    try {
      if (!item.is_read) await markRead(item.id)
      if (!stillCurrent()) return
      const destination = notificationDestination(item, latestProfile.current)
      if (!destination) {
        if (item.destination_view) {
          setActionError("The related page is unavailable with your current account access.")
        }
        return
      }
      const accessBeforeLookup = accessKey(latestProfile.current)
      const appointmentDetail = await checkRecordAccess(destination, userId)
      if (!stillCurrent()) return
      if (accessKey(latestProfile.current) !== accessBeforeLookup ||
          !notificationDestination(item, latestProfile.current)) {
        throw new Error("Your account access changed. Open the notification again.")
      }
      if (destination.inline && appointmentDetail) {
        setAppointment(appointmentDetail)
        return
      }
      if (destination.view === "request-detail") openRequest(destination.entityId!)
      else if (destination.view === "job-detail") openJob(destination.entityId!)
      else setView(destination.view)
    } catch (err) {
      if (stillCurrent()) setActionError(errorMessage(err))
    } finally {
      pendingClick.current = false
      if (stillCurrent()) setOpeningId(null)
    }
  }

  return (
    <div className="generic-page">
      <div className="welcome-row">
        <div>
          <span className="page-kicker">YOUR INBOX</span>
          <h1>Notifications</h1>
          <p aria-live="polite">{unreadCount} unread</p>
        </div>
        <div className="welcome-actions">
          <Button variant="secondary" icon="history" disabled={refreshing || loading}
            onClick={() => { setActionError(null); void refresh() }}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          {unreadCount > 0 && (
            <Button icon="check" disabled={markingAll || markingIds.size > 0}
              onClick={() => {
                const userId = currentUser.current
                setActionError(null)
                void markAllRead().catch((err: unknown) => {
                  if (mounted.current && currentUser.current === userId) setActionError(errorMessage(err))
                })
              }}>
              {markingAll ? "Marking read…" : "Mark all read"}
            </Button>
          )}
        </div>
      </div>
      <div className="panel" aria-busy={loading || refreshing}>
        {error && (
          <div role="alert">
            <ErrorState message={error} onRetry={() => { setActionError(null); void refresh() }} />
          </div>
        )}
        {loading ? (
          <LoadingState />
        ) : notifications.length === 0 && !loadError ? (
          <EmptyState icon="bell" title="No notifications yet"
            hint="Updates about your requests, tasks, appointments, and account will appear here." />
        ) : (
          <div className="notification-list">
            {notifications.map((item) => {
              const destination = notificationDestination(item, profile)
              const busy = markingAll || markingIds.has(item.id) || openingId === item.id
              const icon = item.event_type?.startsWith("appointment") ? "clock"
                : item.event_type?.startsWith("account") || item.event_type?.startsWith("profile") ? "user"
                : item.event_type?.startsWith("assignment") ? "briefcase"
                : item.event_type?.startsWith("config") ? "settings"
                : item.request_id ? "file" : "bell"
              return (
                <article key={item.id} className={`notification-item ${item.is_read ? "" : "unread"}`}>
                  <button className="notification-content" disabled={busy || Boolean(openingId)}
                    onClick={() => { void open(item) }}
                    aria-label={`${item.is_read ? "Read" : "Unread"}: ${item.title}${destination ? ". Open related page" : ""}`}>
                    <span className="activity-icon amber"><Icon name={icon} size={15} /></span>
                    <span className="notification-copy">
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                      <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>
                        {formatDateTime(item.created_at)}
                      </time>
                      {destination && <small className="notification-destination">
                        {openingId === item.id ? "Opening…" : destinationLabel(destination)}
                      </small>}
                    </span>
                    {!item.is_read && <i className="notification-unread-dot" aria-hidden="true" />}
                  </button>
                  {!item.is_read && (
                    <button className="link-button notification-read-action" disabled={busy}
                      aria-label={`Mark ${item.title} as read`} onClick={() => { void markOne(item.id) }}>
                      {busy ? "Saving…" : "Mark read"}
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        )}
        {hasMore && !loading && (
          <div className="notification-pagination">
            <Button variant="secondary" disabled={loadingMore || refreshing}
              onClick={() => { setActionError(null); void loadMore() }}>
              {loadingMore ? "Loading…" : "Load older notifications"}
            </Button>
          </div>
        )}
      </div>
      {appointment && profile?.role === "resident" && profile.status === "active" &&
          appointment.resident_id === profile.id && session?.user.id === profile.id && (
        <Modal title="Your appointment" onClose={() => setAppointment(null)}>
          <dl className="notification-appointment-details">
            <div><dt>Scheduled for</dt><dd>{formatDateTime(appointment.scheduled_at)}</dd></div>
            <div><dt>Purpose</dt><dd>{appointment.purpose || "Barangay appointment"}</dd></div>
            <div><dt>Status</dt><dd><Status status={appointment.status} /></dd></div>
          </dl>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setAppointment(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function accessKey(profile: Profile | null): string {
  return JSON.stringify(profile && [profile.id, profile.role, profile.worker_function, profile.status,
    profile.barangay_id, profile.department_id])
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The notification could not be updated. Try again."
}

function destinationLabel(destination: NotificationDestination): string {
  if (destination.record === "request") return "Open request"
  if (destination.record === "assignment") return "Open job"
  if (destination.record === "appointment") return destination.inline ? "View appointment" : "Open appointments"
  if (destination.view === "profile") return "Open my profile"
  if (destination.view === "users") return "Open user management"
  if (destination.view === "jobs") return "Open my jobs"
  if (destination.view === "assignments") return "Open assignments"
  return "Open configuration"
}

async function checkRecordAccess(
  destination: NotificationDestination, userId: string,
): Promise<AppointmentPreview | null> {
  // These ordinary authenticated reads obey live RLS; a stored link never grants access.
  if (!destination.record || !destination.entityId) return null
  if (destination.inline && destination.record === "appointment") {
    const { data, error } = await supabase.from("lb_appointments")
      .select("id,resident_id,scheduled_at,purpose,status")
      .eq("id", destination.entityId).eq("resident_id", userId).maybeSingle()
    if (error) throw new Error(`Could not open the appointment. ${error.message}`)
    if (!data) throw new Error("This appointment is unavailable or your access has changed. Your notification remains in your history.")
    return data as AppointmentPreview
  }
  const table = destination.record === "request" ? "lb_service_requests"
    : destination.record === "assignment" ? "lb_assignments" : "lb_appointments"
  let query = supabase.from(table).select("id").eq("id", destination.entityId)
  if (destination.record === "assignment") query = query.eq("assigned_to", userId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`Could not open the related record. ${error.message}`)
  if (!data) throw new Error("This record is unavailable or your access has changed. Your notification remains in your history.")
  return null
}
