import { Toaster } from '@/components/ui/sonner.js'
import { MailboxGate } from './features/mailboxes/MailboxGate.js'

export function App() {
  return (
    <>
      <MailboxGate />
      <Toaster position="top-center" />
    </>
  )
}
