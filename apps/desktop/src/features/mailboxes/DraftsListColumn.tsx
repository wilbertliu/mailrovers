import type { Draft } from '@mailrovers/mail-contracts'
import type { MailboxId } from '@mailrovers/mail-domain'
import { Button } from '@/components/ui/button.js'
import { desktopBridge } from '../../desktop-bridge.js'
import type { ComposerMode } from '../composer/Composer.js'
import { ListColumnHeader } from '../inbox/ListColumnHeader.js'

export function DraftsListColumn({
  mailboxId,
  drafts,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  showSidebarToggle,
  onShowSidebar,
  onOpenComposer,
}: {
  mailboxId: MailboxId
  drafts: Draft[] | undefined
  searchInput: string
  onSearchInputChange: (value: string) => void
  onSearchSubmit: (value: string) => void
  showSidebarToggle: boolean
  onShowSidebar: () => void
  onOpenComposer: (mode: ComposerMode) => void
}) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background"
      aria-label="Local drafts"
    >
      <ListColumnHeader
        title="Local drafts"
        subtitle={`${drafts?.length ?? 0} saved on this Mac`}
        searchInput={searchInput}
        onSearchInputChange={onSearchInputChange}
        onSearchSubmit={onSearchSubmit}
        showSidebarToggle={showSidebarToggle}
        onShowSidebar={onShowSidebar}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {drafts?.map((draft) => (
          <Button
            type="button"
            variant="ghost"
            className="flex w-full flex-col items-start gap-1.5 rounded-md px-4 py-3 text-start text-sm aria-pressed:bg-accent"
            key={draft.id}
            onClick={() => {
              void (async () => {
                const conversation =
                  draft.conversationId === undefined
                    ? undefined
                    : await desktopBridge.getConversation({
                        mailboxId,
                        conversationId: draft.conversationId,
                      })
                const replyContext =
                  draft.conversationId !== undefined && draft.replyToMessageId !== undefined
                    ? {
                        conversationId: draft.conversationId,
                        replyToMessageId: draft.replyToMessageId,
                        ...(conversation === undefined
                          ? {}
                          : { sourceVersion: conversation.version }),
                      }
                    : undefined
                onOpenComposer({
                  kind: 'edit',
                  draft,
                  ...(replyContext === undefined ? {} : { replyContext }),
                })
              })()
            }}
          >
            <strong className="text-sm font-medium">{draft.subject || '(No subject)'}</strong>
            <span className="max-w-full truncate text-sm text-muted-foreground">
              {draft.textBody || 'Empty draft'}
            </span>
            <small className="text-sm text-muted-foreground">{draft.syncState}</small>
          </Button>
        ))}
        {drafts?.length === 0 ? <p className="px-4 py-6 text-sm">No local drafts.</p> : null}
      </div>
    </section>
  )
}
