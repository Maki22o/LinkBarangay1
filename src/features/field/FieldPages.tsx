// ============================================================================
// LinkBarangay — field personnel workspace (dashboard, assigned jobs, job
// detail with accept/decline/progress/completion)
// ============================================================================

import { useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button, MetricCard, Priority, Status, formatRef, formatDateTime } from "@/components/common/ui"
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/common/States"
import { Modal } from "@/components/common/Modal"
import { Field, TextArea } from "@/components/forms/fields"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { useRequestRealtimeRefresh } from "@/hooks/useRequestRealtime"
import { assignmentStateLabel, isActionableAssignment } from "@/lib/assignmentState"
import { manilaDateTime, manilaInput } from "@/lib/dateTime"
import { FieldBookingCalendar } from "@/features/dispatcher/FieldBookingCalendar"
import {
  acceptAssignment,
  completeJob,
  declineAssignment,
  getAssignment,
  listMyAssignments,
  reportFieldJob,
  startFieldJob,
  updateJobProgress,
} from "@/services/assignmentService"
import type { FieldJobOutcome } from "@/services/assignmentService"
import {
  uploadAttachment,
  listAttachments,
  getAttachmentUrl,
} from "@/services/requestService"
import { requestRealtimeFilter } from "@/services/requestService"
import type { Assignment, ViewId } from "@/types"

const jobTabs = {
  open: "Open jobs", today: "Today", upcoming: "Upcoming", in_progress: "In progress",
  overdue: "Overdue", completed: "Completed", all: "All",
}
type JobTab = keyof typeof jobTabs

function jobEstimate(job: Assignment) {
  return job.request?.estimate_recorded_at ? job.request.estimated_completion_at
    : job.status !== "cancelled" ? job.deadline_at : null
}

export function FieldDashboard({
  setView,
  openJob,
}: {
  setView: (view: ViewId) => void
  openJob: (assignmentId: string) => void
}) {
  const { profile } = useAuth()
  const jobs = useAsync(
    () => (profile ? listMyAssignments(profile.id) : Promise.resolve([])),
    [profile?.id, profile?.department_id],
  )
  const requestFilter = profile ? requestRealtimeFilter(profile) : undefined
  useRequestRealtimeRefresh(jobs.refresh, {
    enabled: Boolean(profile && requestFilter),
    filter: requestFilter,
  })
  useRequestRealtimeRefresh(jobs.refresh, { enabled: Boolean(profile), table: "lb_assignments", filter: `assigned_to=eq.${profile?.id}` })

  if (jobs.loading) return <LoadingState label="Loading your day…" />
  if (jobs.error) return <ErrorState message={jobs.error} onRetry={jobs.refresh} />

  const all = jobs.data ?? []
  const pending = all.filter((j) => j.status === "pending" && isActionableAssignment(j, profile?.department_id))
  const activeJobs = all.filter((j) => ["in_progress", "accepted"].includes(j.status) && isActionableAssignment(j, profile?.department_id))
  const completed = all.filter((j) => j.status === "completed")
  const declined = all.filter((j) => j.status === "declined")

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">MY DAY</span>
          <h1>Good day, {(profile?.full_name ?? "").split(" ")[0] || "there"}</h1>
          <p>Your assignments from the department dispatcher.</p>
        </div>
        <Button icon="briefcase" onClick={() => setView("jobs")}>
          All assigned jobs
        </Button>
      </div>

      <div className="metrics-grid">
        <MetricCard label="To accept" value={pending.length} icon="briefcase" />
        <MetricCard label="In progress" value={activeJobs.length} tone="amber" icon="route" />
        <MetricCard label="Completed" value={completed.length} tone="green" icon="check" />
        <MetricCard label="Declined" value={declined.length} tone="red" icon="close" />
      </div>

      <div className="dashboard-grid">
        <section className="panel span-two">
          <div className="panel-head">
            <div>
              <h2>Needs your action</h2>
              <p>New assignments and active work</p>
            </div>
          </div>
          {pending.length + activeJobs.length === 0 ? (
            <EmptyState
              icon="check"
              title="No open assignments"
              hint="When the dispatcher assigns you a job, it appears here."
            />
          ) : (
            <div className="job-list">
              {[...pending, ...activeJobs].map((job) => (
                <button key={job.id} onClick={() => openJob(job.id)}>
                  <span className="job-order">
                    {job.status === "pending" ? <Icon name="bell" size={13} /> : <Icon name="route" size={13} />}
                  </span>
                  <div className="job-main">
                    <span>
                      <Status status={job.request?.status ?? "assigned"} />
                    </span>
                    <h3>{job.request?.title ?? "Previous assignment"}</h3>
                    <p>
                      <Icon name="pin" size={12} /> {job.request?.location || "No location"}
                    </p>
                  </div>
                  <div className="job-time">
                    <small>ESTIMATED COMPLETION</small>
                    <strong>{manilaDateTime(jobEstimate(job))}</strong>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel activity-panel">
          <div className="panel-head">
            <div>
              <h2>Recently completed</h2>
              <p>Ready for inspection</p>
            </div>
          </div>
          {completed.length === 0 ? (
            <EmptyState icon="check" title="Nothing completed yet" />
          ) : (
            <div className="queue-list">
              {completed.slice(0, 5).map((job) => (
                <button key={job.id} onClick={() => openJob(job.id)}>
                  <div>
                    <strong>{job.request?.title ?? "Previous assignment"}</strong>
                    <small>
                      Completed {job.completed_at ? formatDateTime(job.completed_at) : "—"}
                    </small>
                  </div>
                  <Icon name="arrow" size={14} />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
export function JobsPage({
  setView,
  openJob,
}: {
  setView: (view: ViewId) => void
  openJob: (assignmentId: string) => void
}) {
  const { profile } = useAuth()
  const [filter, setFilter] = useState<JobTab>("open")
  const [calendar, setCalendar] = useState(false)
  const jobs = useAsync(
    () => (profile ? listMyAssignments(profile.id) : Promise.resolve([])),
    [profile?.id, profile?.department_id],
  )
  const requestFilter = profile ? requestRealtimeFilter(profile) : undefined
  useRequestRealtimeRefresh(jobs.refresh, {
    enabled: Boolean(profile && requestFilter),
    filter: requestFilter,
  })
  useRequestRealtimeRefresh(jobs.refresh, { enabled: Boolean(profile), table: "lb_assignments", filter: `assigned_to=eq.${profile?.id}` })

  if (jobs.loading) return <LoadingState label="Loading jobs…" />
  if (jobs.error) return <ErrorState message={jobs.error} onRetry={jobs.refresh} />

  const all = jobs.data ?? []
  const now = Date.now()
  const rows = all.filter((job) => filterMatch(job, filter, now, profile?.department_id))
  if (filter === "today" || filter === "upcoming") rows.sort((a, b) => Date.parse(a.schedule_at ?? "") - Date.parse(b.schedule_at ?? ""))

  return (
    <div>
      <div className="welcome-row">
        <div>
          <span className="page-kicker">FIELD WORK</span>
          <h1>My Assigned Jobs</h1>
          <p>Accept, progress, and complete your assignments.</p>
        </div>
        <div className="schedule-pagination">
          <Button variant="secondary" onClick={() => setView("availability")}>My availability</Button>
          <Button variant="secondary" onClick={() => setCalendar((shown) => !shown)}>{calendar ? "Hide schedule" : "My schedule"}</Button>
        </div>
      </div>
      {calendar && <FieldBookingCalendar departmentId={profile?.department_id ?? null} openJob={openJob} includeCapacity={false} />}
      <div className="panel">
        <div className="queue-tabs">
          {(Object.keys(jobTabs) as JobTab[]).map((tab) => (
            <button
              className={filter === tab ? "active" : ""}
              key={tab}
              onClick={() => setFilter(tab)}
            >
              {jobTabs[tab]}
              <b>{all.filter((job) => filterMatch(job, tab, now, profile?.department_id)).length}</b>
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="briefcase" title="No jobs in this view" />
        ) : (
          <div className="job-list">
            {rows.map((job) => (
              <button key={job.id} onClick={() => openJob(job.id)}>
                <span className="job-order">
                  {formatRef(job.request?.reference).slice(-4)}
                </span>
                <div className="job-main">
                  <span>
                    <Status status={assignmentStateLabel(job)} />
                    {job.request && <Priority level={job.request.priority} />}
                  </span>
                  <h3>{job.request?.title ?? "Previous assignment"}</h3>
                  <p>
                    <Icon name="pin" size={12} /> {job.request?.location || "No location"}
                    {job.request?.category?.name ? ` · ${job.request.category.name}` : ""}
                  </p>
                  <small className="field-job-mobile-schedule">
                    {job.schedule_at ? manilaDateTime(job.schedule_at) : "No appointment"} · Estimated completion {manilaDateTime(jobEstimate(job))}
                  </small>
                </div>
                <div className="job-time">
                  <small>PHILIPPINE TIME</small>
                  <strong>{job.schedule_at ? manilaDateTime(job.schedule_at) : "No appointment"}</strong>
                  <span>Estimated completion {manilaDateTime(jobEstimate(job))}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function filterMatch(job: Assignment, tab: JobTab, now: number, departmentId?: string | null) {
  if (tab === "all") return true
  if (tab === "completed") return ["completed", "verified"].includes(job.status)
  if (!isActionableAssignment(job, departmentId)) return false
  if (tab === "open") return true
  if (tab === "in_progress") return job.status === "in_progress"
  if (tab === "today") return Boolean(job.schedule_at && manilaInput(job.schedule_at).slice(0, 10) === manilaInput(now).slice(0, 10))
  if (tab === "upcoming") return Date.parse(job.schedule_at ?? "") > now
  return Date.parse(jobEstimate(job) ?? "") < now
}

// ---------------------------------------------------------------------------
export function JobDetailPage({
  assignmentId,
  setView,
}: {
  assignmentId: string
  setView: (view: ViewId) => void
}) {
  const { profile } = useAuth()
  const jobs = useAsync(
    () => (profile ? getAssignment(assignmentId) : Promise.resolve(null)),
    [profile?.id, assignmentId],
  )
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<null | "decline" | "progress" | "complete" | FieldJobOutcome>(null)
  const [photoBusy, setPhotoBusy] = useState<false | "before" | "after">(false)
  useRequestRealtimeRefresh(jobs.refresh, { table: "lb_assignments", filter: `id=eq.${assignmentId}` })
  useRequestRealtimeRefresh(jobs.refresh, { enabled: Boolean(jobs.data), filter: `id=eq.${jobs.data?.request_id}` })

  const handlePhotoUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    kind: "before_photo" | "after_photo",
  ) => {
    const file = event.target.files?.[0]
    if (!file || !profile || !request) return
    setPhotoBusy(kind === "before_photo" ? "before" : "after")
    setError(null)
    try {
      await uploadAttachment(request.id, profile.id, file, kind)
      jobs.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPhotoBusy(false)
      event.target.value = ""
    }
  }

  if (jobs.loading) return <LoadingState label="Loading job…" />
  if (jobs.error) return <ErrorState message={jobs.error} onRetry={jobs.refresh} />
  const job = jobs.data?.assigned_to === profile?.id ? jobs.data : null
  if (!job) {
    return (
      <EmptyState
        icon="briefcase"
        title="Job not found"
        hint="It may have been reassigned."
        action={<Button onClick={() => setView("jobs")}>Back to jobs</Button>}
      />
    )
  }

  const request = job.request
  const actionable = isActionableAssignment(job, profile?.department_id)
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setModal(null)
      setNotice(label)
      jobs.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="detail-top">
        <div>
          <button className="back-link inline" onClick={() => setView("jobs")}>
            <Icon name="arrow" size={16} /> Back to jobs
          </button>
          <div className="detail-title">
            <div>
              <span className="page-kicker">{formatRef(request?.reference)}</span>
              <h1>{request?.title ?? "Previous assignment"}</h1>
              <p>
                {request?.category?.name ?? "Uncategorized"} ·{" "}
                {request?.location || "No location"} · Estimated completion {manilaDateTime(jobEstimate(job))}
              </p>
            </div>
          </div>
        </div>
        <div className="detail-top-side">
          <Status status={assignmentStateLabel(job)} />
          {request && <Priority level={request.priority} />}
        </div>
      </div>

      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!actionable && <Notice tone="info">This assignment is kept for your history. Its actions are unavailable because the job was reassigned, completed, or its scope changed.</Notice>}

      <div className="detail-layout">
        <main>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Work instructions</h2>
                <p>From the dispatcher</p>
              </div>
            </div>
            <div className="description-body">
              <p>{job.notes || "No special instructions — follow standard procedure."}</p>
              {!request?.is_anonymous && request?.submitter_name && <p>Resident: {request.submitter_name}</p>}
              {request?.description && (
                <>
                  <hr />
                  <p>
                    <strong>Resident's report:</strong> {request.description}
                  </p>
                </>
              )}
            </div>
          </section>

          {(job.progress_notes || job.completion_remarks || job.decline_reason || job.delay_reason) && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Work log</h2>
                  <p>Latest progress and completion remarks</p>
                </div>
              </div>
              <div className="history-list">
                {[job.progress_notes, job.completion_remarks, job.decline_reason, job.delay_reason].filter(Boolean).map((line, index) => (
                  <div key={index}>
                    <i>
                      <Icon name="check" size={14} />
                    </i>
                    <p>{line}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        <aside className="detail-side">
          <section className="panel action-panel">
            <h2>Job actions</h2>
            <div className="action-buttons">
              {actionable && job.status === "pending" && (
                <>
                  <Button
                    icon="check"
                    disabled={busy}
                    onClick={() => run("Job accepted — status updated.", () => acceptAssignment(job.id))}
                  >
                    Accept assignment
                  </Button>
                  <Button
                    variant="danger"
                    icon="close"
                    disabled={busy}
                    onClick={() => setModal("decline")}
                  >
                    Decline with reason
                  </Button>
                </>
              )}
              {actionable && job.status === "accepted" &&
                <Button icon="check" disabled={busy} onClick={() => void run("Work started.", () => startFieldJob(job.id))}>Start work</Button>}
              {actionable && job.status === "in_progress" && (
                <>
                  <Button icon="route" disabled={busy} onClick={() => setModal("progress")}>
                    Add progress note
                  </Button>
                  <Button icon="check" disabled={busy} onClick={() => setModal("complete")}>
                    Submit completion report
                  </Button>
                </>
              )}
              {actionable && <>
                <Button variant="secondary" disabled={busy} onClick={() => setModal("needs_rescheduling")}>Request rescheduling</Button>
                <Button variant="secondary" disabled={busy} onClick={() => setModal("unable_to_complete")}>Unable to complete</Button>
                <Button variant="secondary" disabled={busy} onClick={() => setModal("delayed")}>Report a delay</Button>
              </>}
              {["completed", "verified"].includes(job.status) && (
                <Notice tone="info">
                  Work submitted and awaiting barangay inspection.
                </Notice>
              )}
            </div>
          </section>

          <section className="panel attachments-panel">
            <h2>Before / after photos</h2>
            {request && <JobPhotos requestId={job.request_id} />}
            {actionable && ["accepted", "in_progress"].includes(job.status) && (
              <div className="upload-row">
                <label className="upload-zone compact">
                  <Icon name="upload" size={16} />
                  <strong>{photoBusy === "before" ? "Uploading…" : "Before photo"}</strong>
                  <small>Images, max 10 MB</small>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={Boolean(photoBusy)}
                    onChange={(event) =>
                      void handlePhotoUpload(event, "before_photo")
                    }
                  />
                </label>
                <label className="upload-zone compact">
                  <Icon name="upload" size={16} />
                  <strong>{photoBusy === "after" ? "Uploading…" : "After photo"}</strong>
                  <small>Images, max 10 MB</small>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={Boolean(photoBusy)}
                    onChange={(event) =>
                      void handlePhotoUpload(event, "after_photo")
                    }
                  />
                </label>
              </div>
            )}
          </section>

          <section className="panel info-panel">
            <h2>Assignment details</h2>
            <dl>
              <div>
                <dt>Assigned</dt>
                <dd>{formatDateTime(job.created_at)}</dd>
              </div>
              <div>
                <dt>Accepted</dt>
                <dd>{job.accepted_at ? formatDateTime(job.accepted_at) : "—"}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{job.completed_at ? formatDateTime(job.completed_at) : "—"}</dd>
              </div>
              {job.schedule_at && (
                <div>
                  <dt>Scheduled</dt>
                  <dd>{manilaDateTime(job.schedule_at)} (Philippine time)</dd>
                </div>
              )}
              {job.duration_minutes != null && <div><dt>Scheduled work duration</dt><dd>{job.duration_minutes} min</dd></div>}
            </dl>
          </section>
        </aside>
      </div>

      {actionable && modal === "decline" && (
        <RemarksModal
          title="Decline assignment"
          intro="The dispatcher is notified immediately so the job can be reassigned."
          confirmLabel="Decline"
          danger
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(reason) =>
            run("Assignment declined.", () => declineAssignment(job.id, reason))
          }
        />
      )}
      {actionable && modal === "progress" && (
        <RemarksModal
          title="Add progress note"
          intro="This update is visible to the dispatcher and the resident."
          confirmLabel="Save note"
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(remarks) =>
            run("Progress saved.", () => updateJobProgress(job.id, remarks))
          }
        />
      )}
      {actionable && (modal === "delayed" || modal === "unable_to_complete" || modal === "needs_rescheduling") && (
        <RemarksModal title={modal === "delayed" ? "Report a delay" : modal === "needs_rescheduling" ? "Request rescheduling" : "Unable to complete"}
          intro="The dispatcher will receive your reason." confirmLabel="Send to dispatcher" busy={busy} onClose={() => setModal(null)}
          onConfirm={(reason) => void run("Dispatcher notified.", () => reportFieldJob(job.id, modal, reason))} />
      )}
      {actionable && modal === "complete" && (
        <RemarksModal
          title="Submit completion report"
          intro="This marks the work ready for barangay inspection."
          confirmLabel="Submit report"
          busy={busy}
          optional
          onClose={() => setModal(null)}
          onConfirm={(remarks) => run("Completion submitted.", () => completeJob(job.id, remarks))}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Job photos (fetched fresh so uploads show immediately)
// ---------------------------------------------------------------------------
function JobPhotos({ requestId }: { requestId: string }) {
  const photos = useAsync(() => listAttachments(requestId), [requestId])

  if (photos.loading) return <LoadingState />
  if (photos.error) return <Notice tone="warning">{photos.error}</Notice>
  const rows = photos.data ?? []
  if (rows.length === 0)
    return (
      <p className="muted-note">
        No photos yet — upload before and after shots for the inspector.
      </p>
    )

  return (
    <ul className="attachment-list">
      {rows.map((file) => (
        <li key={file.id}>
          <Icon name="file" size={14} />
          <button
            onClick={() =>
              void getAttachmentUrl(file.storage_path)
                .then((url) => window.open(url, "_blank"))
                .catch((err: Error) => void err)
            }
          >
            {file.file_name}
          </button>
          <small>{file.kind.replaceAll("_", " ")}</small>
        </li>
      ))}
    </ul>
  )
}

function RemarksModal({
  title,
  intro,
  confirmLabel,
  busy,
  optional,
  danger,
  onClose,
  onConfirm,
}: {
  title: string
  intro: string
  confirmLabel: string
  busy: boolean
  optional?: boolean
  danger?: boolean
  onClose: () => void
  onConfirm: (remarks: string) => void
}) {
  const [remarks, setRemarks] = useState("")
  return (
    <Modal title={title} onClose={onClose}>
      <p className="modal-intro">{intro}</p>
      <Field label={optional ? "Remarks (optional)" : "Reason"} required={!optional}>
        <TextArea value={remarks} onChange={setRemarks} rows={4} required={!optional} />
      </Field>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          disabled={busy || (!optional && !remarks.trim())}
          onClick={() => onConfirm(remarks.trim())}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
