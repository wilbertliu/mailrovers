import { Toaster } from '@/components/ui/sonner.js'
import { MailboxGate } from './features/mailboxes/MailboxGate.js'
import { useDesktopChangeInvalidation } from './hooks/use-desktop-change-invalidation.js'

export function App() {
  useDesktopChangeInvalidation()

  return (
    <>
      <MailboxGate />
      <Toaster position="top-center" />
    </>
  )
}
