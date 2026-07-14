import type { CommittedChangesEvent, DesktopEvent } from '@mailrovers/mail-contracts'
import { mailboxId, operationId } from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import {
  PRELOAD_EVENT_LIMITS,
  PreloadEventQueue,
  type PreloadEventClock,
} from '../electron/preload-event-queue.js'

type Timer = { at: number; callback: () => void; cancelled: boolean }

class FakeClock implements PreloadEventClock {
  private time = 0
  private readonly timers: Timer[] = []

  now(): number {
    return this.time
  }

  setTimeout(callback: () => void, delayMs: number): Timer {
    const timer = { at: this.time + delayMs, callback, cancelled: false }
    this.timers.push(timer)
    return timer
  }

  clearTimeout(value: unknown): void {
    ;(value as Timer).cancelled = true
  }

  advance(milliseconds: number): void {
    const target = this.time + milliseconds
    for (;;) {
      const next = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((left, right) => left.at - right.at)[0]
      if (next === undefined) break
      next.cancelled = true
      this.time = next.at
      next.callback()
    }
    this.time = target
  }
}

const request = operationId('request-1')
const mailbox = mailboxId('mailbox-1')

function delta(text: string): DesktopEvent {
  return { kind: 'ai-delta', requestId: request, mailboxId: mailbox, text }
}

function changed(index = 0): CommittedChangesEvent {
  return {
    kind: 'mail-changed',
    requestId: operationId('mailrovers:committed-changes'),
    mailboxId: mailboxId(`mailbox-${index}`),
    changes: { conversations: true },
  }
}

describe('preload event queue', () => {
  it('batches AI deltas to 8 KiB for at most 16ms', () => {
    const clock = new FakeClock()
    const events: DesktopEvent[] = []
    const queue = new PreloadEventQueue(() => {}, clock)
    queue.subscribe(request, (event) => events.push(event), true)

    queue.enqueue(delta('a'))
    queue.enqueue(delta('b'))
    clock.advance(PRELOAD_EVENT_LIMITS.batchDelayMs - 1)
    expect(events).toEqual([])
    clock.advance(1)
    expect(events).toEqual([{ ...delta('ab') }])
  })

  it('expires unsubscribed orphan states after five seconds', () => {
    const clock = new FakeClock()
    const queue = new PreloadEventQueue(() => {}, clock)
    queue.enqueue(changed())
    expect(queue.requestStateCount).toBe(1)

    clock.advance(PRELOAD_EVENT_LIMITS.orphanExpiryMs - 1)
    expect(queue.requestStateCount).toBe(1)
    clock.advance(1)
    expect(queue.requestStateCount).toBe(0)
  })

  it('cleans a drained terminal immediately and rejects late events', () => {
    const clock = new FakeClock()
    const events: DesktopEvent[] = []
    const queue = new PreloadEventQueue(() => {}, clock)
    queue.subscribe(request, (event) => events.push(event), true)

    expect(queue.enqueue({ kind: 'ai-cancelled', requestId: request, mailboxId: mailbox })).toBe(
      true,
    )
    expect(queue.requestStateCount).toBe(0)
    expect(queue.enqueue(delta('late'))).toBe(false)
    clock.advance(PRELOAD_EVENT_LIMITS.orphanExpiryMs * 2)
    expect(queue.enqueue(delta('still-late'))).toBe(false)
    expect(queue.requestStateCount).toBe(0)
    expect(events.map((event) => event.kind)).toEqual(['ai-cancelled'])
  })

  it('cancels AI exactly once on overflow while retaining its terminal event', () => {
    const clock = new FakeClock()
    const cancellations: string[] = []
    const queue = new PreloadEventQueue((requestId) => cancellations.push(requestId), clock)
    for (let index = 0; index < 40; index += 1)
      queue.enqueue(delta('x'.repeat(PRELOAD_EVENT_LIMITS.maxBatchBytes)))
    queue.enqueue(delta('more'))
    expect(cancellations).toEqual([request])

    const terminal = { kind: 'ai-cancelled' as const, requestId: request, mailboxId: mailbox }
    expect(queue.enqueue(terminal)).toBe(true)
    const events: DesktopEvent[] = []
    queue.subscribe(request, (event) => events.push(event), true)
    expect(events.at(-1)).toEqual(terminal)
    expect(cancellations).toEqual([request])
    expect(queue.requestStateCount).toBe(0)
  })

  it('cancels AI exactly once when a listener fails', () => {
    const clock = new FakeClock()
    const cancellations: string[] = []
    const queue = new PreloadEventQueue((requestId) => cancellations.push(requestId), clock)
    queue.subscribe(
      request,
      () => {
        throw new Error('listener failed')
      },
      true,
    )

    queue.enqueue({
      kind: 'ai-started',
      requestId: request,
      mailboxId: mailbox,
      artifactType: 'conversation_summary',
      sourceVersion: 1,
      cached: false,
    })
    queue.enqueue(delta('one'))
    clock.advance(PRELOAD_EVENT_LIMITS.batchDelayMs)
    expect(cancellations).toEqual([request])
  })

  it('coalesces durable changes, emits a recovery marker on overflow, and bounds global state', () => {
    const clock = new FakeClock()
    const queue = new PreloadEventQueue(() => {}, clock)
    for (let index = 0; index < PRELOAD_EVENT_LIMITS.maxRequestEvents + 20; index += 1)
      queue.enqueue(changed(index))

    const events: DesktopEvent[] = []
    queue.subscribe(operationId('mailrovers:committed-changes'), (event) => events.push(event))
    expect(events.some((event) => event.kind === 'events-overflowed')).toBe(true)
    expect(events.length).toBeLessThanOrEqual(PRELOAD_EVENT_LIMITS.maxRequestEvents)

    for (let index = 0; index < PRELOAD_EVENT_LIMITS.maxRequestStates + 100; index += 1)
      queue.enqueue({ ...changed(index), requestId: operationId(`durable-${index}`) })
    expect(queue.requestStateCount).toBeLessThanOrEqual(PRELOAD_EVENT_LIMITS.maxRequestStates)
  })

  it('coalesces a stress stream of committed changes into one delivery', () => {
    const clock = new FakeClock()
    const queue = new PreloadEventQueue(() => {}, clock)
    for (let index = 0; index < 10_000; index += 1)
      queue.enqueue({
        ...changed(),
        changes: index % 2 === 0 ? { conversations: true } : { labels: true },
      })
    const events: DesktopEvent[] = []
    queue.subscribe(operationId('mailrovers:committed-changes'), (event) => events.push(event))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'mail-changed',
      changes: { conversations: true, labels: true },
    })
  })
})
