import assert from "node:assert/strict"
import test from "node:test"
import { assignmentStateLabel, isActionableAssignment, withCurrentAssignments } from "../src/lib/assignmentState.ts"

const row = (id, assigned_to = "a", status = "pending", extra = {}) => ({
  id, assigned_to, request_id: "request", status, department_id: "dept",
  created_at: `2026-11-14T10:00:0${id}.000000+00:00`,
  request: { assigned_to, status: "verified", department_id: "dept" }, ...extra,
})

test("reassignment keeps history but removes previous work from actionable counts", () => {
  const jobs = withCurrentAssignments([row("1", "a", "pending", {
    request: { assigned_to: "b", status: "assigned", department_id: "dept" },
  }), row("2", "b")])
  assert.equal(jobs.filter((job) => isActionableAssignment(job)).length, 1)
  assert.equal(assignmentStateLabel(jobs[0]), "Previous assignment")
  assert.equal(isActionableAssignment(jobs[1]), true)
})

test("A to B to A selects the latest A job across all statuses", () => {
  const jobs = withCurrentAssignments([row("1"), row("2", "b", "pending", { request: { assigned_to: "a", status: "verified", department_id: "dept" } }), row("3", "a", "completed")])
  assert.equal(jobs[0].current_assignment_id, "3")
  assert.equal(jobs.some((job) => isActionableAssignment(job)), false)
  const next = withCurrentAssignments([...jobs, row("4")])
  assert.deepEqual(next.filter((job) => isActionableAssignment(job)).map((job) => job.id), ["4"])
})

test("missing, rerouted, finished and wrong-department requests cannot be acted on", () => {
  const base = withCurrentAssignments([row("1")])[0]
  assert.equal(isActionableAssignment(base, "other-dept"), false)
  for (const request of [null, { ...base.request, status: "resolved" },
    { ...base.request, department_id: "other-dept" }, { ...base.request, assigned_to: null }]) {
    assert.equal(isActionableAssignment({ ...base, request }), false)
  }
})
