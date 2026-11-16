import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { manilaInput, manilaInstant, shiftDay, toLocalDateTimeInput } from "../src/lib/dateTime.ts"

test("missing or invalid deadlines remain an empty datetime-local control", () => {
  for (const value of [null, undefined, "", "not-a-date"]) {
    assert.equal(toLocalDateTimeInput(value), "")
  }
})

test("appointment input uses Philippine time across UTC midnight and rejects invalid dates", () => {
  assert.equal(manilaInput("2027-01-31T18:00:00.000Z"), "2027-02-01T02:00")
  assert.equal(manilaInstant("2027-02-01T02:00"), "2027-01-31T18:00:00.000Z")
  assert.equal(manilaInstant("2027-02-30T09:00"), null)
  assert.equal(manilaInstant("2027-02-01T24:00"), null)
  assert.equal(shiftDay("2028-02-28", 2), "2028-03-01")
})

test("an unchanged assignment deadline round-trips in local time, including UTC+8 and DST", () => {
  const moduleUrl = new URL("../src/lib/dateTime.ts", import.meta.url).href
  const script = `
    import assert from 'node:assert/strict';
    import { toLocalDateTimeInput } from ${JSON.stringify(moduleUrl)};
    for (const iso of ['2026-11-14T10:30:00.000Z', '2026-06-15T18:15:00.000Z']) {
      assert.equal(new Date(toLocalDateTimeInput(iso)).toISOString(), iso);
    }
  `
  for (const timezone of ["UTC", "Asia/Manila", "Asia/Singapore", "America/New_York"]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: timezone }, encoding: "utf8",
    })
    assert.equal(result.status, 0, `${timezone}: ${result.stderr}`)
  }
})
