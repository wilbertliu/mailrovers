import type { MailboxId } from '@mailrovers/mail-domain'
import { SidebarLeftIcon } from '@hugeicons/core-free-icons'
import { IconTooltipButton } from '@/components/icon-tooltip-button.js'
import { AiSettings } from '../ai/AiSettings.js'

export function AiSettingsColumn({
  mailboxId,
  showSidebarToggle,
  onShowSidebar,
  onClose,
}: {
  mailboxId: MailboxId
  showSidebarToggle: boolean
  onShowSidebar: () => void
  onClose: () => void
}) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background"
      aria-label="AI provider"
    >
      {showSidebarToggle ? (
        <div className="window-titlebar flex h-10 shrink-0 items-center gap-3 border-b pl-21 pt-0.5 pr-2">
          <IconTooltipButton label="Show sidebar" icon={SidebarLeftIcon} onClick={onShowSidebar} />
        </div>
      ) : null}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <AiSettings mailboxId={mailboxId} onClose={onClose} />
      </div>
    </section>
  )
}
