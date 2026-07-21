import { Toaster } from '@/components/ui/sonner.js'
import { TooltipProvider } from '@/components/ui/tooltip.js'
import { MailboxGate } from './features/mailboxes/MailboxGate.js'

export function App() {
  return (
    <TooltipProvider>
      <MailboxGate />
      <Toaster position="top-center" />
    </TooltipProvider>
  )
}
