// Real PostgreSQL + Supabase Realtime transport, with test-only signed JWTs.
// Run through scripts/test-notifications-realtime.sh; no hosted project is used.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { RealtimeClient } from '@supabase/supabase-js'
import { NotificationStore } from '../src/lib/notificationStore.ts'

const container = process.env.LB_REALTIME_DB_CONTAINER
const upstreamPort = Number(process.env.LB_REALTIME_PORT)
if (!container || !upstreamPort) throw new Error('Run npm run test:realtime to create the isolated services.')
const secret = 'local-notification-test-secret-at-least-32-characters'
const userA = '00000000-0000-0000-0000-000000000101'
const userB = '00000000-0000-0000-0000-000000000102'
const secretary = '00000000-0000-0000-0000-000000000201'
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`
function sql(statement, user) {
  const input = user ? `begin; set local role authenticated; set local "request.jwt.claim.sub"=${literal(user)}; ${statement}; commit;` : statement
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}
const api = {
  list: async (user, limit, cursor) => JSON.parse(sql(`select coalesce(jsonb_agg(n),'[]') from (
    select * from public.lb_notifications where user_id=${literal(user)}
    ${cursor ? `and (created_at,id)<(${literal(cursor.created_at)}::timestamptz,${literal(cursor.id)}::uuid)` : ''}
    order by created_at desc,id desc limit ${Number(limit)}) n`, user)),
  count: async (user) => Number(sql('select count(*) from public.lb_notifications where not is_read', user)),
  markRead: async (user, id) => Number(sql(`select public.app_mark_notifications_read(${id ? literal(id) : 'null'},${literal(user)})`, user)),
}
const token = (user) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })}`
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const waitFor = async (predicate, label, timeout=20000) => {
  const end = Date.now()+timeout
  while (!predicate()) {
    if (Date.now()>end) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve,100))
  }
}

// Supply the same tenant Host header as Supabase's self-hosted gateway. This
// forwards genuine WebSocket frames; it does not create or simulate events.
const sockets = new Set()
const gateway = http.createServer((_, response) => response.writeHead(404).end())
gateway.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
gateway.on('upgrade', (request, socket, head) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: request.url,
    headers: { ...request.headers, host: 'realtime-dev.localhost' },
  })
  upstream.on('upgrade', (response, target, pending) => {
    sockets.add(target); target.on('close', () => sockets.delete(target))
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key,value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
    if (head.length) target.write(head)
    if (pending.length) socket.write(pending)
    socket.pipe(target).pipe(socket)
    socket.on('error', () => target.destroy()); target.on('error', () => socket.destroy())
    socket.on('close', () => target.destroy()); target.on('close', () => socket.destroy())
  })
  upstream.on('response', (response) => { socket.end(`HTTP/1.1 ${response.statusCode} Realtime error\r\nConnection: close\r\n\r\n`) })
  upstream.on('error', () => socket.destroy())
  upstream.end()
})
await new Promise((resolve) => gateway.listen(0,'127.0.0.1',resolve))
const sessions = []
function session(user, filterUser=user) {
  const jwt = token(user)
  const client = new RealtimeClient(`ws://127.0.0.1:${gateway.address().port}/socket`, { params: { apikey: jwt } })
  client.setAuth(jwt)
  const store = new NotificationStore(user,api)
  const events = []
  const item = { client, store, events, joins: 0 }
  sessions.push(item)
  store.start()
  client.channel(`notifications-${user}-${sessions.length}`)
    .on('postgres_changes', { event:'*', schema:'public', table:'lb_notifications', filter:`user_id=eq.${filterUser}` }, (event) => {
      events.push(event)
      void store.refresh()
    }).subscribe((status) => {
      if (status==='SUBSCRIBED') { item.joins++; void store.refresh() }
    })
  return item
}

try {
  const first = session(userA), second = session(userA), unrelated = session(userB,userA)
  await waitFor(() => sessions.every((item) => item.joins>0), 'authenticated Realtime subscriptions')
  await Promise.all(sessions.map((item) => item.store.refresh()))
  assert.equal(first.store.getSnapshot().unreadCount,0)
  console.log('PASS authenticated sessions subscribe to real Realtime with RLS')

  const result = JSON.parse(sql(`select public.app_submit_resident_request('Realtime transport request',
    'A real committed request for notification transport verification',
    '30000000-0000-0000-0000-000000000001','Test location')`,userA))
  await waitFor(() => first.store.getSnapshot().unreadCount===1 && second.store.getSnapshot().unreadCount===1, 'cross-session INSERT and exact counts')
  assert.equal(first.events.filter((event) => event.eventType==='INSERT').length,1)
  assert.equal(second.events.filter((event) => event.eventType==='INSERT').length,1)
  assert.equal(unrelated.events.length,0)
  assert.equal(unrelated.store.getSnapshot().notifications.length,0)
  console.log('PASS committed workflow delivers one INSERT to both sessions; another user receives nothing')

  await first.store.markRead(first.store.getSnapshot().notifications[0].id)
  await waitFor(() => second.store.getSnapshot().unreadCount===0 && second.events.some((event) => event.eventType==='UPDATE'), 'cross-session read UPDATE')
  assert.equal(second.store.getSnapshot().notifications[0].is_read,true)
  assert.equal(unrelated.events.length,0)
  console.log('PASS server read RPC propagates UPDATE and correct unread count to another session')

  second.client.disconnect()
  sql(`select public.app_transition_request(${literal(result.request.id)},'for_verification')`,secretary)
  await waitFor(() => first.store.getSnapshot().unreadCount===1,'online session workflow update')
  const joins = second.joins
  second.client.connect()
  await waitFor(() => second.joins>joins && second.store.getSnapshot().unreadCount===1,'reconnect and persisted catch-up')
  assert.equal(second.store.getSnapshot().notifications.length,2)
  console.log('PASS real reconnect reconciles notifications committed while disconnected')

  const before = first.events.length
  sql(`begin; set local role authenticated; set local "request.jwt.claim.sub"=${literal(userA)};
    select public.app_submit_resident_request('Rolled back transport request','This event must never be delivered',
    '30000000-0000-0000-0000-000000000001','Test location'); rollback;`)
  await new Promise((resolve) => setTimeout(resolve,500))
  assert.equal(first.events.length,before)
  assert.equal(unrelated.events.length,0)
  console.log('PASS rolled-back workflow produces no WebSocket event')
} finally {
  for (const item of sessions) {
    item.store.stop()
    await item.client.removeAllChannels()
    assert.equal(item.client.getChannels().length,0)
    item.client.disconnect()
  }
  for (const socket of sockets) socket.destroy()
  await new Promise((resolve) => gateway.close(resolve))
}
console.log('PASS channel, socket, and notification-store cleanup')
