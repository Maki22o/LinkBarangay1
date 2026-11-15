// ============================================================================
// LinkBarangay — request detail page (shared by all roles).
// Every status change goes through the server-side transition RPC; buttons
// render only when the signed-in profile's permissions allow the action.
// ============================================================================

import { useState } from "react"
import { Icon } from "@/components/common/Icon"
import { Button, Status, Priority, formatRef, formatDateTime } from "@/components/common/ui"
import { Modal } from "@/components/common/Modal"
import { ConfirmDialog } from "@/components/common/Modal"
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/common/States"
import { Field, Select, TextArea } from "@/components/forms/fields"
import { useAsync } from "@/hooks/useAsync"
import { useAuth } from "@/hooks/useAuth"
import { hasPermission } from "@/permissions/permissions"
import { toLocalDateTimeInput } from "@/lib/dateTime"
import { assignmentStateLabel } from "@/lib/assignmentState"
import {
  addComment,
  assignField,
  escalateRequest,
  getRequest,
  listAttachments,
  replyToInfoRequest,
  transitionRequest,
  uploadAttachment,
  getAttachmentUrl,
  setRequestPriority,
} from "@/services/requestService"
import { listRequestAssignments } from "@/services/assignmentService"
import { listDepartments } from "@/services/configService"
import { listFieldPersonnel } from "@/services/profileService"
import { STATUS_LABELS } from "@/types"
import type { RequestStatus, ServiceRequest, ViewId } from "@/types"

const STAGE_INDEX: Record<string, number> = {
  submitted: 0,
  for_verification: 1,
  needs_information: 1,
  verified: 2,
  assigned: 3,
  in_progress: 4,
  for_inspection: 4,
  resolved: 5,
  closed: 5,
}
const STAGES = ["Submitted", "Verified", "Assigned", "In progress", "Inspection", "Resolved"]

export function RequestDetailPage({
  requestId,
  setView,
}: {
  requestId: string
  setView: (view: ViewId) => void
}) {
  const { profile } = useAuth()
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<
    | null
    | { kind: "reject" }
    | { kind: "needs-info" }
    | { kind: "route" }
    | { kind: "assign" }
    | { kind: "close" }
    | { kind: "reopen" }
    | { kind: "escalate" }
  >(null)
  const [comment, setComment] = useState("")
  const [reply, setReply] = useState("")
  const [uploading, setUploading] = useState(false)

  const detail = useAsync(() => getRequest(requestId), [requestId])
  const attachments = useAsync(() => listAttachments(requestId), [requestId])
  const assignments = useAsync(() => listRequestAssignments(requestId), [requestId])
  const departments = useAsync(() => listDepartments(), [])
  const fieldStaff = useAsync(
    () =>
      profile && ((profile.role === "worker" && profile.worker_function === "dispatcher") || profile.role === "admin")
        ? listFieldPersonnel(
            detail.data?.request.department_id ?? profile.department_id ?? null,
          )
        : Promise.resolve([]),
    [detail.data?.request.department_id, profile?.id],
  )

  if (detail.loading) return <LoadingState label="Loading request…" />
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.refresh} />
  if (!detail.data)
    return (
      <EmptyState
        icon="file"
        title="Request not found"
        hint="It may belong to another barangay or department."
      />
    )

  const request = detail.data.request
  const updates = detail.data.updates
  const role = profile?.role
  const isOwner = profile?.id && request.submitted_by === profile.id
  const stage = STAGE_INDEX[request.status] ?? 0

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      await fn()
      setModal(null)
      setNotice(label)
      detail.refresh()
      attachments.refresh()
      assignments.refresh()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canVerify = hasPermission(profile, "requests.verify")
  const canReject = hasPermission(profile, "requests.reject")
  const canRoute = hasPermission(profile, "requests.route")
  const canAssign = hasPermission(profile, "requests.assign")
  const canResolve = hasPermission(profile, "requests.resolve")
  const canEscalate = hasPermission(profile, "requests.escalate")
  const canComment = hasPermission(profile, "requests.comment")
  const canPrioritize = hasPermission(profile, "requests.prioritize")
  const staffBarangay = role === "worker" && profile?.worker_function === "barangay_staff"
  const mapUrl = request.location_details?.map_url

  const active = (status: RequestStatus) => request.status === status

  return (
    <div>
      <div className="detail-top">
        <div>
          <button className="back-link inline" onClick={() => setView("requests")}>
            <Icon name="arrow" size={16} /> Back to requests
          </button>
          <div className="detail-title">
            <div>
              <span className="page-kicker">{formatRef(request.reference)}</span>
              <h1>{request.title}</h1>
              <p>
                {request.is_custom ? "Custom Request" : request.category?.name ?? "Uncategorized"} · {request.location || "No location"} ·
                Submitted {formatDateTime(request.created_at)}
              </p>
            </div>
          </div>
        </div>
        <div className="detail-top-side">
          <Status status={request.status} />
          <Priority level={request.priority} />
        </div>
      </div>

      {notice && <Notice tone="success">{notice}</Notice>}
      {actionError && <Notice tone="error">{actionError}</Notice>}

      <div className="detail-layout">
        <main>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Progress</h2>
                <p>Controlled workflow — every step is recorded</p>
              </div>
            </div>
            <div className="horizontal-timeline">
              {STAGES.map((label, index) => (
                <div className={index <= stage ? "done" : ""} key={label}>
                  <i>{index < stage ? <Icon name="check" size={12} /> : null}</i>
                  <b>{label}</b>
                </div>
              ))}
            </div>
            {request.status === "rejected" && (
              <div className="history-list">
                <div>
                  <i>
                    <Icon name="alert" size={15} />
                  </i>
                  <p>
                    <strong>Rejected</strong>
                    {request.rejection_reason && ` — ${request.rejection_reason}`}
                  </p>
                </div>
              </div>
            )}
            {request.status === "needs_information" && request.needs_info_message && (
              <div className="history-list">
                <div>
                  <i>
                    <Icon name="help" size={15} />
                  </i>
                  <p>
                    <strong>Information requested</strong> — {request.needs_info_message}
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Description</h2>
                <p>As submitted{request.is_anonymous ? " (anonymous report)" : ""}</p>
              </div>
            </div>
            <div className="description-body">
              <p>{request.description || "No description provided."}</p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Activity &amp; updates</h2>
                <p>{updates.length} recorded event{updates.length === 1 ? "" : "s"}</p>
              </div>
            </div>
            {updates.length === 0 ? (
              <EmptyState icon="history" title="No activity yet" />
            ) : (
              <div className="history-list">
                {updates.map((update) => (
                  <div key={update.id}>
                    <i>
                      <Icon
                        name={
                          update.type === "comment"
                            ? "help"
                            : update.type === "escalation"
                              ? "alert"
                              : update.type === "assignment"
                                ? "briefcase"
                                : "check"
                        }
                        size={15}
                      />
                    </i>
                    <p>
                      <strong>
                        {update.new_status
                          ? STATUS_LABELS[update.new_status as RequestStatus] ?? update.new_status
                          : update.type.replaceAll("_", " ")}
                        {update.previous_status && update.new_status
                          ? ` (from ${STATUS_LABELS[update.previous_status as RequestStatus] ?? update.previous_status})`
                          : ""}
                      </strong>
                      {update.remarks && <> — {update.remarks}</>}
                      <small>
                        {update.actor_name} · {formatDateTime(update.created_at)}
                      </small>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {canComment && (
            <section className="panel action-panel">
              <h2>Add a comment</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (comment.trim()) {
                    void run("Comment added.", () => addComment(request.id, comment.trim()).then(() => setComment("")))
                  }
                }}
              >
                <TextArea
                  value={comment}
                  onChange={setComment}
                  placeholder={
                    role === "resident"
                      ? "Add details, reply to staff questions, or leave feedback…"
                      : "Add an internal or resident-visible note…"
                  }
                  rows={3}
                />
                <div>
                  <Button type="submit" disabled={busy || !comment.trim()}>
                    Post comment
                  </Button>
                </div>
              </form>
            </section>
          )}

          {isOwner && active("needs_information") && (
            <section className="panel action-panel">
              <h2>Respond to the information request</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (reply.trim()) {
                    void run("Reply sent — the barangay will re-verify.", () =>
                      replyToInfoRequest(request.id, reply.trim()).then(() => setReply("")),
                    )
                  }
                }}
              >
                <TextArea
                  value={reply}
                  onChange={setReply}
                  placeholder="Provide the information the barangay asked for…"
                  rows={3}
                />
                <div>
                  <Button type="submit" icon="arrow" disabled={busy || !reply.trim()}>
                    Send reply
                  </Button>
                </div>
              </form>
            </section>
          )}
        </main>

        <aside className="detail-side">
          <section className="panel info-panel">
            <h2>Request information</h2>
            <dl>
              <div>
                <dt>Reference</dt>
                <dd>{formatRef(request.reference)}</dd>
              </div>
              <div>
                <dt>Barangay</dt>
                <dd>{request.barangay?.name ?? "—"}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{request.department?.name ?? "Not routed yet"}</dd>
              </div>
              <div>
                <dt>Submitter</dt>
                <dd>
                  {request.is_anonymous
                    ? "Anonymous"
                    : (request.submitter?.full_name ?? request.submitter_name ?? "—")}
                </dd>
              </div>
              {!request.is_anonymous && request.submitter?.mobile && (
                <div>
                  <dt>Contact</dt>
                  <dd>{request.submitter.mobile}</dd>
                </div>
              )}
              <div>
                <dt>Priority</dt>
                <dd style={{ display: "grid", gap: 8 }}>
                  <Priority level={request.priority} />
                  {canPrioritize && (
                    <Select
                      value={["high", "medium", "low"].includes(request.priority) ? request.priority : "medium"}
                      onChange={(value) => void run("Request priority updated.", () => setRequestPriority(request.id, value as "high" | "medium" | "low"))}
                      options={[
                        { value: "high", label: "High" },
                        { value: "medium", label: "Medium" },
                        { value: "low", label: "Low" },
                      ]}
                    />
                  )}
                </dd>
              </div>
              {request.due_at && (
                <div>
                  <dt>Due</dt>
                  <dd>{formatDateTime(request.due_at)}</dd>
                </div>
              )}
              {request.escalation_count > 0 && (
                <div>
                  <dt>Escalated</dt>
                  <dd>{request.escalation_count}×</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="panel location-panel">
            <h2>Location</h2>
            {mapUrl ? <iframe className="mini-map" title="Reported location map" src={`https://www.google.com/maps?q=${encodeURIComponent(request.location)}&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : <div className="mini-map"><span><Icon name="pin" size={14} /></span></div>}
            <strong>{request.location || "No location provided"}</strong>
            <p>{request.barangay?.name ?? ""}</p>
            {request.location_latitude != null && request.location_longitude != null && (
              <>
                <p>Lat {Number(request.location_latitude).toFixed(6)} · Lng {Number(request.location_longitude).toFixed(6)}</p>
                <a className="location-directions" href={`https://www.google.com/maps/dir/?api=1&destination=${request.location_latitude},${request.location_longitude}`} target="_blank" rel="noreferrer">Open directions <Icon name="arrow" size={13} /></a>
              </>
            )}
            {mapUrl && <a className="location-directions" href={mapUrl} target="_blank" rel="noreferrer">Open in Google Maps <Icon name="arrow" size={13} /></a>}
          </section>

          {(isOwner || (role === "worker" && profile?.worker_function === "dispatcher") || role === "admin" || staffBarangay) && (
            <section className="panel assigned-panel">
              <h2>{isOwner ? "Appointment and service schedule" : "Field assignments"}</h2>
              {assignments.loading ? (
                <LoadingState />
              ) : !assignments.data || assignments.data.length === 0 ? (
                <p className="muted-note">No appointment or field assignment has been scheduled yet.</p>
              ) : (
                assignments.data.map((assignment) => (
                  <div key={assignment.id}>
                    {!isOwner && <span className="person-avatar">
                      {(assignment.assignee?.full_name ?? "?").slice(0, 2).toUpperCase()}
                    </span>}
                    <p>
                      {!isOwner && <strong>{assignment.assignee?.full_name ?? "Field personnel"}</strong>}
                      <small>
                        {isOwner ? `Appointment ${assignment.appointment_status}` : assignmentStateLabel(assignment)}
                        {assignment.schedule_at ? ` · ${formatDateTime(assignment.schedule_at)}` : ""}
                        {assignment.deadline_at ? ` · estimated completion ${formatDateTime(assignment.deadline_at)}` : ""}
                        {assignment.duration_minutes ? ` · ${assignment.duration_minutes} minutes` : ""}
                      </small>
                    </p>
                  </div>
                ))
              )}
            </section>
          )}

          <section className="panel attachments-panel">
            <h2>Attachments</h2>
            {attachments.loading ? (
              <LoadingState />
            ) : !attachments.data || attachments.data.length === 0 ? (
              <p className="muted-note">No files attached.</p>
            ) : (
              <ul className="attachment-list">
                {attachments.data.map((file) => (
                  <li key={file.id}>
                    <Icon name="file" size={14} />
                    <button
                      onClick={() =>
                        void getAttachmentUrl(file.storage_path)
                          .then((url) => window.open(url, "_blank"))
                          .catch((err: Error) => setActionError(err.message))
                      }
                    >
                      {file.file_name}
                    </button>
                    <small>{file.kind.replaceAll("_", " ")}</small>
                  </li>
                ))}
              </ul>
            )}
            {isOwner &&
              (request.status === "submitted" || request.status === "needs_information") && (
                <label className="upload-zone compact">
                  <Icon name="upload" size={16} />
                  <strong>{uploading ? "Uploading…" : "Attach a supporting file"}</strong>
                  <small>Images or PDF, max 10 MB</small>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    disabled={uploading}
                    onChange={async (event) => {
                      const file = event.target.files?.[0]
                      if (!file || !profile) return
                      setUploading(true)
                      setActionError(null)
                      try {
                        await uploadAttachment(request.id, profile.id, file, "supporting_doc")
                        attachments.refresh()
                      } catch (err) {
                        setActionError((err as Error).message)
                      } finally {
                        setUploading(false)
                        event.target.value = ""
                      }
                    }}
                  />
                </label>
              )}
          </section>

          {(canVerify || canReject || canRoute || canAssign || canResolve || canEscalate || isOwner) && (
            <section className="panel action-panel">
              <h2>Actions</h2>
              <div className="action-buttons">
                {staffBarangay && active("submitted") && canVerify && (
                  <Button
                    variant="secondary"
                    icon="shield"
                    disabled={busy}
                    onClick={() =>
                      run("Moved to verification queue.", () =>
                        transitionRequest(request.id, "for_verification", "Intake review started"),
                      )
                    }
                  >
                    Start verification
                  </Button>
                )}
                {canVerify && active("for_verification") && (
                  <Button
                    icon="check"
                    disabled={busy}
                    onClick={() =>
                      run("Request verified.", () =>
                        transitionRequest(request.id, "verified", "Verified by barangay"),
                      )
                    }
                  >
                    Verify
                  </Button>
                )}
                {canVerify && active("for_verification") && (
                  <Button
                    variant="secondary"
                    icon="help"
                    disabled={busy}
                    onClick={() => setModal({ kind: "needs-info" })}
                  >
                    Request information
                  </Button>
                )}
                {canReject && (active("submitted") || active("for_verification")) && (
                  <Button
                    variant="danger"
                    icon="close"
                    disabled={busy}
                    onClick={() => setModal({ kind: "reject" })}
                  >
                    Reject
                  </Button>
                )}
                {canRoute && active("verified") && (
                  <Button icon="route" disabled={busy} onClick={() => setModal({ kind: "route" })}>
                    Route to department
                  </Button>
                )}
                {canAssign && (active("assigned") || active("verified")) && (
                  <Button
                    icon="briefcase"
                    disabled={busy}
                    onClick={() => setModal({ kind: "assign" })}
                  >
                    Assign field personnel
                  </Button>
                )}
                {canResolve && active("for_inspection") && (
                  <Button
                    icon="check"
                    disabled={busy}
                    onClick={() =>
                      run("Request resolved.", () =>
                        transitionRequest(request.id, "resolved", "Work inspected and accepted"),
                      )
                    }
                  >
                    Mark resolved
                  </Button>
                )}
                {(isOwner || canReject) && active("resolved") && (
                  <Button
                    icon="check"
                    disabled={busy}
                    onClick={() => setModal({ kind: "close" })}
                  >
                    Confirm &amp; close
                  </Button>
                )}
                {(isOwner || canVerify) &&
                  (active("resolved") || active("closed") || active("rejected")) && (
                    <Button
                      variant="secondary"
                      icon="history"
                      disabled={busy}
                      onClick={() => setModal({ kind: "reopen" })}
                    >
                      Reopen
                    </Button>
                  )}
                {canEscalate &&
                  !["resolved", "closed", "rejected"].includes(request.status) && (
                    <Button
                      variant="secondary"
                      icon="alert"
                      disabled={busy}
                      onClick={() => setModal({ kind: "escalate" })}
                    >
                      Escalate
                    </Button>
                  )}
              </div>
            </section>
          )}
        </aside>
      </div>

      {modal?.kind === "reject" && (
        <RemarksModal
          title="Reject this request"
          intro="The submitter will see this explanation. A reason is required."
          confirmLabel="Reject request"
          danger
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(remarks) =>
            run("Request rejected.", () => transitionRequest(request.id, "rejected", remarks))
          }
        />
      )}
      {modal?.kind === "needs-info" && (
        <RemarksModal
          title="Request more information"
          intro="Describe exactly what the resident needs to provide."
          confirmLabel="Request information"
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(remarks) =>
            run("Information requested.", () =>
              transitionRequest(request.id, "needs_information", remarks),
            )
          }
        />
      )}
      {modal?.kind === "route" && (
        <RouteModal
          departments={departments.data ?? []}
          busy={busy}
          currentDepartmentId={request.department_id ?? ""}
          onClose={() => setModal(null)}
          onConfirm={(departmentId, remarks) =>
            run("Routed to department.", () =>
              transitionRequest(request.id, "assigned", remarks || undefined, {
                department_id: departmentId,
              }),
            )
          }
        />
      )}
      {modal?.kind === "assign" && (
        <AssignFieldModal
          fieldStaff={fieldStaff.data ?? []}
          dueAt={request.due_at}
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(input) =>
            run("Field personnel assigned.", () =>
              assignField(request.id, input.userId, {
                deadlineAt: input.deadlineAt,
                scheduleAt: input.scheduleAt,
                notes: input.notes,
              }),
            )
          }
        />
      )}
      {modal?.kind === "close" && (
        <ConfirmDialog
          title="Close this request"
          message="Confirming closes the request. You can reopen it within the allowed window if needed."
          confirmLabel="Close request"
          onCancel={() => setModal(null)}
          onConfirm={() =>
            run("Request closed.", () =>
              transitionRequest(
                request.id,
                "closed",
                isOwner ? "Confirmed resolved by resident" : "Closed after resolution",
              ),
            )
          }
        />
      )}
      {modal?.kind === "reopen" && (
        <RemarksModal
          title="Reopen this request"
          intro="Explain why the request is being reopened."
          confirmLabel="Reopen request"
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(remarks) =>
            run("Request reopened for verification.", () =>
              transitionRequest(request.id, "for_verification", remarks),
            )
          }
        />
      )}
      {modal?.kind === "escalate" && (
        <RemarksModal
          title="Escalate this request"
          intro="Escalation raises the request's priority and flags it for supervisors."
          confirmLabel="Escalate"
          busy={busy}
          optional
          onClose={() => setModal(null)}
          onConfirm={(remarks) =>
            run("Request escalated.", () => escalateRequest(request.id, remarks))
          }
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
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
      <Field label={optional ? "Remarks (optional)" : "Remarks"} required={!optional}>
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

function RouteModal({
  departments,
  currentDepartmentId,
  busy,
  onClose,
  onConfirm,
}: {
  departments: { id: string; name: string }[]
  currentDepartmentId: string
  busy: boolean
  onClose: () => void
  onConfirm: (departmentId: string, remarks: string) => void
}) {
  const [departmentId, setDepartmentId] = useState(currentDepartmentId)
  const [remarks, setRemarks] = useState("")
  return (
    <Modal title="Route to department" onClose={onClose}>
      <Field label="Department" required>
        <Select
          value={departmentId}
          onChange={setDepartmentId}
          options={[
            { value: "", label: "Select department" },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </Field>
      <Field label="Routing note (optional)">
        <TextArea value={remarks} onChange={setRemarks} rows={3} />
      </Field>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !departmentId} onClick={() => onConfirm(departmentId, remarks.trim())}>
          Route request
        </Button>
      </div>
    </Modal>
  )
}

function AssignFieldModal({
  fieldStaff,
  dueAt,
  busy,
  onClose,
  onConfirm,
}: {
  fieldStaff: { id: string; full_name: string }[]
  dueAt: string | null
  busy: boolean
  onClose: () => void
  onConfirm: (input: {
    userId: string
    scheduleAt: string | null
    deadlineAt: string | null
    notes: string
  }) => void
}) {
  const [userId, setUserId] = useState("")
  const [scheduleAt, setScheduleAt] = useState("")
  const [deadlineAt, setDeadlineAt] = useState(
    toLocalDateTimeInput(dueAt),
  )
  const [notes, setNotes] = useState("")

  return (
    <Modal title="Assign field personnel" onClose={onClose}>
      {fieldStaff.length === 0 ? (
        <Notice tone="warning">
          No active field personnel found for this department. Ask the administrator to create
          field staff accounts first.
        </Notice>
      ) : (
        <>
          <Field label="Field personnel" required>
            <Select
              value={userId}
              onChange={setUserId}
              options={[
                { value: "", label: "Select personnel" },
                ...fieldStaff.map((person) => ({
                  value: person.id,
                  label: person.full_name,
                })),
              ]}
            />
          </Field>
          <div className="form-grid">
            <Field label="Appointment date and time (optional)">
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(event) => setScheduleAt(event.target.value)}
              />
            </Field>
            <Field label="Estimated completion date and time">
              <input
                type="datetime-local"
                value={deadlineAt}
                onChange={(event) => setDeadlineAt(event.target.value)}
              />
            </Field>
          </div>
          {scheduleAt && deadlineAt && new Date(deadlineAt) > new Date(scheduleAt) && (
            <p className="field-help">Estimated service duration: {Math.ceil((new Date(deadlineAt).getTime() - new Date(scheduleAt).getTime()) / 60000)} minutes. Availability and overlapping field appointments are checked before saving.</p>
          )}
          <Field label="Work instructions (optional)">
            <TextArea value={notes} onChange={setNotes} rows={3} />
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || !userId}
              onClick={() =>
                onConfirm({
                  userId,
                  scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
                  deadlineAt: deadlineAt ? new Date(deadlineAt).toISOString() : null,
                  notes: notes.trim(),
                })
              }
            >
              Assign job
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

export type { ServiceRequest }
