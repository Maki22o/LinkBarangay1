// ============================================================================
// LinkBarangay — public landing page (visual identity preserved from the
// original wireframe)
// ============================================================================

import { Icon } from "@/components/common/Icon"
import { Button, Logo, Status } from "@/components/common/ui"
import type { ViewId } from "@/types"

export function Landing({ navigate }: { navigate: (view: ViewId) => void }) {
  const services = [
    {
      icon: "settings" as const,
      title: "Roads & Infrastructure",
      text: "Report damaged roads, drainage, and streetlight concerns.",
    },
    {
      icon: "shield" as const,
      title: "Safety & Emergency",
      text: "Connect urgent community concerns to the right response team.",
    },
    {
      icon: "file" as const,
      title: "Documents & Permits",
      text: "Request barangay clearances, permits, and local certificates.",
    },
    {
      icon: "users" as const,
      title: "Community Welfare",
      text: "Access health, senior, youth, and social welfare services.",
    },
  ]
  return (
    <div className="public-site">
      <header className="public-header">
        <div className="public-nav">
          <button className="logo-button" onClick={() => navigate("landing")}>
            <Logo />
          </button>
          <nav className="landing-links" aria-label="Main navigation">
            <a href="#how">How it works</a>
            <a href="#services">Services</a>
            <a href="#help">Help center</a>
          </nav>
          <div className="nav-actions">
            <Button variant="ghost" onClick={() => navigate("track")}>
              Track a request
            </Button>
            <Button onClick={() => navigate("login")}>Sign in</Button>
          </div>
        </div>
      </header>
      <main>
        <section className="hero-section">
          <div className="hero-grid">
            <div className="hero-copy">
              <span className="eyebrow">
                <i /> One community. One service hub.
              </span>
              <h1>
                Local services,
                <br />
                <span>made easier.</span>
              </h1>
              <p>
                Send requests directly to your barangay, follow every update,
                and get help from the right city department—all in one place.
              </p>
              <div className="hero-actions">
                <Button icon="plus" onClick={() => navigate("login")}>
                  Submit a request
                </Button>
                <Button
                  variant="secondary"
                  icon="search"
                  onClick={() => navigate("track")}
                >
                  Track a request
                </Button>
              </div>
              <div className="trust-row">
                <span>
                  <Icon name="check" size={16} /> Free to use
                </span>
                <span>
                  <Icon name="check" size={16} /> Secure tracking
                </span>
                <span>
                  <Icon name="check" size={16} /> Mobile friendly
                </span>
              </div>
            </div>
            <div className="hero-visual" aria-label="Request tracking preview">
              <div className="hero-card">
                <div className="preview-head">
                  <div>
                    <span className="mini-label">REQUEST</span>
                    <strong>Streetlight not working</strong>
                  </div>
                  <Status status="in_progress" />
                </div>
                <div className="preview-meta">
                  <span>LB-2026-0428</span>
                  <span>Barangay San Roque</span>
                </div>
                <div className="progress-line">
                  {["Submitted", "Verified", "Assigned", "In progress"].map(
                    (label, i) => (
                      <div className={i < 4 ? "done" : ""} key={label}>
                        <i>{i < 3 ? <Icon name="check" size={13} /> : ""}</i>
                        <span>{label}</span>
                      </div>
                    ),
                  )}
                </div>
                <div className="update-card">
                  <span className="update-icon">
                    <Icon name="briefcase" />
                  </span>
                  <div>
                    <strong>Team dispatched</strong>
                    <p>City Engineering · 25 minutes ago</p>
                  </div>
                </div>
              </div>
              <div className="floating-card fc-one">
                <Icon name="clock" />
                <div>
                  <strong>2.4 days</strong>
                  <span>Average response</span>
                </div>
              </div>
              <div className="floating-card fc-two">
                <span className="avatar-stack">
                  <i>MR</i>
                  <i>AJ</i>
                  <i>+8</i>
                </span>
                <div>
                  <strong>Connected teams</strong>
                  <span>Ready to respond</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="stat-strip">
          <div>
            <strong>12,480+</strong>
            <span>Requests resolved</span>
          </div>
          <i />
          <div>
            <strong>42</strong>
            <span>Connected barangays</span>
          </div>
          <i />
          <div>
            <strong>91%</strong>
            <span>Resident satisfaction</span>
          </div>
          <i />
          <div>
            <strong>24/7</strong>
            <span>Request tracking</span>
          </div>
        </section>
        <section className="section-wrap" id="how">
          <div className="section-heading">
            <span className="eyebrow">Simple by design</span>
            <h2>Help is three steps away</h2>
            <p>
              No lines, no guesswork. Your concern reaches the right team and
              stays visible to you.
            </p>
          </div>
          <div className="steps-grid">
            {[
              [
                "01",
                "Tell us what you need",
                "Choose a service, describe the concern, and pin the exact location.",
              ],
              [
                "02",
                "We route it for you",
                "Your barangay verifies the request and connects the right city team.",
              ],
              [
                "03",
                "Follow every update",
                "Track progress, receive notices, and confirm when the work is complete.",
              ],
            ].map(([num, title, text], i) => (
              <div className="step-card" key={num}>
                <span className="step-number">{num}</span>
                <div className="step-icon">
                  <Icon name={i === 0 ? "file" : i === 1 ? "route" : "check"} />
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
                {i < 2 && (
                  <span className="step-connector">
                    <Icon name="arrow" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="services-section" id="services">
          <div className="section-wrap">
            <div className="section-heading horizontal">
              <div>
                <span className="eyebrow">Community services</span>
                <h2>What can we help with?</h2>
              </div>
              <p>
                From everyday concerns to essential documents, start with the
                service that best fits your need.
              </p>
            </div>
            <div className="services-grid">
              {services.map((item) => (
                <button
                  className="service-card"
                  key={item.title}
                  onClick={() => navigate("login")}
                >
                  <span>
                    <Icon name={item.icon} />
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  <b>
                    View services <Icon name="arrow" size={16} />
                  </b>
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="help-banner" id="help">
          <div>
            <span className="help-icon">
              <Icon name="help" />
            </span>
            <div>
              <h2>Not sure where to start?</h2>
              <p>
                Call the Community Help Desk at <strong>(049) 562-3221</strong>,
                Monday–Friday, 8:00 AM–5:00 PM.
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => navigate("anonymous")}>
            Report anonymously
          </Button>
        </section>
      </main>
      <footer className="public-footer">
        <Logo />
        <p>Making local government services easier to reach.</p>
        <span>© 2026 LinkBarangay · Privacy · Accessibility</span>
      </footer>
    </div>
  )
}
