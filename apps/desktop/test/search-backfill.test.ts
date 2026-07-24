import type { MailStore } from '@mailrovers/mail-application'
import { GMAIL_CAPABILITIES, type MailboxSummary } from '@mailrovers/mail-contracts'
import { mailboxId } from '@mailrovers/mail-domain'
import { describe, expect, it, vi } from 'vitest'
import type { SearchBackfillProbe } from '../electron/search-backfill.js'
import { backfillSearch } from '../electron/search-backfill.js'

const mailbox = {
  id: mailboxId('mailbox-1'),
  provider: 'gmail',
  emailAddress: 'mailbox-1@example.test',
  displayName: 'Mailbox 1',
  syncState: 'ready',
  connectionState: 'connected',
  capabilities: GMAIL_CAPABILITIES,
  importedMessageCount: 0,
} satisfies MailboxSummary

function createStore(results: boolean[]) {
  return {
    listMailboxes: vi.fn<MailStore['listMailboxes']>(async () => [mailbox]),
    backfillSearchIndex: vi.fn<MailStore['backfillSearchIndex']>(
      async () => results.shift() ?? true,
    ),
  }
}

describe('search backfill measurement', () => {
  it('does not invoke measurement hooks during a normal production backfill', async () => {
    const store = createStore([false, true])
    const measurement = {
      start: vi.fn<SearchBackfillProbe['start']>(),
      runBatch: vi.fn<SearchBackfillProbe['runBatch']>(),
      complete: vi.fn<SearchBackfillProbe['complete']>(),
    } satisfies SearchBackfillProbe

    await backfillSearch(store, {
      shouldStop: () => false,
      yieldToEventLoop: async () => undefined,
    })

    expect(store.backfillSearchIndex).toHaveBeenCalledTimes(2)
    expect(measurement.start).not.toHaveBeenCalled()
    expect(measurement.runBatch).not.toHaveBeenCalled()
    expect(measurement.complete).not.toHaveBeenCalled()
  })

  it('routes every batch through measurement during a performance run', async () => {
    const store = createStore([false, true])
    const observedBatchIds: number[] = []
    const measurement: SearchBackfillProbe = {
      start: vi.fn<SearchBackfillProbe['start']>(),
      runBatch: vi.fn<SearchBackfillProbe['runBatch']>(async ({ batchId, execute }) => {
        observedBatchIds.push(batchId)
        return execute()
      }),
      complete: vi.fn<SearchBackfillProbe['complete']>(),
    }

    await backfillSearch(store, {
      shouldStop: () => false,
      probe: measurement,
      yieldToEventLoop: async () => undefined,
    })

    expect(measurement.start).toHaveBeenCalledOnce()
    expect(observedBatchIds).toEqual([1, 2])
    expect(measurement.complete).toHaveBeenCalledOnce()
    expect(store.backfillSearchIndex).toHaveBeenCalledTimes(2)
  })
})
