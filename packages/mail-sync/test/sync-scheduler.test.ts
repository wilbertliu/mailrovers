import type { MailboxSyncStore, SyncEngine } from '@mailrovers/mail-application'
import { GMAIL_CAPABILITIES, type MailboxSummary } from '@mailrovers/mail-contracts'
import {
  mailboxId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SyncScheduler } from '../src/index.js'

const mailboxOne = mailboxId('gmail:scheduler-one')
const mailboxTwo = mailboxId('gmail:scheduler-two')
const now = utcTimestamp('2026-07-14T00:00:00.000Z')

type ScheduledMailbox = Mailbox & MailboxSummary

function mailbox(id: typeof mailboxOne): ScheduledMailbox {
  return {
    id,
    workspaceId: workspaceId('workspace-personal'),
    provider: 'gmail',
    providerAccountId: String(id),
    emailAddress: `${id}@example.test`,
    displayName: String(id),
    syncState: 'ready',
    connectionState: 'connected',
    capabilities: GMAIL_CAPABILITIES,
    importedMessageCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function checkpoint(id: typeof mailboxOne, retryAt?: string): SyncCheckpoint {
  return {
    mailboxId: id,
    historyStartCursor: '100',
    importState: 'complete',
    importedMessageCount: 0,
    importedDraftCount: 0,
    ...(retryAt === undefined ? {} : { retryAt: utcTimestamp(retryAt) }),
    updatedAt: now,
  }
}

function schedulerFixture(
  input: {
    mailboxes?: ScheduledMailbox[]
    checkpoints?: Map<typeof mailboxOne, SyncCheckpoint>
    start?: Pick<SyncEngine, 'start'>['start']
    now?: () => Date
  } = {},
) {
  const mailboxes = input.mailboxes ?? [mailbox(mailboxOne)]
  const checkpoints = input.checkpoints ?? new Map([[mailboxOne, checkpoint(mailboxOne)]])
  const store: Pick<MailboxSyncStore, 'getMailbox' | 'getSyncCheckpoint' | 'listMailboxes'> = {
    listMailboxes: vi.fn<MailboxSyncStore['listMailboxes']>(async () => mailboxes),
    getMailbox: vi.fn<MailboxSyncStore['getMailbox']>(async (id) =>
      mailboxes.find((item) => item.id === id),
    ),
    getSyncCheckpoint: vi.fn<MailboxSyncStore['getSyncCheckpoint']>(async (id) =>
      checkpoints.get(id),
    ),
  }
  const syncEngine: Pick<SyncEngine, 'start'> = {
    start:
      input.start ??
      vi.fn<SyncEngine['start']>(async (request) => ({
        requestId: request.requestId,
        mailboxId: request.mailboxId,
        state: 'active',
      })),
  }
  return {
    scheduler: new SyncScheduler({
      store,
      syncEngine,
      now: input.now,
      cadenceMs: 60_000,
      focusQuietPeriodMs: 5_000,
    }),
    store,
    syncEngine,
  }
}

afterEach(() => vi.useRealTimers())

describe('SyncScheduler', () => {
  it('uses one reschedulable timer and advances each mailbox at the 60-second cadence', async () => {
    vi.useFakeTimers()
    let current = new Date(now)
    const { scheduler, syncEngine } = schedulerFixture({
      mailboxes: [mailbox(mailboxOne), mailbox(mailboxTwo)],
      checkpoints: new Map([
        [mailboxOne, checkpoint(mailboxOne)],
        [mailboxTwo, checkpoint(mailboxTwo)],
      ]),
      now: () => current,
    })

    await scheduler.start()
    expect(syncEngine.start).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)

    current = new Date(current.getTime() + 60_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncEngine.start).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(1)
    scheduler.dispose()
  })

  it('coalesces concurrent triggers for one mailbox into a single-flight sync', async () => {
    let resolveStart: (() => void) | undefined
    const inFlight = new Promise<void>((resolve) => {
      resolveStart = resolve
    })
    const start = vi.fn<SyncEngine['start']>(async (request) => {
      await inFlight
      return { requestId: request.requestId, mailboxId: request.mailboxId, state: 'active' }
    })
    const { scheduler } = schedulerFixture({ start })

    const first = scheduler.trigger(mailboxOne)
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    const second = scheduler.trigger(mailboxOne)
    expect(start).toHaveBeenCalledTimes(1)
    resolveStart?.()
    await Promise.all([first, second])
    scheduler.dispose()
  })

  it('defers retries until their durable backoff deadline and honors the focus quiet period', async () => {
    vi.useFakeTimers()
    let current = new Date(now)
    const retryAt = new Date(current.getTime() + 30_000).toISOString()
    const { scheduler, syncEngine } = schedulerFixture({
      checkpoints: new Map([[mailboxOne, checkpoint(mailboxOne, retryAt)]]),
      now: () => current,
    })

    await scheduler.start()
    expect(syncEngine.start).not.toHaveBeenCalled()
    scheduler.focus()
    current = new Date(current.getTime() + 5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(syncEngine.start).not.toHaveBeenCalled()

    current = new Date(current.getTime() + 25_000)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(syncEngine.start).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })

  it('removes disconnected mailboxes and clears its only timer on disposal', async () => {
    vi.useFakeTimers()
    const disconnected = { ...mailbox(mailboxOne), connectionState: 'disconnected' as const }
    const { scheduler, syncEngine } = schedulerFixture({ mailboxes: [disconnected] })

    await scheduler.start()
    expect(syncEngine.start).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    await scheduler.trigger(mailboxOne)
    scheduler.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
