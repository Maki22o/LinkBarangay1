import type { Notification } from "@/types"

export const NOTIFICATION_PAGE_SIZE = 50

type Cursor = Pick<Notification, "created_at" | "id">

export interface NotificationApi {
  list: (userId: string, limit: number, cursor?: Cursor) => Promise<Notification[]>
  count: (userId: string) => Promise<number>
  markRead: (userId: string, id: string | null) => Promise<number>
}

export interface NotificationState {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  refreshing: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string | null
  markingIds: ReadonlySet<string>
  markingAll: boolean
}

const message = (error: unknown) => error instanceof Error ? error.message : "Could not load notifications. Please try again."

/** Last write wins by id; database order is deterministic even for tied dates. */
export function uniqueNotifications(rows: Notification[]): Notification[] {
  const micros = (value: string) => {
    const fraction = value.match(/\.(\d+)/)?.[1] ?? ""
    return Date.parse(value) * 1_000 + Number(fraction.slice(3).padEnd(3, "0"))
  }
  return [...new Map(rows.map((row) => [row.id, row])).values()].sort((a, b) =>
    micros(b.created_at) - micros(a.created_at) || b.id.localeCompare(a.id),
  )
}

/**
 * All fetches and mutations share one serial queue. A refresh can never apply
 * a snapshot obtained before a successful read mutation. Each lifecycle also
 * has a generation, so an old account or an unmounted provider cannot publish.
 */
export class NotificationStore {
  private state: NotificationState
  private listeners = new Set<() => void>()
  private queue: Promise<void> = Promise.resolve()
  private active = false
  private generation = 0
  private pageCount = 1
  private refreshPending: Promise<void> | null = null
  private refreshAgain = false
  private morePending: Promise<void> | null = null
  private reads = new Map<string, Promise<void>>()

  readonly userId: string | null
  private readonly api: NotificationApi

  constructor(userId: string | null, api: NotificationApi) {
    this.userId = userId
    this.api = api
    this.state = {
      notifications: [], unreadCount: 0, loading: Boolean(userId), refreshing: false,
      loadingMore: false, hasMore: false, error: null, markingIds: new Set(), markingAll: false,
    }
  }

  getSnapshot = (): NotificationState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(patch: Partial<NotificationState>) {
    if (!this.active) return
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  start() {
    this.active = true
    this.generation += 1
    this.publish({ markingIds: new Set(), markingAll: false, loadingMore: false })
    void this.refresh()
  }

  stop() {
    this.active = false
    this.generation += 1
    // A StrictMode setup/cleanup/setup cycle may reuse the same instance.
    // Detach its new work from any old network request still in flight.
    this.queue = Promise.resolve()
    this.refreshPending = null
    this.morePending = null
    this.reads.clear()
    this.refreshAgain = false
  }

  private current(generation: number) {
    return this.active && generation === this.generation
  }

  private enqueue(operation: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.generation
    const task = this.queue.then(async () => {
      if (this.current(generation)) await operation(generation)
    })
    this.queue = task.catch(() => {})
    return task
  }

  private async fetchWindow(generation: number): Promise<void> {
    if (!this.userId) return
    const loadRows = async () => {
      const rows: Notification[] = []
      let cursor: Cursor | undefined
      let more = false
      for (let page = 0; page < this.pageCount; page++) {
        const result = uniqueNotifications(await this.api.list(this.userId!, NOTIFICATION_PAGE_SIZE + 1, cursor))
        if (!this.current(generation)) return null
        rows.push(...result.slice(0, NOTIFICATION_PAGE_SIZE))
        more = result.length > NOTIFICATION_PAGE_SIZE
        if (!more) break
        cursor = rows[rows.length - 1]
      }
      return { rows: uniqueNotifications(rows), more }
    }
    const [window, unreadCount] = await Promise.all([loadRows(), this.api.count(this.userId)])
    if (!window || !this.current(generation)) return
    this.publish({ notifications: window.rows, unreadCount, hasMore: window.more, error: null })
  }

  refresh = (): Promise<void> => {
    if (!this.active || !this.userId) return Promise.resolve()
    if (this.refreshPending) {
      // Realtime events arriving during a fetch may commit after its snapshot.
      this.refreshAgain = true
      return this.refreshPending
    }
    const task = this.enqueue(async (generation) => {
      this.publish({ refreshing: true })
      try { await this.fetchWindow(generation) }
      catch (error) { if (this.current(generation)) this.publish({ error: message(error) }) }
      finally { if (this.current(generation)) this.publish({ loading: false, refreshing: false }) }
    })
    this.refreshPending = task
    const cleanup = () => {
      if (this.refreshPending !== task) return
      this.refreshPending = null
      if (this.refreshAgain) {
        this.refreshAgain = false
        void this.refresh()
      }
    }
    void task.then(cleanup, cleanup)
    return task
  }

  loadMore = (): Promise<void> => {
    if (!this.active || !this.userId || !this.state.hasMore) return Promise.resolve()
    if (this.morePending) return this.morePending
    this.publish({ loadingMore: true })
    const task = this.enqueue(async (generation) => {
      try {
        const cursor = this.state.notifications[this.state.notifications.length - 1]
        const rows = await this.api.list(this.userId!, NOTIFICATION_PAGE_SIZE + 1, cursor)
        if (!this.current(generation)) return
        this.pageCount += 1
        this.publish({
          notifications: uniqueNotifications([...this.state.notifications, ...rows.slice(0, NOTIFICATION_PAGE_SIZE)]),
          hasMore: rows.length > NOTIFICATION_PAGE_SIZE, error: null,
        })
      } catch (error) {
        if (this.current(generation)) this.publish({ error: message(error) })
      } finally {
        if (this.current(generation)) this.publish({ loadingMore: false })
      }
    })
    this.morePending = task
    const cleanup = () => { if (this.morePending === task) this.morePending = null }
    void task.then(cleanup, cleanup)
    return task
  }

  private mark(id: string | null): Promise<void> {
    if (!this.active || !this.userId) return Promise.resolve()
    const key = id ?? "*"
    const pending = this.reads.get(key)
    if (pending) return pending
    const generation = this.generation
    if (id) this.publish({ markingIds: new Set([...this.state.markingIds, id]) })
    else this.publish({ markingAll: true })
    const task = this.enqueue(async (operationGeneration) => {
      try {
        const affected = await this.api.markRead(this.userId!, id)
        if (!this.current(operationGeneration)) return
        const now = new Date().toISOString()
        this.publish({
          notifications: this.state.notifications.map((row) =>
            (!id || row.id === id) && !row.is_read ? { ...row, is_read: true, read_at: now } : row,
          ),
          unreadCount: Math.max(0, this.state.unreadCount - affected), error: null,
        })
        // The committed RPC is authoritative; refreshing also corrects for
        // concurrent notifications or reads in other tabs, across all pages.
        try { await this.fetchWindow(operationGeneration) }
        catch (error) { if (this.current(operationGeneration)) this.publish({ error: message(error) }) }
      } catch (error) {
        if (this.current(operationGeneration)) this.publish({ error: message(error) })
        throw error
      } finally {
        if (this.current(operationGeneration)) {
          const ids = new Set(this.state.markingIds)
          if (id) ids.delete(id)
          this.publish({ markingIds: ids, ...(!id ? { markingAll: false } : {}) })
        }
      }
    })
    this.reads.set(key, task)
    // Use then(success, failure), rather than an ignored rejecting finally.
    const cleanup = () => {
      if (this.current(generation) && this.reads.get(key) === task) this.reads.delete(key)
    }
    void task.then(cleanup, cleanup)
    return task
  }

  markRead = (id: string) => this.mark(id)
  markAllRead = () => this.mark(null)
}
