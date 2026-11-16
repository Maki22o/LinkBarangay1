import type { Assignment } from "../types/index.ts"

const ACTIVE = new Set(["pending", "accepted", "in_progress"])
const WORKABLE = new Set(["verified", "assigned", "in_progress"])

/** Historical rows stay visible; only the latest responsibility is actionable. */
export function withCurrentAssignments(rows: Assignment[]): Assignment[] {
  const latest = new Map<string, Assignment>()
  const micros = (value: string) => Date.parse(value) * 1000 +
    Number((value.match(/\.(\d+)/)?.[1] ?? "").slice(3).padEnd(3, "0"))
  for (const row of rows) {
    const key = `${row.request_id}:${row.assigned_to}`
    const previous = latest.get(key)
    if (!previous || micros(row.created_at) > micros(previous.created_at) ||
        (micros(row.created_at) === micros(previous.created_at) && row.id > previous.id)) {
      latest.set(key, row)
    }
  }
  return rows.map((row) => ({ ...row,
    current_assignment_id: latest.get(`${row.request_id}:${row.assigned_to}`)?.id ?? null,
  }))
}

export function isActionableAssignment(job: Assignment, departmentId?: string | null): boolean {
  return ACTIVE.has(job.status) && job.current_assignment_id === job.id && Boolean(
    job.request && WORKABLE.has(job.request.status) &&
    job.request.assigned_to === job.assigned_to &&
    job.request.department_id === job.department_id &&
    (departmentId === undefined || departmentId === job.department_id),
  )
}

export function assignmentStateLabel(job: Assignment): string {
  if (ACTIVE.has(job.status) && !isActionableAssignment(job)) return "Previous assignment"
  if (job.status === "pending") return "Assigned"
  return job.status.replaceAll("_", " ")
}
