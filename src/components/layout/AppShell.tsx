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
import { useAuth } from "@/hooks/useAuth"
import { useNotifications } from "@/hooks/useNotifications"
import { navForProfile, scopeLabelFor } from "@/permissions/permissions"
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
  const [searchQuery, setSearchQuery] = useState("")

  if (!profile) return null

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
          {nav.map((item) => (
            <button
              className={
                view === item.view ||
                (item.view === "requests" && view === "request-detail") ||
                (item.view === "jobs" && view === "job-detail")
                  ? "active"
                  : ""
              }
              key={item.label}
              onClick={() => {
                setView(item.view)
                setMobileOpen(false)
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.label === "Notifications" && unreadCount > 0 && <b>{unreadCount}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-help">
          <Icon name="help" />
          <div>
            <strong>Need assistance?</strong>
            <span>Visit the help center</span>
          </div>
          <Icon name="chevron" size={16} />
        </div>
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
                    onClick={() => {
                      setView("notifications")
                      setMenuOpen(false)
                    }}
                  >
                    <Icon name="bell" size={15} /> Notifications
                    {unreadCount > 0 && <b>{unreadCount}</b>}
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
              aria-label={`Notifications (${unreadCount} unread)`}
            >
              <Icon name="bell" />
              {unreadCount > 0 && <i>{unreadCount > 99 ? "99+" : unreadCount}</i>}
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
          message="This ends your Supabase session on this device."
          confirmLabel="Sign out"
          danger
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => void signOut()}
        />
      )}
    </div>
  )
}
