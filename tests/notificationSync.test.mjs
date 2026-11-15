import test from 'node:test'
import assert from 'node:assert/strict'
import { startNotificationSync } from '../src/lib/notificationSync.ts'

function fixture() {
  let now = 0, visible = true, online = true, refreshes = 0, subscriptions = 0
  const timers = new Map(), repeats = new Map(), listeners = new Map()
  let nextId = 0, change, connection
  const schedule = (map, ms, callback) => {
    const id = ++nextId
    map.set(id, { at: now + ms, ms, callback })
    return () => map.delete(id)
  }
  const environment = {
    now: () => now, visible: () => visible, online: () => online,
    delay: (ms, callback) => schedule(timers, ms, callback),
    repeat: (ms, callback) => schedule(repeats, ms, callback),
    listen: (event, callback) => { listeners.set(event, callback); return () => listeners.delete(event) },
  }
  const stop = startNotificationSync({
    refresh: async () => { refreshes++ },
    subscribe: (onChange, onConnection) => {
      subscriptions++
      change = onChange
      connection = onConnection
      return () => subscriptions--
    },
    environment,
  })
  const advance = (ms) => {
    const until = now + ms
    for (;;) {
      const tasks = [...timers.entries()].map(([id, item]) => ({ id, item, repeat: false }))
        .concat([...repeats.entries()].map(([id, item]) => ({ id, item, repeat: true })))
        .filter(({ item }) => item.at <= until)
        .sort((a, b) => a.item.at - b.item.at)
      if (!tasks.length) break
      const task = tasks[0]
      now = task.item.at
      if (task.repeat) task.item.at += task.item.ms
      else timers.delete(task.id)
      task.item.callback()
    }
    now = until
  }
  return {
    stop, advance, change: () => change(), connection: (value) => connection(value),
    emit: (event) => listeners.get(event)?.(),
    setVisible: (value) => { visible = value }, setOnline: (value) => { online = value },
    get refreshes() { return refreshes }, get subscriptions() { return subscriptions },
    get resources() { return timers.size + repeats.size + listeners.size },
  }
}

test('one subscription coalesces realtime bursts and catches up on reconnect', () => {
  const f = fixture()
  assert.equal(f.subscriptions, 1)
  f.connection(true)
  f.change(); f.change(); f.change()
  f.advance(199)
  assert.equal(f.refreshes, 0)
  f.advance(1)
  assert.equal(f.refreshes, 1)
  f.connection(false)
  f.connection(true)
  f.advance(200)
  assert.equal(f.refreshes, 2)
  f.stop()
})

test('failed realtime polls every 30 seconds and healthy realtime reconciles every two minutes', () => {
  const f = fixture()
  f.advance(30_200)
  assert.equal(f.refreshes, 1)
  f.connection(true)
  f.advance(200)
  assert.equal(f.refreshes, 2)
  f.advance(119_599)
  assert.equal(f.refreshes, 2)
  // Poll interval checks the elapsed time; next 30s tick performs catch-up.
  f.advance(30_201)
  assert.equal(f.refreshes, 3)
  f.stop()
})

test('hidden and offline fallback is quiet; focus, visibility and online catch up', () => {
  const f = fixture()
  f.setVisible(false)
  f.advance(90_000)
  assert.equal(f.refreshes, 0)
  f.setVisible(true)
  f.emit('visibility')
  f.advance(200)
  assert.equal(f.refreshes, 1)
  f.setOnline(false)
  f.advance(90_000)
  f.emit('focus')
  f.advance(200)
  assert.equal(f.refreshes, 1)
  f.setOnline(true)
  f.emit('online'); f.emit('focus')
  f.advance(200)
  assert.equal(f.refreshes, 2)
  f.stop()
})

test('cleanup removes all listeners, timers and channel; late events do no work', () => {
  const f = fixture()
  f.change()
  f.stop()
  assert.equal(f.subscriptions, 0)
  assert.equal(f.resources, 0)
  f.change(); f.connection(true); f.emit('focus')
  f.advance(300_000)
  assert.equal(f.refreshes, 0)
  assert.equal(f.resources, 0)
})
