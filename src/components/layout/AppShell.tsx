// ============================================================================
// LinkBarangay — authenticated application shell.
//
// There is deliberately NO role switcher: the navigation, identity, and
// workspace come exclusively from the authenticated user's lb_profiles row.
// The "Viewing as" dropdown from the prototype has been removed entirely.
// ============================================================================

import { useState } from "react"
import type { ReactNode } from "react"
import { Icon } from "@/components/common/Icon"
import { Logo, initials } from "@/components/common/ui"
import { ConfirmDialog } from "@/components/common/Modal"
import { AiHelpModal } from "@/features/shared/AiHelpModal"
import { SupportRequestModal } from "@/features/shared/SupportRequestModal"
import { useAuth } from "@/hooks/useAuth"
import { useNotifications } from "@/hooks/useNotifications"
import { navForProfile, scopeLabelFor } from "@/permissions/permissions"
import { notificationBadge } from "@/lib/notificationNavigation"
import { profileRoleLabel } from "@/types"
import type { ViewId } from "@/types"

export function AppShell({
  view,
  setView,
  onSearchRequests,
  children,
}: {
  view: ViewId
  setView: (view: ViewId) => void
  onSearchRequests: (query: string) => void
  children: ReactNode
}) {
  const { profile, signOut } = useAuth()
  const { unreadCount } = useNotifications()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [aiHelpOpen, setAiHelpOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  if (!profile) return null

  const badge = notificationBadge(unreadCount)
  const unreadLabel = `Notifications (${unreadCount} unread)`
  const nav = navForProfile(profile)
  const scopeText =
    profile.barangay?.name
      ? `Barangay ${profile.barangay.name}`
      : profile.department?.name
        ? profile.department.name
        : profileRoleLabel(profile)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Logo />
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <div className="scope-label">{scopeLabelFor(profile.role)}</div>
        <nav>
          {nav.map((item, index) => (
            <div key={item.label}>
            {item.section && item.section !== nav[index - 1]?.section && <div className="nav-section-label">{item.section}</div>}
            <button
              className={
                view === item.view ||
                (item.view === "requests" && view === "request-detail") ||
                (item.view === "jobs" && view === "job-detail")
                  ? "active"
                  : ""
              }
              aria-label={item.view === "notifications" ? unreadLabel : undefined}
              onClick={() => {
                setView(item.view)
                setMobileOpen(false)
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.view === "notifications" && badge && <b aria-hidden="true">{badge}</b>}
            </button>
            </div>
          ))}
        </nav>
        <button className="sidebar-help" onClick={() => setAiHelpOpen(true)}>
          <Icon name="help" />
          <div>
            <strong>Need assistance?</strong>
            <span>Ask the Help Assistant</span>
          </div>
          <Icon name="chevron" size={16} />
        </button>
        <div className="sidebar-user">
          <span>{initials(profile.full_name || profile.email || "U")}</span>
          <div>
            <strong>{profile.full_name || profile.email}</strong>
            <small>
              {profileRoleLabel(profile)}
              {profile.barangay?.name ? ` · ${profile.barangay.name}` : ""}
            </small>
          </div>
          <button onClick={() => setConfirmLogout(true)} aria-label="Sign out">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>

      <div className="app-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="topbar-brand">
            <Logo compact />
          </div>
          <form
            className="global-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              onSearchRequests(searchQuery.trim())
            }}
          >
            <Icon name="search" />
            <input
              aria-label="Search requests"
              placeholder="Search requests…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <kbd>Enter</kbd>
          </form>
          <div className="topbar-actions">
            {/* Account area — real authenticated identity, no role switching */}
            <div className={`account-chip ${menuOpen ? "open" : ""}`}>
              <button className="account-button" onClick={() => setMenuOpen(!menuOpen)}>
                <span className="top-avatar">
                  {initials(profile.full_name || profile.email || "U")}
                </span>
                <span className="account-text">
                  <strong>{profile.full_name || profile.email}</strong>
                  <small>
                    {profileRoleLabel(profile)}
                    {profile.barangay?.name
                      ? ` · Brgy ${profile.barangay.name}`
                      : profile.department?.name
                        ? ` · ${profile.department.name}`
                        : ""}
                  </small>
                </span>
                <Icon name="chevron" size={14} />
              </button>
              {menuOpen && (
                <div className="account-menu">
                  <div className="account-menu-head">
                    <strong>{profile.email}</strong>
                    <small>{scopeText}</small>
                  </div>
                  <button
                    onClick={() => {
                      setView("profile")
                      setMenuOpen(false)
                    }}
                  >
                    <Icon name="user" size={15} /> My profile
                  </button>
                  <button
                    aria-label={unreadLabel}
                    onClick={() => {
                      setView("notifications")
                      setMenuOpen(false)
                    }}
                  >
                    <Icon name="bell" size={15} /> Notifications
                    {badge && <b aria-hidden="true">{badge}</b>}
                  </button>
                  <button className="danger" onClick={() => setConfirmLogout(true)}>
                    <Icon name="logout" size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
            <button
              className="notification-button"
              onClick={() => setView("notifications")}
              aria-label={unreadLabel}
            >
              <Icon name="bell" />
              {badge && <i aria-hidden="true">{badge}</i>}
            </button>
          </div>
        </header>
        <main className="app-content">{children}</main>
        <footer className="app-footer">
          <span>LinkBarangay Service Portal</span>
          <span>Privacy · Accessibility · Help</span>
        </footer>
      </div>

      {mobileOpen && (
        <button
          className="sidebar-overlay"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        />
      )}
      {confirmLogout && (
        <ConfirmDialog
          title="Sign out"
          message="Are you sure you want to sign out?"
          confirmLabel="Sign out"
          danger
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => void signOut()}
        />
      )}
      {aiHelpOpen && <AiHelpModal onClose={() => setAiHelpOpen(false)} onCreateSupport={() => { setAiHelpOpen(false); setSupportOpen(true) }} />}
      {supportOpen && <SupportRequestModal onClose={() => setSupportOpen(false)} />}
    </div>
  )
}
