import { describe, expect, it, vi } from 'vitest'
import { createDesktopQueryClient } from '../src/query-client.js'

describe('desktop query client', () => {
  it('reports a mailbox refresh failure when cached data remains available', async () => {
    const notifyMailboxRefreshError = vi.fn<() => void>()
    const client = createDesktopQueryClient({
      config: { defaultOptions: { queries: { retry: false } } },
      notifyMailboxRefreshError,
    })
    client.setQueryData(['mailboxes'], [{ id: 'cached' }])

    await expect(
      client.fetchQuery({
        queryKey: ['mailboxes'],
        queryFn: () => Promise.reject(new Error('offline')),
      }),
    ).rejects.toThrow('offline')

    expect(notifyMailboxRefreshError).toHaveBeenCalledOnce()
    client.clear()
  })

  it('does not report an initial mailbox load failure as a refresh failure', async () => {
    const notifyMailboxRefreshError = vi.fn<() => void>()
    const client = createDesktopQueryClient({
      config: { defaultOptions: { queries: { retry: false } } },
      notifyMailboxRefreshError,
    })

    await expect(
      client.fetchQuery({
        queryKey: ['mailboxes'],
        queryFn: () => Promise.reject(new Error('offline')),
      }),
    ).rejects.toThrow('offline')

    expect(notifyMailboxRefreshError).not.toHaveBeenCalled()
    client.clear()
  })
})
