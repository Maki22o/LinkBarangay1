import assert from "node:assert/strict"
import test from "node:test"
import { notificationBadge, notificationDestination } from "../src/lib/notificationNavigation.ts"

const resident = { id: "resident-a", role: "resident", status: "active", worker_function: null }
const officer = { id: "officer-a", role: "worker", status: "active", worker_function: "officer" }
const field = { id: "field-a", role: "worker", status: "active", worker_function: "field" }
const secretary = { id: "secretary-a", role: "worker", status: "active", worker_function: "secretary" }
const admin = { id: "admin-a", role: "admin", status: "active", worker_function: null }
const item = (destination_view, entity_id = null, request_id = null) => ({ destination_view, entity_id, request_id })

test("counts use the same compact badge at all required thresholds", () => {
  for (const [count, label] of [[0, null], [1, "1"], [5, "5"], [25, "25"], [99, "99"], [100, "99+"], [432, "99+"]]) {
    assert.equal(notificationBadge(count), label)
  }
})

test("legacy request notifications resolve without metadata", () => {
  assert.deepEqual(notificationDestination({ request_id: "request-a" }, resident), {
    view: "request-detail", entityId: "request-a", record: "request",
  })
  assert.equal(notificationDestination({ request_id: null }, resident), null)
})

test("destinations are explicitly allowed, independent of permissive unknown-view handling", () => {
  for (const view of ["https://example.com", "javascript:alert(1)", "not-a-view", "landing", "submit", "job-detail "]) {
    assert.equal(notificationDestination(item(view, "entity-a"), admin), null)
  }
})

test("job notifications require field workflow permission and assignment metadata", () => {
  assert.deepEqual(notificationDestination(item("job-detail", "job-a"), field), {
    view: "job-detail", entityId: "job-a", record: "assignment",
  })
  for (const profile of [resident, officer, secretary, admin]) {
    assert.equal(notificationDestination(item("job-detail", "job-a"), profile), null)
  }
  assert.equal(notificationDestination(item("job-detail", null, "request-a"), field), null)
})

test("appointment and admin module destinations preserve current role permissions", () => {
  assert.deepEqual(notificationDestination(item("appointments", "appointment-a"), resident), {
    view: "notifications", entityId: "appointment-a", record: "appointment", inline: true,
  })
  assert.equal(notificationDestination(item("appointments", "appointment-a"), officer), null)
  assert.equal(notificationDestination(item("appointments", "appointment-a"), secretary)?.view, "appointments")
  for (const view of ["users", "configuration", "barangays", "departments", "categories", "routing", "sla-settings"]) {
    assert.equal(notificationDestination(item(view), resident), null)
    assert.equal(notificationDestination(item(view), officer), null)
    assert.equal(notificationDestination(item(view), admin)?.view, view)
  }
})

test("account notifications only open the current user's own profile", () => {
  assert.equal(notificationDestination(item("profile", resident.id), resident)?.view, "profile")
  assert.equal(notificationDestination(item("profile", "resident-b"), resident), null)
})

test("signed-out and suspended users have no destinations", () => {
  for (const profile of [null, { ...admin, status: "suspended" }, { ...field, status: "inactive" }]) {
    assert.equal(notificationDestination(item("request-detail", "request-a"), profile), null)
    assert.equal(notificationDestination(item("configuration"), profile), null)
  }
})

test("generic reassignment notices open only the authorized field jobs module", () => {
  assert.deepEqual(notificationDestination(item("jobs"), field), {
    view: "jobs", entityId: null, record: null,
  })
  for (const profile of [resident, officer, secretary, admin]) {
    assert.equal(notificationDestination(item("jobs"), profile), null)
  }
})

test("personnel-availability notices preserve dispatcher assignment permission", () => {
  const dispatcher = { ...field, worker_function: "dispatcher" }
  assert.equal(notificationDestination(item("assignments"), dispatcher)?.view, "assignments")
  assert.equal(notificationDestination(item("assignments"), admin)?.view, "assignments")
  for (const profile of [resident, officer, secretary, field]) {
    assert.equal(notificationDestination(item("assignments"), profile), null)
  }
})
