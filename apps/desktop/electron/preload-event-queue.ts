import { operationId, type MailboxId } from '@mailrovers/mail-domain'
import type { DesktopIpcEvent } from './ipc/desktop-events.schema.js'
import { splitUtf8 } from './ipc/event-batching.js'

export const PRELOAD_EVENT_LIMITS = {
  maxBatchBytes: 8 * 1024,
  maxRequestBytes: 256 * 1024,
  maxRequestEvents: 256,
  maxRequestStates: 256,
  batchDelayMs: 16,
  orphanExpiryMs: 5_000,
} as const

export type PreloadEventClock = {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(timer: unknown): void
}

const systemClock: PreloadEventClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

type EventListener = (event: DesktopIpcEvent) => void

function findLastEventIndex(
  events: DesktopIpcEvent[],
  predicate: (event: DesktopIpcEvent) => boolean,
): number {
  for (let index = events.length - 1; index >= 0; index -= 1)
    if (predicate(events[index]!)) return index
  return -1
}

type EventState = {
  listeners: Set<EventListener>
  queue: DesktopIpcEvent[]
  queuedBytes: number
  flushTimer?: unknown
  expiryTimer?: unknown
  terminal: boolean
  ai: boolean
  cancelRequested: boolean
  createdAt: number
}

function isAi(event: DesktopIpcEvent): boolean {
  return event.kind.startsWith('ai-')
}

function isTerminal(event: DesktopIpcEvent): boolean {
  return (
    event.kind === 'sync-completed' ||
    event.kind === 'sync-failed' ||
    event.kind === 'sync-cancelled' ||
    event.kind === 'ai-completed' ||
    event.kind === 'ai-failed' ||
    event.kind === 'ai-cancelled'
  )
}

function eventMailboxId(event: DesktopIpcEvent): MailboxId | undefined {
  return 'mailboxId' in event ? event.mailboxId : undefined
}

export class PreloadEventQueue {
  private readonly states = new Map<string, EventState>()
  private readonly directCancellations = new Map<string, number>()
  private readonly terminalRequests = new Map<string, number>()
  private readonly encoder = new TextEncoder()
  private readonly clock: PreloadEventClock

  constructor(
    private readonly cancelAi: (requestId: string) => void,
    clock: PreloadEventClock = systemClock,
  ) {
    this.clock = clock
  }

  get requestStateCount(): number {
    return this.states.size
  }

  enqueue(event: DesktopIpcEvent): boolean {
    if (event.kind === 'ai-delta') {
      let accepted = true
      for (const text of splitUtf8(event.text, PRELOAD_EVENT_LIMITS.maxBatchBytes))
        accepted = this.enqueueOne({ ...event, text }) && accepted
      return accepted
    }
    return this.enqueueOne(event)
  }

  subscribe(requestId: string, listener: EventListener, aiOperation = false): () => void {
    const state = this.stateFor(requestId, aiOperation)
    if (state === undefined) {
      if (aiOperation) this.cancelDirectly(requestId)
      return () => {}
    }
    state.ai ||= aiOperation
    this.clearExpiry(state)
    state.listeners.add(listener)
    this.flush(requestId, state)
    return () => {
      if (!state.listeners.delete(listener)) return
      if (state.listeners.size !== 0) return
      if (state.ai && !state.terminal) this.requestCancellation(requestId, state)
      if (state.terminal && state.queue.length === 0) this.deleteState(requestId, state)
      else this.scheduleExpiry(requestId, state)
    }
  }

  private enqueueOne(event: DesktopIpcEvent): boolean {
    const requestId = event.requestId
    if (this.terminalRequests.has(requestId)) return false
    const state = this.stateFor(requestId, isAi(event))
    if (state === undefined || state.terminal) return false
    state.ai ||= isAi(event)

    if (this.coalesce(state, event)) {
      this.afterEnqueue(requestId, state, event)
      return true
    }

    const bytes = this.eventBytes(event)
    if (this.wouldOverflow(state, bytes, 1)) {
      if (isTerminal(event)) this.makeRoomForTerminal(state, bytes)
      else if (state.ai) {
        this.requestCancellation(requestId, state)
        return false
      } else {
        this.enqueueRecoveryMarker(requestId, state, eventMailboxId(event))
        return false
      }
    }

    state.queue.push(event)
    state.queuedBytes += bytes
    if (isTerminal(event)) {
      state.terminal = true
      this.directCancellations.delete(requestId)
      this.rememberBounded(this.terminalRequests, requestId)
    }
    this.afterEnqueue(requestId, state, event)
    return true
  }

  private afterEnqueue(requestId: string, state: EventState, event: DesktopIpcEvent): void {
    if (state.listeners.size === 0) {
      this.scheduleExpiry(requestId, state)
      return
    }
    if (
      event.kind !== 'ai-delta' ||
      state.queuedBytes >= PRELOAD_EVENT_LIMITS.maxBatchBytes ||
      state.terminal
    )
      this.flush(requestId, state)
    else this.scheduleFlush(requestId, state)
  }

  private coalesce(state: EventState, event: DesktopIpcEvent): boolean {
    const previous = state.queue.at(-1)
    if (event.kind === 'ai-delta' && previous?.kind === 'ai-delta') {
      const bytes = this.eventBytes(event)
      if (
        this.eventBytes(previous) + bytes > PRELOAD_EVENT_LIMITS.maxBatchBytes ||
        this.wouldOverflow(state, bytes, 0)
      )
        return false
      previous.text += event.text
      state.queuedBytes += bytes
      return true
    }
    if (event.kind === 'sync-progress') {
      const index = findLastEventIndex(state.queue, (queued) => queued.kind === 'sync-progress')
      if (index < 0) return false
      this.replaceAt(state, index, event)
      return true
    }
    if (event.kind === 'mail-changed') {
      const index = findLastEventIndex(
        state.queue,
        (queued) => queued.kind === 'mail-changed' && queued.mailboxId === event.mailboxId,
      )
      if (index < 0) return false
      const queued = state.queue[index]
      if (queued?.kind !== 'mail-changed') return false
      this.replaceAt(state, index, {
        ...queued,
        changes: { ...queued.changes, ...event.changes },
      })
      return true
    }
    if (
      event.kind === 'events-overflowed' &&
      state.queue.some((queued) => queued.kind === 'events-overflowed')
    )
      return true
    return false
  }

  private replaceAt(state: EventState, index: number, event: DesktopIpcEvent): void {
    const previous = state.queue[index]
    if (previous === undefined) return
    state.queuedBytes -= this.eventBytes(previous)
    state.queue[index] = event
    state.queuedBytes += this.eventBytes(event)
  }

  private enqueueRecoveryMarker(
    requestId: string,
    state: EventState,
    mailboxId: MailboxId | undefined,
  ): void {
    if (state.queue.some((event) => event.kind === 'events-overflowed')) return
    const marker = {
      kind: 'events-overflowed' as const,
      requestId: state.queue[0]?.requestId ?? operationId(requestId),
      ...(mailboxId === undefined ? {} : { mailboxId }),
    }
    const markerBytes = this.eventBytes(marker)
    while (this.wouldOverflow(state, markerBytes, 1) && state.queue.length > 0) {
      const removed = state.queue.shift()
      if (removed !== undefined) state.queuedBytes -= this.eventBytes(removed)
    }
    state.queue.push(marker)
    state.queuedBytes += markerBytes
    if (state.listeners.size > 0) this.flush(requestId, state)
  }

  private makeRoomForTerminal(state: EventState, bytes: number): void {
    while (this.wouldOverflow(state, bytes, 1) && state.queue.length > 0) {
      const removed = state.queue.shift()
      if (removed !== undefined) state.queuedBytes -= this.eventBytes(removed)
    }
  }

  private wouldOverflow(state: EventState, bytes: number, events: number): boolean {
    return (
      state.queuedBytes + bytes > PRELOAD_EVENT_LIMITS.maxRequestBytes ||
      state.queue.length + events > PRELOAD_EVENT_LIMITS.maxRequestEvents
    )
  }

  private eventBytes(event: DesktopIpcEvent): number {
    return this.encoder.encode(event.kind === 'ai-delta' ? event.text : JSON.stringify(event))
      .byteLength
  }

  private stateFor(requestId: string, ai: boolean): EventState | undefined {
    const existing = this.states.get(requestId)
    if (existing !== undefined) return existing
    if (this.states.size >= PRELOAD_EVENT_LIMITS.maxRequestStates) {
      const candidate = [...this.states].find(
        ([, state]) => !state.terminal && state.listeners.size === 0,
      )
      if (candidate !== undefined) {
        const [evictedId, evicted] = candidate
        if (evicted.ai) this.requestCancellation(evictedId, evicted)
        else this.notifyDurableRecovery()
        this.deleteState(evictedId, evicted)
      } else {
        if (ai) this.cancelDirectly(requestId)
        return undefined
      }
    }
    const created: EventState = {
      listeners: new Set(),
      queue: [],
      queuedBytes: 0,
      terminal: false,
      ai,
      cancelRequested: false,
      createdAt: this.clock.now(),
    }
    this.states.set(requestId, created)
    return created
  }

  private scheduleFlush(requestId: string, state: EventState): void {
    if (state.flushTimer !== undefined || state.listeners.size === 0) return
    state.flushTimer = this.clock.setTimeout(
      () => this.flush(requestId, state),
      PRELOAD_EVENT_LIMITS.batchDelayMs,
    )
  }

  private flush(requestId: string, state: EventState): void {
    if (state.flushTimer !== undefined) this.clock.clearTimeout(state.flushTimer)
    state.flushTimer = undefined
    if (state.listeners.size === 0) return
    const events = state.queue.splice(0)
    state.queuedBytes = 0
    for (const event of events)
      for (const listener of state.listeners)
        try {
          listener(event)
        } catch {
          if (state.ai) this.requestCancellation(requestId, state)
        }
    if (state.terminal) this.deleteState(requestId, state)
  }

  private scheduleExpiry(requestId: string, state: EventState): void {
    if (state.expiryTimer !== undefined) return
    const remaining = Math.max(
      0,
      state.createdAt + PRELOAD_EVENT_LIMITS.orphanExpiryMs - this.clock.now(),
    )
    state.expiryTimer = this.clock.setTimeout(() => {
      state.expiryTimer = undefined
      if (state.listeners.size > 0) return
      if (state.ai && !state.terminal) this.requestCancellation(requestId, state)
      this.deleteState(requestId, state)
    }, remaining)
  }

  private clearExpiry(state: EventState): void {
    if (state.expiryTimer === undefined) return
    this.clock.clearTimeout(state.expiryTimer)
    state.expiryTimer = undefined
  }

  private requestCancellation(requestId: string, state: EventState): void {
    if (state.cancelRequested) return
    state.cancelRequested = true
    this.cancelDirectly(requestId)
  }

  private cancelDirectly(requestId: string): void {
    if (this.directCancellations.has(requestId)) return
    this.rememberBounded(this.directCancellations, requestId)
    this.cancelAi(requestId)
  }

  private rememberBounded(target: Map<string, number>, requestId: string): void {
    target.set(requestId, this.clock.now())
    if (target.size <= PRELOAD_EVENT_LIMITS.maxRequestStates) return
    const oldest = target.keys().next().value
    if (oldest !== undefined) target.delete(oldest)
  }

  private notifyDurableRecovery(): void {
    for (const [requestId, state] of this.states) {
      if (state.ai) continue
      for (const listener of state.listeners)
        try {
          listener({ kind: 'events-overflowed', requestId: operationId(requestId) })
        } catch {}
    }
  }

  private deleteState(requestId: string, state: EventState): void {
    if (this.states.get(requestId) !== state) return
    if (state.flushTimer !== undefined) this.clock.clearTimeout(state.flushTimer)
    if (state.expiryTimer !== undefined) this.clock.clearTimeout(state.expiryTimer)
    this.states.delete(requestId)
  }
}
