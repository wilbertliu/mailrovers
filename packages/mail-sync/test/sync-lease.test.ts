import type { SyncLeaseFence } from '@mailrovers/mail-application'
import { utcTimestamp } from '@mailrovers/mail-domain'
import { describe, expect, it, vi } from 'vitest'
import { withFence } from '../src/sync-lease.js'

const fence: SyncLeaseFence = {
  ownerId: 'owner-1',
  fencingToken: 7,
  now: utcTimestamp('2026-07-22T00:00:00.000Z'),
}

describe('withFence', () => {
  it('renews once and passes the fence into the write', async () => {
    const renew = vi.fn(async () => fence)
    const write = vi.fn(async (received: SyncLeaseFence) => {
      expect(received).toBe(fence)
      return 'ok'
    })

    await expect(withFence(renew, write)).resolves.toBe('ok')
    expect(renew).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('does not invoke the write when renewal fails', async () => {
    const renew = vi.fn(async () => {
      throw new Error('SYNC_LEASE_LOST')
    })
    const write = vi.fn(async () => 'ok')

    await expect(withFence(renew, write)).rejects.toThrow('SYNC_LEASE_LOST')
    expect(write).not.toHaveBeenCalled()
  })
})
