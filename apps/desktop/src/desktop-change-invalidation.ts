import type { QueryClient } from '@tanstack/react-query'
import type { CommittedChangesEvent, EventRecoveryRequired } from '@mailrovers/mail-contracts'
import { desktopBridge } from './desktop-bridge.js'

type ChangeEvent = CommittedChangesEvent | EventRecoveryRequired

type DesktopChangeSubscription = {
  subscribe(callback: (event: ChangeEvent) => void): () => void
}

export function subscribeDesktopChangeInvalidation({
  queryClient,
  changes = {
    subscribe: (callback) => desktopBridge.subscribeCommittedChanges(callback),
  },
}: {
  queryClient: QueryClient
  changes?: DesktopChangeSubscription | undefined
}): () => void {
  return changes.subscribe((event) => {
    if (event.kind === 'events-overflowed') {
      void queryClient.invalidateQueries()
      return
    }

    const mailboxKey = event.mailboxId === undefined ? [] : [event.mailboxId]
    if (event.changes.mailboxes) {
      void queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
      void queryClient.invalidateQueries({ queryKey: ['sync-status', ...mailboxKey] })
    }
    if (event.changes.conversations) {
      void queryClient.invalidateQueries({ queryKey: ['conversations', ...mailboxKey] })
      void queryClient.invalidateQueries({ queryKey: ['conversation', ...mailboxKey] })
      void queryClient.invalidateQueries({ queryKey: ['search', ...mailboxKey] })
    }
    if (event.changes.labels)
      void queryClient.invalidateQueries({ queryKey: ['labels', ...mailboxKey] })
    if (event.changes.drafts)
      void queryClient.invalidateQueries({ queryKey: ['drafts', ...mailboxKey] })
    if (event.changes.outbox)
      void queryClient.invalidateQueries({ queryKey: ['command-issues', ...mailboxKey] })
  })
}
