import { describe, expect, it, vi } from 'vitest'
import type { SearchBackfillProbe } from '../electron/search-backfill.js'
import { backfillSearch } from '../electron/search-backfill.js'

function createStore(results: boolean[]) {
  return {
    listMailboxes: vi.fn().mockResolvedValue([{ id: 'mailbox-1' }]),
    backfillSearchIndex: vi.fn().mockImplementation(async () => results.shift() ?? true),
  }
}

describe('search backfill measurement', () => {
  it('does not invoke measurement hooks during a normal production backfill', async () => {
    const store = createStore([false, true])
    const measurement = {
      start: vi.fn(),
      runBatch: vi.fn(),
      complete: vi.fn(),
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
      start: vi.fn(),
      runBatch: vi.fn(async ({ batchId, execute }) => {
        observedBatchIds.push(batchId)
        return execute()
      }),
      complete: vi.fn(),
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
