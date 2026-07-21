import type { CommittedChangesEvent, EventRecoveryRequired } from '@mailrovers/mail-contracts'
import { operationId, mailboxId } from '@mailrovers/mail-domain'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { subscribeDesktopChangeInvalidation } from '../src/desktop-change-invalidation.js'

describe('desktop change invalidation', () => {
  it('refreshes mailbox and sync-status queries after mailbox commits', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    let publish: (event: CommittedChangesEvent | EventRecoveryRequired) => void = () => undefined

    subscribeDesktopChangeInvalidation({
      queryClient,
      changes: {
        subscribe(callback) {
          publish = callback
          return () => undefined
        },
      },
    })

    const id = mailboxId('mailbox-1')
    publish({
      kind: 'mail-changed',
      requestId: operationId('committed-changes'),
      mailboxId: id,
      changes: { mailboxes: true },
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['mailboxes'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sync-status', id] })
  })

  it('refreshes scoped drafts, outbox, conversations, labels, and search queries', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    let publish: (event: CommittedChangesEvent | EventRecoveryRequired) => void = () => undefined

    subscribeDesktopChangeInvalidation({
      queryClient,
      changes: {
        subscribe(callback) {
          publish = callback
          return () => undefined
        },
      },
    })

    const id = mailboxId('mailbox-2')
    publish({
      kind: 'mail-changed',
      requestId: operationId('committed-changes-scoped'),
      mailboxId: id,
      changes: {
        drafts: true,
        outbox: true,
        conversations: true,
        labels: true,
      },
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['drafts', id] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['command-issues', id] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['conversations', id] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['conversation', id] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['search', id] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['labels', id] })
  })

  it('invalidates the whole cache after an event overflow', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    let publish: (event: CommittedChangesEvent | EventRecoveryRequired) => void = () => undefined

    subscribeDesktopChangeInvalidation({
      queryClient,
      changes: {
        subscribe(callback) {
          publish = callback
          return () => undefined
        },
      },
    })

    publish({ kind: 'events-overflowed', requestId: operationId('committed-changes') })

    expect(invalidateQueries).toHaveBeenCalledWith()
  })
})
