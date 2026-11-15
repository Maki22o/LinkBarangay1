import test from 'node:test'
import assert from 'node:assert/strict'
import { NotificationStore, uniqueNotifications } from '../src/lib/notificationStore.ts'

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const row = (n, extra = {}) => ({
  id: id(n), user_id: 'resident-a', title: 'Committed update', message: 'A real update',
  request_id: null, is_read: false, read_at: null, created_at: '2026-11-14T10:00:00.123456+00:00', ...extra,
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(rows = [], unread = rows.filter((r) => !r.is_read).length) {
  const data = { rows, unread, mutations: 0, lists: 0 }
  const api = {
    list: async (_user, limit, cursor) => {
      data.lists++
      const ordered = uniqueNotifications(data.rows)
      const start = cursor ? ordered.findIndex((r) => r.id === cursor.id) + 1 : 0
      return ordered.slice(start, start + limit)
    },
    count: async () => data.unread,
    markRead: async (_user, notificationId) => {
      data.mutations++
      let affected = 0
      data.rows = data.rows.map((r) => {
        if ((!notificationId || r.id === notificationId) && !r.is_read) {
          affected++
          return { ...r, is_read: true, read_at: new Date().toISOString() }
        }
        return r
      })
      data.unread -= affected
      return affected
    },
  }
  return { data, api, store: new NotificationStore('resident-a', api) }
}

test('exact unread count is independent from the first page; stable keyset pagination exceeds 50', async () => {
  const { store, data } = fixture(Array.from({ length: 123 }, (_, i) => row(i + 1)))
  store.start()
  await store.refresh()
  assert.equal(store.getSnapshot().notifications.length, 50)
  assert.equal(store.getSnapshot().unreadCount, 123)
  assert.equal(store.getSnapshot().hasMore, true)
  await store.loadMore()
  await store.loadMore()
  assert.equal(store.getSnapshot().notifications.length, 123)
  assert.equal(new Set(store.getSnapshot().notifications.map((r) => r.id)).size, 123)
  assert.equal(store.getSnapshot().hasMore, false)
  assert.equal(data.mutations, 0, 'opening history does not mark it read')
  store.stop()
})

test('mark one and all persist through refresh and repeated clicks share a mutation', async () => {
  const { store, data } = fixture([row(1), row(2)])
  store.start()
  await store.refresh()
  await Promise.all([store.markRead(id(1)), store.markRead(id(1)), store.markRead(id(1))])
  assert.equal(data.mutations, 1)
  assert.equal(store.getSnapshot().unreadCount, 1)
  assert.equal(store.getSnapshot().notifications.find((r) => r.id === id(1)).is_read, true)
  await Promise.all([store.markAllRead(), store.markAllRead()])
  assert.equal(data.mutations, 2)
  assert.equal(store.getSnapshot().unreadCount, 0)
  await store.refresh()
  assert.equal(store.getSnapshot().unreadCount, 0)
  assert.equal(store.getSnapshot().markingAll, false)
  assert.equal(store.getSnapshot().markingIds.size, 0)
  store.stop()
})

test('refresh snapshots cannot overwrite a later successful read', async () => {
  const { store, api, data } = fixture([row(1)])
  store.start()
  await store.refresh()
  const response = deferred()
  const originalList = api.list
  let pause = true
  api.list = (...args) => pause ? (pause = false, response.promise) : originalList(...args)
  const refreshing = store.refresh()
  await tick()
  const marking = store.markRead(id(1))
  response.resolve([row(1)])
  await Promise.all([refreshing, marking])
  assert.equal(data.mutations, 1)
  assert.equal(store.getSnapshot().notifications[0].is_read, true)
  assert.equal(store.getSnapshot().unreadCount, 0)
  store.stop()
})

test('stopping an old account prevents late responses from publishing', async () => {
  const { store, api } = fixture()
  const response = deferred()
  api.list = () => response.promise
  store.start()
  await tick()
  store.stop()
  response.resolve([row(1)])
  await tick()
  assert.deepEqual(store.getSnapshot().notifications, [])
  const replacement = new NotificationStore('resident-b', { ...api, list: async () => [] })
  replacement.start()
  await replacement.refresh()
  assert.deepEqual(replacement.getSnapshot().notifications, [])
  replacement.stop()
})

test('StrictMode restart ignores the old in-flight lifecycle', async () => {
  const { store, api } = fixture([row(2)])
  const response = deferred()
  let first = true
  api.list = async () => first ? (first = false, response.promise) : [row(2)]
  store.start()
  await tick()
  store.stop()
  store.start()
  await store.refresh()
  response.resolve([row(1)])
  await tick()
  assert.deepEqual(store.getSnapshot().notifications.map((r) => r.id), [id(2)])
  assert.equal(store.getSnapshot().loading, false)
  store.stop()
})

test('failed fetches and reads report errors and can retry without losing history', async () => {
  const { store, api } = fixture([row(1)])
  store.start()
  await store.refresh()
  const list = api.list
  api.list = async () => { throw new Error('Network unavailable') }
  await store.refresh()
  assert.equal(store.getSnapshot().notifications.length, 1)
  assert.match(store.getSnapshot().error, /Network/)
  api.list = list
  await store.refresh()
  assert.equal(store.getSnapshot().error, null)
  api.markRead = async () => { throw new Error('Permission denied') }
  await assert.rejects(store.markRead(id(1)), /Permission/)
  assert.equal(store.getSnapshot().unreadCount, 1)
  assert.equal(store.getSnapshot().notifications[0].is_read, false)
  assert.equal(store.getSnapshot().markingIds.size, 0)
  store.stop()
})

test('duplicate updates replace existing rows and preserve PostgreSQL microsecond order', () => {
  const result = uniqueNotifications([
    row(1, { created_at: '2026-11-14T10:00:00.123456+00:00' }),
    row(2, { created_at: '2026-11-14T10:00:00.123455+00:00' }),
    row(1, { is_read: true, created_at: '2026-11-14T10:00:00.123456+00:00' }),
  ])
  assert.equal(result.length, 2)
  assert.equal(result[0].id, id(1))
  assert.equal(result[0].is_read, true)
})

test('a synchronization request during an active fetch schedules catch-up', async () => {
  const { store, api } = fixture([row(1)])
  store.start()
  await store.refresh()
  const response = deferred()
  const originalList = api.list
  let first = true
  api.list = async (...args) => first ? (first = false, response.promise) : originalList(...args)
  const pending = store.refresh()
  await tick()
  void store.refresh() // e.g. a second Realtime event after the first snapshot
  response.resolve([])
  await pending
  await tick()
  assert.equal(store.getSnapshot().notifications.length, 1)
  store.stop()
})

test('refresh reconciles read changes from another session across loaded history pages', async () => {
  const { store, data } = fixture(Array.from({ length: 75 }, (_, i) => row(i + 1)))
  store.start()
  await store.refresh()
  await store.loadMore()
  data.rows = data.rows.map((r) => ({ ...r, is_read: true, read_at: '2026-11-14T10:05:00Z' }))
  data.unread = 0
  await store.refresh()
  assert.equal(store.getSnapshot().notifications.length, 75)
  assert.ok(store.getSnapshot().notifications.every((r) => r.is_read))
  assert.equal(store.getSnapshot().unreadCount, 0)
  store.stop()
})

test('no authenticated account performs no fetch, subscription-independent mutation or counter change', async () => {
  const { api, data } = fixture([row(1)])
  const store = new NotificationStore(null, api)
  store.start()
  await Promise.all([store.refresh(), store.loadMore(), store.markRead(id(1)), store.markAllRead()])
  assert.equal(data.lists, 0)
  assert.equal(data.mutations, 0)
  assert.equal(store.getSnapshot().unreadCount, 0)
  assert.equal(store.getSnapshot().loading, false)
  store.stop()
})

test('a failed incremental load preserves existing rows and retries the same cursor', async () => {
  const { store, api } = fixture(Array.from({ length: 75 }, (_, i) => row(i + 1)))
  store.start()
  await store.refresh()
  const list = api.list
  api.list = async () => { throw new Error('Temporary pagination failure') }
  await store.loadMore()
  assert.equal(store.getSnapshot().notifications.length, 50)
  assert.equal(store.getSnapshot().loadingMore, false)
  assert.equal(store.getSnapshot().hasMore, true)
  api.list = list
  await store.loadMore()
  assert.equal(store.getSnapshot().notifications.length, 75)
  assert.equal(store.getSnapshot().error, null)
  store.stop()
})
