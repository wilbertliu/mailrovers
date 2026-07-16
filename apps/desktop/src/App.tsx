import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Toaster } from '@/components/ui/sonner.js'
import { desktopBridge } from './desktop-bridge.js'
import { MailboxGate } from './features/mailboxes/MailboxGate.js'

export function App() {
  const queryClient = useQueryClient()

  useEffect(
    () =>
      desktopBridge.subscribeCommittedChanges((event) => {
        if (event.kind === 'events-overflowed') {
          void queryClient.invalidateQueries()
          return
        }
        const mailboxKey = event.mailboxId === undefined ? [] : [event.mailboxId]
        if (event.changes.mailboxes) void queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
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
      }),
    [queryClient],
  )

  return (
    <>
      <MailboxGate />
      <Toaster />
    </>
  )
}
