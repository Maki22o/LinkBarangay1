// ============================================================================
// LinkBarangay — notifications page (real rows from lb_notifications)
// ============================================================================

import { Component, useState } from "react"
import type { ReactNode } from "react"
import { Icon } from "@/components/common/Icon"
import { Button } from "@/components/common/ui"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/States"
import { useNotifications } from "@/hooks/useNotifications"
import type { ViewId } from "@/types"

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

export function NotificationsPage({
  setView,
  openRequest,
}: {
  setView: (view: ViewId) => void
  openRequest: (requestId: string) => void
}) {
  const { notifications, unreadCount, loading, error: loadError, refresh, markRead, markAllRead } =
    useNotifications()
  const [actionError, setActionError] = useState<string | null>(null)
  const error = actionError ?? loadError

  return (
    <div className="generic-page">
      <div className="welcome-row">
        <div>
          <span className="page-kicker">YOUR INBOX</span>
          <h1>Notifications</h1>
          <p>{unreadCount} unread</p>
        </div>
        <div className="welcome-actions">
          <Button variant="secondary" icon="history" onClick={() => { setActionError(null); void refresh() }}>
            Refresh
          </Button>
          {unreadCount > 0 && (
            <Button icon="check" onClick={() => void markAllRead().catch((e: Error) => setActionError(e.message))}>
              Mark all read
            </Button>
          )}
        </div>
      </div>
      <div className="panel">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => { setActionError(null); void refresh() }} />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon="bell"
            title="No notifications yet"
            hint="Updates about your requests will appear here."
          />
        ) : (
          <div className="notification-list">
            {notifications.map((item) => (
              <button
                key={item.id}
                className={`notification-item ${item.is_read ? "" : "unread"}`}
                onClick={() => {
                  if (!item.is_read) void markRead(item.id).catch((e: Error) => setActionError(e.message))
                  if (item.request_id) {
                    openRequest(item.request_id)
                    setView("request-detail")
                  }
                }}
              >
                <span className="activity-icon amber">
                  <Icon name={item.request_id ? "file" : "bell"} size={15} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.message}</span>
                  <small>{new Date(item.created_at).toLocaleString()}</small>
                </div>
                {!item.is_read && <i />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
